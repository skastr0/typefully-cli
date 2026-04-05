import * as Cause from "effect/Cause"
import { Effect } from "effect"

import {
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

export const setExitCode = (exitCode: number) =>
  Effect.sync(() => {
    process.exitCode = exitCode
  })

export const toErrorDetails = (error: unknown): ErrorEnvelope["error"] => {
  if (error instanceof ConfigurationError) {
    return {
      type: error._tag,
      message: error.message,
      details: { field: error.field },
    }
  }

  if (error instanceof MissingApiKeyError) {
    return {
      type: error._tag,
      message: `${error.envVar} is not configured`,
      details: {
        env_var: error.envVar,
        hint: error.hint,
      },
    }
  }

  if (error instanceof JsonInputError) {
    return {
      type: error._tag,
      message: error.message,
      details: {
        source: error.source,
        reason: error.reason,
      },
    }
  }

  if (error instanceof CommandInputError) {
    return {
      type: error._tag,
      message: error.message,
      details: { field: error.field },
    }
  }

  if (error instanceof MediaFileError) {
    return {
      type: error._tag,
      message: error.message,
      details: {
        file_path: error.filePath,
      },
    }
  }

  if (error instanceof MediaUploadError) {
    return {
      type: error._tag,
      message: error.message,
      details: {
        file_path: error.filePath,
        status: error.status ?? undefined,
      },
    }
  }

  if (error instanceof MediaProcessingError) {
    return {
      type: error._tag,
      message: error.message,
      details: {
        social_set_id: error.socialSetId,
        media_id: error.mediaId,
        reason: error.reason,
      },
    }
  }

  if (error instanceof TypefullyRequestError) {
    return {
      type: error._tag,
      message: error.message,
      details: {
        method: error.method,
        path: error.path,
        reason: error.reason,
      },
    }
  }

  if (error instanceof TypefullyApiError) {
    return {
      type: error._tag,
      message: error.message,
      details: {
        method: error.method,
        path: error.path,
        status: error.status,
        body: error.body,
      },
    }
  }

  if (error instanceof TypefullyDecodeError) {
    return {
      type: error._tag,
      message: error.message,
      details: {
        method: error.method,
        path: error.path,
      },
    }
  }

  if (error instanceof Error) {
    return {
      type: error.name || "Error",
      message: error.message,
    }
  }

  return {
    type: "Error",
    message: String(error),
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
