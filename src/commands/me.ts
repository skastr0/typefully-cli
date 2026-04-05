import { Command } from "@effect/cli"
import { Effect } from "effect"

import { executeJsonCommand } from "../core/output"
import { getMe } from "../core/typefully"

export const meCommand = Command.make("me", {}, () =>
  executeJsonCommand(
    "me",
    getMe().pipe(
      Effect.map((me) => ({
        me,
      })),
    ),
  ),
).pipe(Command.withDescription("Fetch the current Typefully account via /v2/me"))
