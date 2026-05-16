import { Args, Command, Options } from "@effect/cli"
import { Effect, Option, Schema } from "effect"

import { applyOutputPolicy, OUTPUT_MODE_VALUES } from "../core/artifacts"
import type { TypefullyCacheOptions } from "../core/cache"
import { CommandInputError } from "../core/errors"
import { loadJsonInput } from "../core/json"
import { executeJsonCommand } from "../core/output"
import { createTag, listTags, TypefullyIdentifierSchema } from "../core/typefully"

const jsonInputArg = Args.text({ name: "input" }).pipe(
  Args.withDescription("JSON object, @file path, raw JSON string, or - for stdin"),
)

const outputOption = Options.choice("output", OUTPUT_MODE_VALUES).pipe(
  Options.withDefault("inline"),
  Options.withDescription("Output policy for potentially large responses: inline, artifact, or auto"),
)

const refreshOption = Options.boolean("refresh", { ifPresent: true }).pipe(
  Options.withDescription("Bypass the local response cache and fetch fresh Typefully data"),
)

const cacheTtlSecondsOption = Options.integer("cache-ttl-seconds").pipe(
  Options.optional,
  Options.withDescription("Freshness window used when reporting whether cached Typefully data is stale"),
)

const staleIfErrorOption = Options.boolean("stale-if-error", { ifPresent: true }).pipe(
  Options.withDescription("Return stale cached Typefully data when a refresh request fails"),
)

const cacheOptions = (options: {
  readonly refresh: boolean
  readonly cacheTtlSeconds?: Option.Option<number>
  readonly staleIfError: boolean
}): TypefullyCacheOptions => ({
  refresh: options.refresh,
  allowStaleOnError: options.staleIfError,
  ...(options.cacheTtlSeconds !== undefined && Option.isSome(options.cacheTtlSeconds)
    ? { maxAgeSeconds: options.cacheTtlSeconds.value }
    : {}),
})

const toUndefined = <A>(value: Option.Option<A>) =>
  Option.isSome(value) ? value.value : undefined

export const tagsListInputSchema = Schema.Struct({
  social_set_id: TypefullyIdentifierSchema,
  limit: Schema.optional(Schema.Number),
  offset: Schema.optional(Schema.Number),
})

type TagsListInput = typeof tagsListInputSchema.Type

export const tagsCreateInputSchema = Schema.Struct({
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

const tagsListCommand = Command.make(
  "list",
  {
    input: jsonInputArg,
    output: outputOption,
    refresh: refreshOption,
    cacheTtlSeconds: cacheTtlSecondsOption,
    staleIfError: staleIfErrorOption,
  },
  ({ input, output, refresh, cacheTtlSeconds, staleIfError }) =>
    executeJsonCommand(
      "tags list",
      Effect.gen(function* () {
        const payload = yield* loadJsonInput(tagsListInputSchema, input)
        const ttlSeconds = toUndefined(cacheTtlSeconds)
        yield* validateTagsListInput(payload)
        yield* validateNonNegativeInteger("cache_ttl_seconds", ttlSeconds)

        const tags = yield* listTags({
          socialSetId: payload.social_set_id,
          ...(payload.limit !== undefined ? { limit: payload.limit } : {}),
          ...(payload.offset !== undefined ? { offset: payload.offset } : {}),
          cache: cacheOptions({ refresh, cacheTtlSeconds, staleIfError }),
        })

        return yield* applyOutputPolicy({
          outputMode: output,
          command: "tags list",
          data: { tags },
          artifactKey: "tags.list",
          artifactLabel: "tags list response",
          summary: `Wrote ${tags.results.length} records from tags list to an artifact.`,
        })
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
