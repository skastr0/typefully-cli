import { Args, Command } from "@effect/cli"
import { Effect, Schema } from "effect"

import { CommandInputError } from "../core/errors"
import { loadJsonInput } from "../core/json"
import { executeJsonCommand } from "../core/output"
import { createTag, listTags, TypefullyIdentifierSchema } from "../core/typefully"

const jsonInputArg = Args.text({ name: "input" }).pipe(
  Args.withDescription("JSON object, @file path, raw JSON string, or - for stdin"),
)

const tagsListInputSchema = Schema.Struct({
  social_set_id: TypefullyIdentifierSchema,
  limit: Schema.optional(Schema.Number),
  offset: Schema.optional(Schema.Number),
})

type TagsListInput = typeof tagsListInputSchema.Type

const tagsCreateInputSchema = Schema.Struct({
  social_set_id: TypefullyIdentifierSchema,
  name: Schema.String,
})

type TagsCreateInput = typeof tagsCreateInputSchema.Type

const validatePositiveInteger = (field: string, value: number | undefined) => {
  if (value === undefined) {
    return Effect.void
  }

  if (!Number.isInteger(value) || value <= 0) {
    return Effect.fail(
      new CommandInputError({
        field,
        message: `${field} must be a positive integer`,
      }),
    )
  }

  return Effect.void
}

const validateNonNegativeInteger = (field: string, value: number | undefined) => {
  if (value === undefined) {
    return Effect.void
  }

  if (!Number.isInteger(value) || value < 0) {
    return Effect.fail(
      new CommandInputError({
        field,
        message: `${field} must be a non-negative integer`,
      }),
    )
  }

  return Effect.void
}

const validateTagsListInput = (input: TagsListInput) =>
  Effect.gen(function* () {
    yield* validatePositiveInteger("limit", input.limit)
    yield* validateNonNegativeInteger("offset", input.offset)
  })

const validateTagsCreateInput = (input: TagsCreateInput) => {
  if (input.name.trim().length === 0) {
    return Effect.fail(
      new CommandInputError({
        field: "name",
        message: "name must not be empty",
      }),
    )
  }

  return Effect.void
}

const tagsListCommand = Command.make("list", { input: jsonInputArg }, ({ input }) =>
  executeJsonCommand(
    "tags list",
    Effect.gen(function* () {
      const payload = yield* loadJsonInput(tagsListInputSchema, input)
      yield* validateTagsListInput(payload)

      const tags = yield* listTags({
        socialSetId: payload.social_set_id,
        ...(payload.limit !== undefined ? { limit: payload.limit } : {}),
        ...(payload.offset !== undefined ? { offset: payload.offset } : {}),
      })

      return { tags }
    }),
  ),
).pipe(
  Command.withDescription("List tags for a social set from a JSON input object containing social_set_id"),
)

const tagsCreateCommand = Command.make("create", { input: jsonInputArg }, ({ input }) =>
  executeJsonCommand(
    "tags create",
    Effect.gen(function* () {
      const payload = yield* loadJsonInput(tagsCreateInputSchema, input)
      yield* validateTagsCreateInput(payload)

      const tag = yield* createTag({
        socialSetId: payload.social_set_id,
        body: {
          name: payload.name,
        },
      })

      return { tag }
    }),
  ),
).pipe(Command.withDescription("Create a tag for a social set from a JSON input object"))

export const tagsCommand = Command.make("tags").pipe(
  Command.withDescription("Tag commands"),
  Command.withSubcommands([tagsListCommand, tagsCreateCommand]),
)
