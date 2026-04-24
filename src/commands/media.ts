import { readFile, stat } from "node:fs/promises"
import { basename } from "node:path"

import { HttpClient } from "@effect/platform"
import { Args, Command, Options } from "@effect/cli"
import { Effect, Schema } from "effect"

import { applyOutputPolicy, OUTPUT_MODE_VALUES } from "../core/artifacts"
import {
  CommandInputError,
  MediaFileError,
  MediaProcessingError,
  MediaUploadError,
} from "../core/errors"
import { loadJsonInput } from "../core/json"
import { executeJsonCommand } from "../core/output"
import {
  createMediaUpload,
  getMediaStatus,
  type MediaStatusResponse,
  type TypefullyIdentifier,
  TypefullyIdentifierSchema,
} from "../core/typefully"

const DEFAULT_MEDIA_TIMEOUT_SECONDS = 60
const DEFAULT_MEDIA_POLL_INTERVAL_MS = 2_000

const jsonInputArg = Args.text({ name: "input" }).pipe(
  Args.withDescription("JSON object, @file path, raw JSON string, or - for stdin"),
)

const outputOption = Options.choice("output", OUTPUT_MODE_VALUES).pipe(
  Options.withDefault("inline"),
  Options.withDescription("Output policy for media diagnostics: inline, artifact, or auto"),
)

export const mediaUploadInputSchema = Schema.Struct({
  social_set_id: TypefullyIdentifierSchema,
  file_path: Schema.String,
  file_name: Schema.optional(Schema.String),
  wait_for_ready: Schema.optional(Schema.Boolean),
  timeout_seconds: Schema.optional(Schema.Number),
  poll_interval_ms: Schema.optional(Schema.Number),
})

type MediaUploadInput = typeof mediaUploadInputSchema.Type

type MediaPollResult =
  | {
      readonly timed_out: false
      readonly media: MediaStatusResponse
    }
  | {
      readonly timed_out: true
      readonly media: MediaStatusResponse
    }

const validatePositiveInteger = (field: string, value: number | undefined) => {
  if (value === undefined) {
    return Effect.void
  }

  if (!Number.isInteger(value) || value <= 0) {
    return Effect.fail(
      new CommandInputError({
        field,
        message: `${field} must be a positive integer`,
      }),
    )
  }

  return Effect.void
}

const resolveFileName = (input: MediaUploadInput) => {
  const fileName = input.file_name?.trim() ?? basename(input.file_path.trim())

  if (fileName.length === 0) {
    return Effect.fail(
      new CommandInputError({
        field: input.file_name !== undefined ? "file_name" : "file_path",
        message: "a filename with an extension is required",
      }),
    )
  }

  return Effect.succeed(fileName)
}

const validateUploadInput = (input: MediaUploadInput) =>
  Effect.gen(function* () {
    if (input.file_path.trim().length === 0) {
      yield* Effect.fail(
        new CommandInputError({
          field: "file_path",
          message: "file_path is required",
        }),
      )
    }

    if (input.file_name !== undefined && input.file_name.trim().length === 0) {
      yield* Effect.fail(
        new CommandInputError({
          field: "file_name",
          message: "file_name cannot be empty",
        }),
      )
    }

    yield* validatePositiveInteger("timeout_seconds", input.timeout_seconds)
    yield* validatePositiveInteger("poll_interval_ms", input.poll_interval_ms)
    yield* resolveFileName(input)
  })

const readMediaBytes = (filePath: string) =>
  Effect.tryPromise({
    try: async () => {
      const fileStats = await stat(filePath)

      if (!fileStats.isFile()) {
        throw new Error("Path does not point to a file")
      }

      const bytes = await readFile(filePath)

      if (bytes.byteLength === 0) {
        throw new Error("Media file is empty")
      }

      return bytes
    },
    catch: (cause) =>
      new MediaFileError({
        filePath,
        message: cause instanceof Error ? cause.message : "Failed to read media file",
      }),
  })

const uploadToPresignedUrl = (params: {
  readonly filePath: string
  readonly uploadUrl: string
  readonly bytes: Uint8Array
}) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(params.uploadUrl, {
        method: "PUT",
        body: params.bytes,
      })

      if (response.status === 200 || response.status === 204) {
        return {
          status: response.status,
        }
      }

      throw new MediaUploadError({
        filePath: params.filePath,
        uploadUrl: params.uploadUrl,
        status: response.status,
        message: `Presigned upload failed with status ${response.status}. Request a new upload URL and retry.`,
      })
    },
    catch: (cause) =>
      cause instanceof MediaUploadError
        ? cause
        : new MediaUploadError({
            filePath: params.filePath,
            uploadUrl: params.uploadUrl,
            status: undefined,
            message: cause instanceof Error ? cause.message : "Failed to upload media file",
          }),
  })

const pollMediaUntilReady = (params: {
  readonly socialSetId: TypefullyIdentifier
  readonly mediaId: string
  readonly timeoutSeconds: number
  readonly pollIntervalMs: number
}) => {
  const deadline = Date.now() + params.timeoutSeconds * 1_000

  const loop = (): Effect.Effect<MediaPollResult, unknown, HttpClient.HttpClient> =>
    getMediaStatus({
      socialSetId: params.socialSetId,
      mediaId: params.mediaId,
    }).pipe(
      Effect.flatMap((media) => {
        if (media.status === "ready") {
          return Effect.succeed({
            timed_out: false,
            media,
          } satisfies MediaPollResult)
        }

        if (media.status === "failed" || media.status === "error") {
          return Effect.fail(
            new MediaProcessingError({
              socialSetId: params.socialSetId,
              mediaId: params.mediaId,
              reason: media.error_reason,
              message: "Typefully reported media processing failure",
            }),
          )
        }

        if (Date.now() >= deadline) {
          return Effect.succeed({
            timed_out: true,
            media,
          } satisfies MediaPollResult)
        }

        return Effect.sleep(params.pollIntervalMs).pipe(Effect.zipRight(loop()))
      }),
    )

  return loop()
}

const buildUploadResponse = (params: {
  readonly input: MediaUploadInput
  readonly fileName: string
  readonly mediaId: string
  readonly waited: boolean
  readonly timedOut?: boolean
  readonly media?: MediaStatusResponse
}) => {
  const status = params.media?.status ?? "processing"

  return {
    social_set_id: params.input.social_set_id,
    media_id: params.mediaId,
    file_name: params.fileName,
    status,
    waited: params.waited,
    ...(params.timedOut ? { timed_out: true } : {}),
    ...(params.media ? { media: params.media } : {}),
    message:
      status === "ready"
        ? "Media uploaded and ready to use"
        : params.timedOut
          ? "Media uploaded but is still processing"
          : "Media uploaded. Poll later if it is not ready yet.",
  }
}

const runMediaUpload = (input: string, outputMode: "inline" | "artifact" | "auto") =>
  Effect.gen(function* () {
    const payload = yield* loadJsonInput(mediaUploadInputSchema, input)
    yield* validateUploadInput(payload)

    const fileName = yield* resolveFileName(payload)
    const bytes = yield* readMediaBytes(payload.file_path)
    const presignedUpload = yield* createMediaUpload({
      socialSetId: payload.social_set_id,
      body: {
        file_name: fileName,
      },
    })

    yield* uploadToPresignedUrl({
      filePath: payload.file_path,
      uploadUrl: presignedUpload.upload_url,
      bytes,
    })

    const waitForReady = payload.wait_for_ready ?? true

    if (!waitForReady) {
      const response = buildUploadResponse({
        input: payload,
        fileName,
        mediaId: presignedUpload.media_id,
        waited: false,
      })

      return yield* applyOutputPolicy({
        outputMode,
        command: "media upload",
        data: response,
        artifactKey: "media.upload",
        artifactLabel: "media upload response",
        summary: `Wrote media upload diagnostics for ${presignedUpload.media_id} to an artifact.`,
      })
    }

    const pollResult = yield* pollMediaUntilReady({
      socialSetId: payload.social_set_id,
      mediaId: presignedUpload.media_id,
      timeoutSeconds: payload.timeout_seconds ?? DEFAULT_MEDIA_TIMEOUT_SECONDS,
      pollIntervalMs: payload.poll_interval_ms ?? DEFAULT_MEDIA_POLL_INTERVAL_MS,
    })

    const response = buildUploadResponse({
      input: payload,
      fileName,
      mediaId: presignedUpload.media_id,
      waited: true,
      timedOut: pollResult.timed_out,
      media: pollResult.media,
    })

    return yield* applyOutputPolicy({
      outputMode,
      command: "media upload",
      data: response,
      artifactKey: "media.upload",
      artifactLabel: "media upload response",
      summary: `Wrote media upload diagnostics for ${presignedUpload.media_id} to an artifact.`,
    })
  })

const mediaUploadCommand = Command.make(
  "upload",
  { input: jsonInputArg, output: outputOption },
  ({ input, output }) => executeJsonCommand("media upload", runMediaUpload(input, output)),
).pipe(
  Command.withDescription(
    "Upload a local file using a JSON input object with social_set_id, file_path, and optional wait controls",
  ),
)

export const mediaCommand = Command.make("media").pipe(
  Command.withDescription("Media workflow commands"),
  Command.withSubcommands([mediaUploadCommand]),
)
