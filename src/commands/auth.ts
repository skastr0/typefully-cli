import { Args, Command } from "@effect/cli"
import { Effect } from "effect"

import { authStatus, getAuthPath, importAuthFromEnv, saveAuthKey } from "../core/auth"
import { executeJsonCommand } from "../core/output"
import { getAuthStatus } from "../core/typefully"

const apiKeyArg = Args.text({ name: "api_key" }).pipe(
  Args.withDescription("Typefully API key from Typefully Settings -> API"),
)

const authStatusCommand = Command.make("status", {}, () =>
  executeJsonCommand("auth status", getAuthStatus),
).pipe(Command.withDescription("Check whether the configured API key works against Typefully v2"))

const authPathCommand = Command.make("path", {}, () =>
  executeJsonCommand("auth path", Effect.sync(() => ({ auth_path: getAuthPath() }))),
).pipe(Command.withDescription("Print the local Typefully auth file path"))

const authSetCommand = Command.make("set", { apiKey: apiKeyArg }, ({ apiKey }) =>
  executeJsonCommand("auth set", Effect.sync(() => saveAuthKey(apiKey))),
).pipe(Command.withDescription("Save a Typefully API key to the local auth file"))

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
