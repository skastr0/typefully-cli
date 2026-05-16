import { Command } from "@effect/cli"

import { clearResponseCache, getResponseCacheOverview } from "../core/cache"
import { executeJsonCommand } from "../core/output"

const cacheStatusCommand = Command.make("status", {}, () =>
  executeJsonCommand("cache status", getResponseCacheOverview()),
).pipe(Command.withDescription("Inspect the local Typefully response cache"))

const cacheClearCommand = Command.make("clear", {}, () =>
  executeJsonCommand("cache clear", clearResponseCache()),
).pipe(Command.withDescription("Clear the local Typefully response cache"))

export const cacheCommand = Command.make("cache").pipe(
  Command.withDescription("Local response cache commands"),
  Command.withSubcommands([cacheStatusCommand, cacheClearCommand]),
)
