import * as Cause from "effect/Cause"
import { Effect } from "effect"

import {
  ArtifactWriteError,
  CacheReadError,
  CacheRemoveError,
  CacheWriteError,
  CommandInputError,
  ConfigurationError,
  JsonInputError,
  MediaFileError,
  MediaProcessingError,
  MediaUploadError,
  MissingApiKeyError,
  TypefullyApiError,
  TypefullyDecodeError,
  TypefullyRequestError,
} from "./errors"

interface SuccessEnvelope {
  readonly ok: true
  readonly command: string
  readonly data: unknown
}

export interface ErrorEnvelope {
  readonly ok: false
  readonly command?: string
  readonly error: {
    readonly type: string
    readonly message: string
    readonly details?: unknown
  }
}

const writeLine = (stream: NodeJS.WriteStream, text: string) =>
  Effect.sync(() => {
    stream.write(`${text}\n`)
  })

const SENSITIVE_KEY_PATTERN = /(api_?key|authorization|presigned|signature|token|upload_?url)/i
const SENSITIVE_URL_PATTERN = /https?:\/\/[^\s"']*(?:signature|token|x-amz-signature)[^\s"']*/gi
const TYPEFULLY_KEY_PATTERN = /tfy_[A-Za-z0-9_-]+/g

const redactSensitiveText = (value: string) =>
  value
    .replace(SENSITIVE_URL_PATTERN, "[redacted-url]")
    .replace(TYPEFULLY_KEY_PATTERN, "[redacted-api-key]")

const redactSensitiveValue = (value: unknown): unknown => {
  if (typeof value === "string") {
    return redactSensitiveText(value)
  }

  if (Array.isArray(value)) {
    return value.map(redactSensitiveValue)
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : redactSensitiveValue(entry),
      ]),
    )
  }

  return value
}

const isRetryableStatus = (status: number) => status === 408 || status === 409 || status === 429 || status >= 500

export const setExitCode = (exitCode: number) =>
  Effect.sync(() => {
    process.exitCode = exitCode
  })

export const toErrorDetails = (error: unknown): ErrorEnvelope["error"] => {
  if (error instanceof ConfigurationError) {
    return {
      type: error._tag,
      message: redactSensitiveText(error.message),
      details: {
        field: error.field,
        hint: "Check the configured value and rerun the command.",
        retryable: false,
      },
    }
  }

  if (error instanceof MissingApiKeyError) {
    return {
      type: error._tag,
      message: `${error.envVar} is not configured`,
      details: {
        env_var: error.envVar,
        hint: error.hint,
        next_step: `Set ${error.envVar} and rerun the command.`,
        retryable: false,
      },
    }
  }

  if (error instanceof JsonInputError) {
    return {
      type: error._tag,
      message: redactSensitiveText(error.message),
      details: {
        source: error.source,
        reason: error.reason,
        hint: "Provide valid JSON via inline input, @file, or stdin.",
        retryable: false,
      },
    }
  }

  if (error instanceof CommandInputError) {
    return {
      type: error._tag,
      message: redactSensitiveText(error.message),
      details: {
        field: error.field,
        path: error.field,
        hint: "Fix the input payload and rerun the command.",
        retryable: false,
      },
    }
  }

  if (error instanceof ArtifactWriteError) {
    return {
      type: error._tag,
      message: redactSensitiveText(error.message),
      details: {
        path: error.path,
        hint: "Check that the artifact directory is writable or set TYPEFULLY_ARTIFACT_DIR.",
        retryable: true,
      },
    }
  }

  if (error instanceof CacheReadError || error instanceof CacheWriteError || error instanceof CacheRemoveError) {
    return {
      type: error._tag,
      message: redactSensitiveText(error.message),
      details: {
        path: error.path,
        reason: error.reason,
        hint: "Check that the cache directory is readable and writable or set TYPEFULLY_CACHE_DIR.",
        retryable: true,
      },
    }
  }

  if (error instanceof MediaFileError) {
    return {
      type: error._tag,
      message: redactSensitiveText(error.message),
      details: {
        file_path: error.filePath,
        hint: "Check that file_path points to a readable, non-empty file.",
        retryable: false,
      },
    }
  }

  if (error instanceof MediaUploadError) {
    return {
      type: error._tag,
      message: redactSensitiveText(error.message),
      details: {
        file_path: error.filePath,
        status: error.status ?? undefined,
        hint: "Request a fresh upload URL by rerunning the media upload command.",
        retryable: true,
      },
    }
  }

  if (error instanceof MediaProcessingError) {
    return {
      type: error._tag,
      message: redactSensitiveText(error.message),
      details: {
        social_set_id: error.socialSetId,
        media_id: error.mediaId,
        reason: redactSensitiveValue(error.reason),
        hint: "Inspect the media processing reason, then retry with a supported file if needed.",
        retryable: false,
      },
    }
  }

  if (error instanceof TypefullyRequestError) {
    return {
      type: error._tag,
      message: redactSensitiveText(error.message),
      details: {
        method: error.method,
        path: error.path,
        reason: error.reason,
        hint: "Retry after checking network access and TYPEFULLY_API_BASE_URL.",
        retryable: true,
      },
    }
  }

  if (error instanceof TypefullyApiError) {
    const retryable = isRetryableStatus(error.status)

    return {
      type: error._tag,
      message: redactSensitiveText(error.message),
      details: {
        method: error.method,
        path: error.path,
        status: error.status,
        body: redactSensitiveValue(error.body),
        hint: retryable
          ? "Retry with backoff; the provider reported a retryable status."
          : "Inspect the provider response and fix the request before retrying.",
        retryable,
      },
    }
  }

  if (error instanceof TypefullyDecodeError) {
    return {
      type: error._tag,
      message: redactSensitiveText(error.message),
      details: {
        method: error.method,
        path: error.path,
        hint: "The provider response shape did not match the client schema.",
        retryable: false,
      },
    }
  }

  if (error instanceof Error) {
    return {
      type: error.name || "Error",
      message: redactSensitiveText(error.message),
    }
  }

  return {
    type: "Error",
    message: redactSensitiveText(String(error)),
  }
}

export const renderSuccessEnvelope = (command: string, data: unknown) =>
  JSON.stringify(
    {
      ok: true,
      command,
      data,
    } satisfies SuccessEnvelope,
    null,
    2,
  )

export const renderFailureEnvelope = (command: string | undefined, error: unknown) =>
  JSON.stringify(
    {
      ok: false,
      ...(command ? { command } : {}),
      error: toErrorDetails(error),
    } satisfies ErrorEnvelope,
    null,
    2,
  )

export const writeSuccessEnvelope = (command: string, data: unknown) =>
  writeLine(process.stdout, renderSuccessEnvelope(command, data))

export const writeFailureEnvelope = (command: string | undefined, error: unknown) =>
  writeLine(process.stderr, renderFailureEnvelope(command, error))

export const writeCauseEnvelope = (command: string | undefined, cause: Cause.Cause<unknown>) =>
  writeLine(
    process.stderr,
    JSON.stringify(
      {
        ok: false,
        ...(command ? { command } : {}),
        error: {
          type: "UnexpectedError",
          message: Cause.pretty(cause),
        },
      } satisfies ErrorEnvelope,
      null,
      2,
    ),
  )

export const executeJsonCommand = <A, E, R>(command: string, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.flatMap((data) => writeSuccessEnvelope(command, data)),
    Effect.catchAll((error) =>
      setExitCode(1).pipe(Effect.zipRight(writeFailureEnvelope(command, error))),
    ),
  )
