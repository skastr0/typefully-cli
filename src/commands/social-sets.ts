import { Args, Command, Options } from "@effect/cli"
import { Effect, Schema } from "effect"

import { applyOutputPolicy, OUTPUT_MODE_VALUES } from "../core/artifacts"
import { CommandInputError } from "../core/errors"
import { loadJsonInput } from "../core/json"
import { executeJsonCommand } from "../core/output"
import { getSocialSet, listSocialSets, TypefullyIdentifierSchema } from "../core/typefully"

const jsonInputArg = Args.text({ name: "input" }).pipe(
  Args.withDescription("JSON object, @file path, raw JSON string, or - for stdin"),
)

const outputOption = Options.choice("output", OUTPUT_MODE_VALUES).pipe(
  Options.withDefault("inline"),
  Options.withDescription("Output policy for potentially large responses: inline, artifact, or auto"),
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

export const socialSetsListInputSchema = Schema.Struct({
  limit: Schema.optional(Schema.Number),
  offset: Schema.optional(Schema.Number),
})

type SocialSetsListInput = typeof socialSetsListInputSchema.Type

export const socialSetsGetInputSchema = Schema.Struct({
  social_set_id: TypefullyIdentifierSchema,
})

const validateListInput = (input: SocialSetsListInput) =>
  Effect.gen(function* () {
    yield* validatePagination("limit", input.limit)
    yield* validatePagination("offset", input.offset)
  })

const socialSetsListCommand = Command.make(
  "list",
  { input: jsonInputArg, output: outputOption },
  ({ input, output }) =>
    executeJsonCommand(
      "social-sets list",
      Effect.gen(function* () {
        const payload = yield* loadJsonInput(socialSetsListInputSchema, input)
        yield* validateListInput(payload)

        const socialSets = yield* listSocialSets({
          ...(payload.limit !== undefined ? { limit: payload.limit } : {}),
          ...(payload.offset !== undefined ? { offset: payload.offset } : {}),
        })

        return yield* applyOutputPolicy({
          outputMode: output,
          command: "social-sets list",
          data: { social_sets: socialSets },
          artifactKey: "social-sets.list",
          artifactLabel: "social-sets list response",
          summary: `Wrote ${socialSets.results.length} records from social-sets list to an artifact.`,
        })
      }),
    )
).pipe(
  Command.withDescription("List Typefully social sets from a JSON input object with optional pagination"),
)

const socialSetsGetCommand = Command.make("get", { input: jsonInputArg }, ({ input }) =>
  executeJsonCommand(
    "social-sets get",
    Effect.gen(function* () {
      const payload = yield* loadJsonInput(socialSetsGetInputSchema, input)
      const socialSet = yield* getSocialSet({ socialSetId: payload.social_set_id })

      return {
        social_set: socialSet,
      }
    }),
  ),
).pipe(
  Command.withDescription("Get a single social set from a JSON input object containing social_set_id"),
)

export const socialSetsCommand = Command.make("social-sets").pipe(
  Command.withDescription("Social set commands"),
  Command.withSubcommands([socialSetsListCommand, socialSetsGetCommand]),
)
