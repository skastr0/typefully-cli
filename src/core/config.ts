import { Effect } from "effect"

import {
  TYPEFULLY_API_BASE_URL_ENV,
  TYPEFULLY_API_KEY_ENV,
  TYPEFULLY_API_KEY_HINT,
  TYPEFULLY_DEFAULT_API_BASE_URL,
} from "./constants"
import { ConfigurationError, MissingApiKeyError } from "./errors"

export interface AppConfig {
  readonly apiBaseUrl: string
  readonly apiKey?: string
}

const normalizeBaseUrl = (rawValue: string): Effect.Effect<string, ConfigurationError> =>
  Effect.try({
    try: () => {
      const trimmed = rawValue.trim()

      if (trimmed.length === 0) {
        throw new Error("Base URL cannot be empty")
      }

      const url = new URL(trimmed)
      url.pathname = url.pathname.replace(/\/$/, "")

      return url.toString().replace(/\/$/, "")
    },
    catch: (cause) =>
      new ConfigurationError({
        field: TYPEFULLY_API_BASE_URL_ENV,
        message: cause instanceof Error ? cause.message : "Invalid Typefully API base URL",
      }),
  })

export const loadAppConfig = Effect.fn("loadAppConfig")(function* () {
  const apiBaseUrl = yield* normalizeBaseUrl(
    Bun.env[TYPEFULLY_API_BASE_URL_ENV] ?? TYPEFULLY_DEFAULT_API_BASE_URL,
  )

  const apiKey = Bun.env[TYPEFULLY_API_KEY_ENV]?.trim()

  return {
    apiBaseUrl,
    ...(apiKey && apiKey.length > 0 ? { apiKey } : {}),
  } satisfies AppConfig
})

export const requireApiKey = Effect.fn("requireApiKey")(function* () {
  const config = yield* loadAppConfig()

  if (!config.apiKey) {
    return yield* Effect.fail(
      new MissingApiKeyError({
        envVar: TYPEFULLY_API_KEY_ENV,
        hint: TYPEFULLY_API_KEY_HINT,
      }),
    )
  }

  return config.apiKey
})
