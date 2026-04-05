import { Command, Options } from "@effect/cli"
import { Effect, Option } from "effect"

import { CommandInputError } from "../core/errors"
import { executeJsonCommand } from "../core/output"
import { listSocialSets } from "../core/typefully"

const toUndefined = <A>(value: Option.Option<A>) => (Option.isSome(value) ? value.value : undefined)

const limitOption = Options.integer("limit").pipe(
  Options.optional,
  Options.withDescription("Maximum number of social sets to return"),
)

const offsetOption = Options.integer("offset").pipe(
  Options.optional,
  Options.withDescription("Number of social sets to skip before returning results"),
)

const validatePagination = (field: "limit" | "offset", value: number | undefined) => {
  if (value === undefined) {
    return Effect.void
  }

  if (field === "limit" && value <= 0) {
    return Effect.fail(
      new CommandInputError({
        field,
        message: "limit must be a positive integer",
      }),
    )
  }

  if (field === "offset" && value < 0) {
    return Effect.fail(
      new CommandInputError({
        field,
        message: "offset must be a non-negative integer",
      }),
    )
  }

  return Effect.void
}

const socialSetsListCommand = Command.make(
  "list",
  {
    limit: limitOption,
    offset: offsetOption,
  },
  ({ limit, offset }) => {
    const resolvedLimit = toUndefined(limit)
    const resolvedOffset = toUndefined(offset)

    return executeJsonCommand(
      "social-sets list",
      Effect.gen(function* () {
        yield* validatePagination("limit", resolvedLimit)
        yield* validatePagination("offset", resolvedOffset)

        const socialSets = yield* listSocialSets({
          ...(resolvedLimit !== undefined ? { limit: resolvedLimit } : {}),
          ...(resolvedOffset !== undefined ? { offset: resolvedOffset } : {}),
        })

        return {
          social_sets: socialSets,
        }
      }),
    )
  },
).pipe(Command.withDescription("List Typefully social sets"))

export const socialSetsCommand = Command.make("social-sets").pipe(
  Command.withDescription("Social set commands"),
  Command.withSubcommands([socialSetsListCommand]),
)
