import { Args, Command, Options } from "@effect/cli"
import { Effect, Option, Schema } from "effect"

import { CommandInputError, JsonInputError } from "../core/errors"
import { loadJsonInput } from "../core/json"
import { executeJsonCommand, setExitCode, toErrorDetails } from "../core/output"
import {
  createDraft,
  deleteDraft,
  DraftOrderBySchema,
  DraftPlatformsSchema,
  DraftStatusSchema,
  getDraft,
  listDrafts,
  TypefullyIdentifierSchema,
  updateDraft,
} from "../core/typefully"
import type {
  DraftCreateRequest,
  DraftPlatforms,
  DraftUpdateRequest,
  TypefullyIdentifier,
} from "../core/typefully"

const DEFAULT_BATCH_CONCURRENCY = 5
const publishAtIsoPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

const PLATFORM_NAMES = ["x", "linkedin", "mastodon", "threads", "bluesky"] as const

const toUndefined = <A>(value: Option.Option<A>) => (Option.isSome(value) ? value.value : undefined)

const jsonInputArg = Args.text({ name: "input" }).pipe(
  Args.withDescription("JSON object, @file path, raw JSON string, or - for stdin"),
)

const concurrencyOption = Options.integer("concurrency").pipe(
  Options.optional,
  Options.withDescription(
    `Maximum concurrent draft mutations to run in parallel (default: ${DEFAULT_BATCH_CONCURRENCY})`,
  ),
)

const listDraftsInputSchema = Schema.Struct({
  social_set_id: TypefullyIdentifierSchema,
  status: Schema.optional(DraftStatusSchema),
  tag: Schema.optional(Schema.String),
  order_by: Schema.optional(DraftOrderBySchema),
  limit: Schema.optional(Schema.Number),
  offset: Schema.optional(Schema.Number),
})

type ListDraftsInput = typeof listDraftsInputSchema.Type

const getDraftInputSchema = Schema.Struct({
  social_set_id: TypefullyIdentifierSchema,
  draft_id: TypefullyIdentifierSchema,
})

const createDraftInputSchema = Schema.Struct({
  social_set_id: TypefullyIdentifierSchema,
  platforms: DraftPlatformsSchema,
  draft_title: Schema.optional(Schema.NullOr(Schema.String)),
  scratchpad_text: Schema.optional(Schema.NullOr(Schema.String)),
  tags: Schema.optional(Schema.Array(Schema.String)),
  share: Schema.optional(Schema.Boolean),
  publish_at: Schema.optional(Schema.NullOr(Schema.String)),
})

type CreateDraftInput = typeof createDraftInputSchema.Type

const updateDraftInputSchema = Schema.Struct({
  social_set_id: TypefullyIdentifierSchema,
  draft_id: TypefullyIdentifierSchema,
  platforms: Schema.optional(DraftPlatformsSchema),
  draft_title: Schema.optional(Schema.String),
  scratchpad_text: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
  share: Schema.optional(Schema.Boolean),
  publish_at: Schema.optional(Schema.String),
})

type UpdateDraftInput = typeof updateDraftInputSchema.Type

const deleteDraftInputSchema = Schema.Struct({
  social_set_id: TypefullyIdentifierSchema,
  draft_id: TypefullyIdentifierSchema,
})

type DeleteDraftInput = typeof deleteDraftInputSchema.Type

type BatchMutationResultItem =
  | {
      readonly index: number
      readonly ok: true
      readonly social_set_id?: TypefullyIdentifier
      readonly draft_id?: TypefullyIdentifier
      readonly data: unknown
    }
  | {
      readonly index: number
      readonly ok: false
      readonly social_set_id?: TypefullyIdentifier
      readonly draft_id?: TypefullyIdentifier
      readonly error: ReturnType<typeof toErrorDetails>
    }

interface BatchMutationResult {
  readonly total: number
  readonly success_count: number
  readonly error_count: number
  readonly concurrency: number
  readonly results: ReadonlyArray<BatchMutationResultItem>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const maybeIdentifier = (value: unknown): TypefullyIdentifier | undefined =>
  typeof value === "string" || typeof value === "number" ? value : undefined

const extractBatchTargets = (value: unknown) => {
  if (!isRecord(value)) {
    return {}
  }

  return {
    social_set_id: maybeIdentifier(value.social_set_id),
    draft_id: maybeIdentifier(value.draft_id),
  }
}

const toTargetProps = (targets: {
  readonly social_set_id?: TypefullyIdentifier | undefined
  readonly draft_id?: TypefullyIdentifier | undefined
}) => ({
  ...(targets.social_set_id !== undefined ? { social_set_id: targets.social_set_id } : {}),
  ...(targets.draft_id !== undefined ? { draft_id: targets.draft_id } : {}),
})

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

const validateListInput = (input: ListDraftsInput) =>
  Effect.gen(function* () {
    yield* validateNonNegativeInteger("offset", input.offset)
    yield* validatePositiveInteger("limit", input.limit)

    if (input.limit !== undefined && input.limit > 50) {
      yield* Effect.fail(
        new CommandInputError({
          field: "limit",
          message: "limit must be 50 or less",
        }),
      )
    }
  })

const validatePublishAt = (field: string, value: string | null | undefined) => {
  if (value === undefined || value === null) {
    return Effect.void
  }

  if (value === "now" || value === "next-free-slot" || publishAtIsoPattern.test(value)) {
    return Effect.void
  }

  return Effect.fail(
    new CommandInputError({
      field,
      message: `${field} must be an ISO 8601 datetime, \"now\", or \"next-free-slot\"`,
    }),
  )
}

const validateTags = (_field: string, tags: ReadonlyArray<string> | null | undefined) => {
  if (tags === undefined || tags === null) {
    return Effect.void
  }

  return Effect.void
}

const validatePlatforms = (field: string, platforms: DraftPlatforms) =>
  Effect.gen(function* () {
    const configuredPlatforms = PLATFORM_NAMES.filter((platform) => platforms[platform] !== undefined)

    if (configuredPlatforms.length === 0) {
      yield* Effect.fail(
        new CommandInputError({
          field,
          message: "at least one platform configuration is required",
        }),
      )
    }

    for (const platform of configuredPlatforms) {
      const config = platforms[platform]

      if (!config || config.enabled !== true) {
        continue
      }

      if (config.posts.length === 0) {
        yield* Effect.fail(
          new CommandInputError({
            field: `${field}.${platform}.posts`,
            message: "enabled platforms must include at least one post",
          }),
        )
      }
    }
  })

const validateCreateInput = (input: CreateDraftInput) =>
  Effect.gen(function* () {
    yield* validatePlatforms("platforms", input.platforms)
    yield* validatePublishAt("publish_at", input.publish_at)
    yield* validateTags("tags", input.tags)
  })

const hasUpdatePayload = (input: UpdateDraftInput) =>
  input.platforms !== undefined ||
  input.draft_title !== undefined ||
  input.scratchpad_text !== undefined ||
  input.tags !== undefined ||
  input.share !== undefined ||
  input.publish_at !== undefined

const validateUpdateInput = (input: UpdateDraftInput) =>
  Effect.gen(function* () {
    if (!hasUpdatePayload(input)) {
      yield* Effect.fail(
        new CommandInputError({
          field: "input",
          message:
            "draft updates require at least one of platforms, draft_title, scratchpad_text, tags, share, or publish_at",
        }),
      )
    }

    if (input.platforms !== undefined) {
      yield* validatePlatforms("platforms", input.platforms)
    }

    yield* validatePublishAt("publish_at", input.publish_at)
    yield* validateTags("tags", input.tags)
  })

const buildCreateDraftBody = (input: CreateDraftInput): DraftCreateRequest => ({
  platforms: input.platforms,
  ...(input.draft_title !== undefined ? { draft_title: input.draft_title } : {}),
  ...(input.scratchpad_text !== undefined ? { scratchpad_text: input.scratchpad_text } : {}),
  ...(input.tags !== undefined ? { tags: input.tags } : {}),
  ...(input.share !== undefined ? { share: input.share } : {}),
  ...(input.publish_at !== undefined ? { publish_at: input.publish_at } : {}),
})

const buildUpdateDraftBody = (input: UpdateDraftInput): DraftUpdateRequest => ({
  ...(input.platforms !== undefined ? { platforms: input.platforms } : {}),
  ...(input.draft_title !== undefined ? { draft_title: input.draft_title } : {}),
  ...(input.scratchpad_text !== undefined ? { scratchpad_text: input.scratchpad_text } : {}),
  ...(input.tags !== undefined ? { tags: input.tags } : {}),
  ...(input.share !== undefined ? { share: input.share } : {}),
  ...(input.publish_at !== undefined ? { publish_at: input.publish_at } : {}),
})

const decodeBatchInputItem = <A, I, R>(
  schema: Schema.Schema<A, I, R>,
  value: unknown,
  index: number,
) =>
  Schema.decodeUnknown(schema)(value).pipe(
    Effect.mapError(
      (error) =>
        new JsonInputError({
          source: `item[${index}]`,
          reason: "InvalidShape",
          message: error.message,
        }),
    ),
  )

const loadBatchJsonInput = (input: string) =>
  loadJsonInput(Schema.Unknown, input).pipe(
    Effect.flatMap((value) => {
      if (Array.isArray(value)) {
        return Effect.succeed(value)
      }

      if (isRecord(value)) {
        return Effect.succeed([value])
      }

      return Effect.fail(
        new JsonInputError({
          source: "input",
          reason: "InvalidShape",
          message: "draft mutation input must be a JSON object or array of objects",
        }),
      )
    }),
  )

const summarizeBatchResults = (
  concurrency: number,
  results: ReadonlyArray<BatchMutationResultItem>,
): BatchMutationResult => {
  const error_count = results.filter((result) => !result.ok).length

  return {
    total: results.length,
    success_count: results.length - error_count,
    error_count,
    concurrency,
    results,
  }
}

const runMutationBatch = <A, I, R, S>(options: {
  readonly input: string
  readonly concurrency: number
  readonly itemSchema: Schema.Schema<A, I, R>
  readonly validate: (item: A) => Effect.Effect<void, CommandInputError>
  readonly run: (item: A) => Effect.Effect<S, unknown, R>
  readonly toSuccess: (item: A, result: S, index: number) => BatchMutationResultItem
}) =>
  Effect.gen(function* () {
    yield* validatePositiveInteger("concurrency", options.concurrency)

    const rawItems = yield* loadBatchJsonInput(options.input)
    const results = yield* Effect.forEach(
      rawItems,
      (rawItem, index) =>
        Effect.gen(function* () {
          const item = yield* decodeBatchInputItem(options.itemSchema, rawItem, index)
          yield* options.validate(item)

          const result = yield* options.run(item)
          return options.toSuccess(item, result, index)
        }).pipe(
          Effect.catchAll((error) =>
            Effect.succeed({
              index,
              ok: false as const,
              ...toTargetProps(extractBatchTargets(rawItem)),
              error: toErrorDetails(error),
            }),
          ),
        ),
      { concurrency: options.concurrency },
    )

    const summary = summarizeBatchResults(options.concurrency, results)

    if (summary.error_count > 0) {
      yield* setExitCode(1)
    }

    return summary
  })

const draftsListCommand = Command.make("list", { input: jsonInputArg }, ({ input }) =>
  executeJsonCommand(
    "drafts list",
    Effect.gen(function* () {
      const payload = yield* loadJsonInput(listDraftsInputSchema, input)
      yield* validateListInput(payload)

      const drafts = yield* listDrafts({
        socialSetId: payload.social_set_id,
        ...(payload.limit !== undefined ? { limit: payload.limit } : {}),
        ...(payload.offset !== undefined ? { offset: payload.offset } : {}),
        ...(payload.status !== undefined ? { status: payload.status } : {}),
        ...(payload.tag !== undefined ? { tag: payload.tag } : {}),
        ...(payload.order_by !== undefined ? { orderBy: payload.order_by } : {}),
      })

      return { drafts }
    }),
  ),
).pipe(
  Command.withDescription(
    "List drafts from a JSON input object containing social_set_id and optional filters",
  ),
)

const draftsGetCommand = Command.make("get", { input: jsonInputArg }, ({ input }) =>
  executeJsonCommand(
    "drafts get",
    Effect.gen(function* () {
      const payload = yield* loadJsonInput(getDraftInputSchema, input)
      const draft = yield* getDraft({
        socialSetId: payload.social_set_id,
        draftId: payload.draft_id,
      })

      return { draft }
    }),
  ),
).pipe(
  Command.withDescription("Get a single draft from a JSON input object containing social_set_id and draft_id"),
)

const draftsCreateCommand = Command.make(
  "create",
  {
    input: jsonInputArg,
    concurrency: concurrencyOption,
  },
  ({ input, concurrency }) =>
    executeJsonCommand(
      "drafts create",
      runMutationBatch({
        input,
        concurrency: toUndefined(concurrency) ?? DEFAULT_BATCH_CONCURRENCY,
        itemSchema: createDraftInputSchema,
        validate: validateCreateInput,
        run: (item) =>
          createDraft({
            socialSetId: item.social_set_id,
            body: buildCreateDraftBody(item),
          }),
        toSuccess: (item, draft, index) => ({
          index,
          ok: true,
          social_set_id: item.social_set_id,
          data: draft,
        }),
      }),
    ),
).pipe(
  Command.withDescription(
    "Create one or more drafts from a JSON object or array shaped like the Typefully request body plus social_set_id",
  ),
)

const draftsUpdateCommand = Command.make(
  "update",
  {
    input: jsonInputArg,
    concurrency: concurrencyOption,
  },
  ({ input, concurrency }) =>
    executeJsonCommand(
      "drafts update",
      runMutationBatch({
        input,
        concurrency: toUndefined(concurrency) ?? DEFAULT_BATCH_CONCURRENCY,
        itemSchema: updateDraftInputSchema,
        validate: validateUpdateInput,
        run: (item) =>
          updateDraft({
            socialSetId: item.social_set_id,
            draftId: item.draft_id,
            body: buildUpdateDraftBody(item),
          }),
        toSuccess: (item, draft, index) => ({
          index,
          ok: true,
          social_set_id: item.social_set_id,
          draft_id: item.draft_id,
          data: draft,
        }),
      }),
    ),
).pipe(
  Command.withDescription(
    "Update one or more drafts from a JSON object or array shaped like the Typefully patch body plus social_set_id and draft_id",
  ),
)

const draftsDeleteCommand = Command.make(
  "delete",
  {
    input: jsonInputArg,
    concurrency: concurrencyOption,
  },
  ({ input, concurrency }) =>
    executeJsonCommand(
      "drafts delete",
      runMutationBatch({
        input,
        concurrency: toUndefined(concurrency) ?? DEFAULT_BATCH_CONCURRENCY,
        itemSchema: deleteDraftInputSchema,
        validate: () => Effect.void,
        run: (item) =>
          deleteDraft({
            socialSetId: item.social_set_id,
            draftId: item.draft_id,
          }).pipe(Effect.as({ deleted: true })),
        toSuccess: (item, result, index) => ({
          index,
          ok: true,
          social_set_id: item.social_set_id,
          draft_id: item.draft_id,
          data: result,
        }),
      }),
    ),
).pipe(
  Command.withDescription(
    "Delete one or more drafts from a JSON object or array containing social_set_id and draft_id",
  ),
)

export const draftsCommand = Command.make("drafts").pipe(
  Command.withDescription("Draft workflow commands"),
  Command.withSubcommands([
    draftsListCommand,
    draftsGetCommand,
    draftsCreateCommand,
    draftsUpdateCommand,
    draftsDeleteCommand,
  ]),
)
