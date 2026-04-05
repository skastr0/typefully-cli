import { Command } from "@effect/cli"

import { executeJsonCommand } from "../core/output"
import { getAuthStatus } from "../core/typefully"

const authStatusCommand = Command.make("status", {}, () =>
  executeJsonCommand("auth status", getAuthStatus),
).pipe(Command.withDescription("Check whether the configured API key works against Typefully v2"))

export const authCommand = Command.make("auth").pipe(
  Command.withDescription("Authentication commands"),
  Command.withSubcommands([authStatusCommand]),
)
