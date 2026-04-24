import { Args, Command, Options } from "@effect/cli"
import { Effect, Schema } from "effect"

import { applyOutputPolicy, OUTPUT_MODE_VALUES } from "../core/artifacts"
import { CommandInputError } from "../core/errors"
import { loadJsonInput } from "../core/json"
import { executeJsonCommand } from "../core/output"
import {
  AnalyticsPlatformSchema,
  getAnalyticsPosts,
  TypefullyIdentifierSchema,
} from "../core/typefully"

const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/

const jsonInputArg = Args.text({ name: "input" }).pipe(
  Args.withDescription("JSON object, @file path, raw JSON string, or - for stdin"),
)

const outputOption = Options.choice("output", OUTPUT_MODE_VALUES).pipe(
  Options.withDefault("inline"),
  Options.withDescription("Output policy for potentially large responses: inline, artifact, or auto"),
)

export const analyticsPostsInputSchema = Schema.Struct({
  social_set_id: TypefullyIdentifierSchema,
  platform: AnalyticsPlatformSchema,
  start_date: Schema.String,
  end_date: Schema.String,
  include_replies: Schema.optional(Schema.Boolean),
  limit: Schema.optional(Schema.Number),
  offset: Schema.optional(Schema.Number),
})

type AnalyticsPostsInput = typeof analyticsPostsInputSchema.Type

const invalidDateError = (field: "start_date" | "end_date") =>
  new CommandInputError({
    field,
    message: `${field} must be a valid date string in YYYY-MM-DD format`,
  })

const parseCalendarDate = (field: "start_date" | "end_date", value: string) => {
  const match = datePattern.exec(value)

  if (!match) {
    return Effect.fail(invalidDateError(field))
  }

  const [, yearText, monthText, dayText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const date = new Date(Date.UTC(year, month - 1, day))

  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return Effect.fail(invalidDateError(field))
  }

  return Effect.succeed(date)
}

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

const validateAnalyticsPostsInput = (input: AnalyticsPostsInput) =>
  Effect.gen(function* () {
    const startDate = yield* parseCalendarDate("start_date", input.start_date)
    const endDate = yield* parseCalendarDate("end_date", input.end_date)

    yield* validatePositiveInteger("limit", input.limit)
    yield* validateNonNegativeInteger("offset", input.offset)

    if (startDate.getTime() > endDate.getTime()) {
      yield* Effect.fail(
        new CommandInputError({
          field: "end_date",
          message: "end_date must be on or after start_date",
        }),
      )
    }
  })

const analyticsPostsCommand = Command.make(
  "posts",
  { input: jsonInputArg, output: outputOption },
  ({ input, output }) =>
  executeJsonCommand(
    "analytics posts",
    Effect.gen(function* () {
      const payload = yield* loadJsonInput(analyticsPostsInputSchema, input)
      yield* validateAnalyticsPostsInput(payload)

      const posts = yield* getAnalyticsPosts({
        socialSetId: payload.social_set_id,
        platform: payload.platform,
        startDate: payload.start_date,
        endDate: payload.end_date,
        ...(payload.include_replies !== undefined
          ? { includeReplies: payload.include_replies }
          : {}),
        ...(payload.limit !== undefined ? { limit: payload.limit } : {}),
        ...(payload.offset !== undefined ? { offset: payload.offset } : {}),
      })

      return yield* applyOutputPolicy({
        outputMode: output,
        command: "analytics posts",
        data: { posts },
        artifactKey: "analytics.posts",
        artifactLabel: "analytics posts response",
        summary: `Wrote ${posts.results.length} records from analytics posts to an artifact.`,
      })
    }),
  ),
).pipe(
  Command.withDescription(
    "Get analytics posts for a social set, platform, and date range from a JSON input object",
  ),
)

export const analyticsCommand = Command.make("analytics").pipe(
  Command.withDescription("Analytics commands"),
  Command.withSubcommands([analyticsPostsCommand]),
)
