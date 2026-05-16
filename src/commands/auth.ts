import { Command } from "@effect/cli"
import { Effect } from "effect"

import { authStatus, getAuthPath, importAuthFromEnv, saveAuthKey } from "../core/auth"
import { executeJsonCommand } from "../core/output"
import { getAuthStatus } from "../core/typefully"

const readApiKeyFromStdin = Effect.tryPromise({
  try: () => new Response(Bun.stdin.stream()).text(),
  catch: (cause) => cause instanceof Error ? cause : new Error("Failed to read API key from stdin"),
})

const authStatusCommand = Command.make("status", {}, () =>
  executeJsonCommand("auth status", getAuthStatus),
).pipe(Command.withDescription("Check whether the configured API key works against Typefully v2"))

const authPathCommand = Command.make("path", {}, () =>
  executeJsonCommand("auth path", Effect.sync(() => ({ auth_path: getAuthPath() }))),
).pipe(Command.withDescription("Print the local Typefully auth file path"))

const authSetCommand = Command.make("set", {}, () =>
  executeJsonCommand(
    "auth set",
    Effect.gen(function* () {
      const apiKey = yield* readApiKeyFromStdin
      return saveAuthKey(apiKey)
    }),
  ),
).pipe(Command.withDescription("Save a Typefully API key from stdin to the local auth file"))

const authImportEnvCommand = Command.make("import-env", {}, () =>
  executeJsonCommand("auth import-env", Effect.sync(() => importAuthFromEnv())),
).pipe(Command.withDescription("Save TYPEFULLY_API_KEY from the current environment to the local auth file"))

const authLocalStatusCommand = Command.make("local-status", {}, () =>
  executeJsonCommand("auth local-status", Effect.sync(() => authStatus())),
).pipe(Command.withDescription("Inspect local stored Typefully auth without a network request"))

export const authCommand = Command.make("auth").pipe(
  Command.withDescription("Authentication commands"),
  Command.withSubcommands([
    authStatusCommand,
    authPathCommand,
    authSetCommand,
    authImportEnvCommand,
    authLocalStatusCommand,
  ]),
)
