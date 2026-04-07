import { Args, Command } from "@effect/cli"
import { Effect, Schema } from "effect"

import { CommandInputError } from "../core/errors"
import { loadJsonInput } from "../core/json"
import { executeJsonCommand } from "../core/output"
import {
  getQueue,
  getQueueSchedule,
  TypefullyIdentifierSchema,
  updateQueueSchedule,
} from "../core/typefully"
import type { QueueScheduleDay, QueueScheduleUpdateRequest } from "../core/typefully"

const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/
const queueScheduleDays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const

const jsonInputArg = Args.text({ name: "input" }).pipe(
  Args.withDescription("JSON object, @file path, raw JSON string, or - for stdin"),
)

const queueGetInputSchema = Schema.Struct({
  social_set_id: TypefullyIdentifierSchema,
  start_date: Schema.String,
  end_date: Schema.String,
})

type QueueGetInput = typeof queueGetInputSchema.Type

const queueScheduleGetInputSchema = Schema.Struct({
  social_set_id: TypefullyIdentifierSchema,
})

const queueScheduleRuleInputSchema = Schema.Struct({
  h: Schema.Number,
  m: Schema.Number,
  days: Schema.Array(Schema.String),
})

type QueueScheduleRuleInput = typeof queueScheduleRuleInputSchema.Type

const queueScheduleUpdateInputSchema = Schema.Struct({
  social_set_id: TypefullyIdentifierSchema,
  rules: Schema.Array(queueScheduleRuleInputSchema),
})

type QueueScheduleUpdateInput = typeof queueScheduleUpdateInputSchema.Type

const isQueueScheduleDay = (value: string): value is QueueScheduleDay =>
  queueScheduleDays.some((day) => day === value)

const invalidDateError = (field: "start_date" | "end_date") =>
  new CommandInputError({
    field,
    message: `${field} must be a valid date string in YYYY-MM-DD format`,
  })

const validateDateString = (field: "start_date" | "end_date", value: string) => {
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

  return Effect.void
}

const validateQueueGetInput = (input: QueueGetInput) =>
  Effect.gen(function* () {
    yield* validateDateString("start_date", input.start_date)
    yield* validateDateString("end_date", input.end_date)
  })

const validateScheduleRule = (rule: QueueScheduleRuleInput, index: number) =>
  Effect.gen(function* () {
    if (!Number.isInteger(rule.h) || rule.h < 0 || rule.h > 23) {
      yield* Effect.fail(
        new CommandInputError({
          field: `rules[${index}].h`,
          message: "h must be an integer between 0 and 23",
        }),
      )
    }

    if (!Number.isInteger(rule.m) || rule.m < 0 || rule.m > 59) {
      yield* Effect.fail(
        new CommandInputError({
          field: `rules[${index}].m`,
          message: "m must be an integer between 0 and 59",
        }),
      )
    }

    if (rule.days.length === 0) {
      yield* Effect.fail(
        new CommandInputError({
          field: `rules[${index}].days`,
          message: "days must contain at least one day",
        }),
      )
    }

    for (const [dayIndex, day] of rule.days.entries()) {
      if (!isQueueScheduleDay(day)) {
        yield* Effect.fail(
          new CommandInputError({
            field: `rules[${index}].days[${dayIndex}]`,
            message: `days must be one of ${queueScheduleDays.join(", ")}`,
          }),
        )
      }
    }
  })

const validateQueueScheduleUpdateInput = (input: QueueScheduleUpdateInput) =>
  Effect.forEach(input.rules, (rule, index) => validateScheduleRule(rule, index)).pipe(Effect.asVoid)

const buildQueueScheduleUpdateBody = (input: QueueScheduleUpdateInput): QueueScheduleUpdateRequest => ({
  rules: input.rules.map((rule) => ({
    h: rule.h,
    m: rule.m,
    days: rule.days.map((day) => day as QueueScheduleDay),
  })),
})

const queueGetCommand = Command.make("get", { input: jsonInputArg }, ({ input }) =>
  executeJsonCommand(
    "queue get",
    Effect.gen(function* () {
      const payload = yield* loadJsonInput(queueGetInputSchema, input)
      yield* validateQueueGetInput(payload)

      const queue = yield* getQueue({
        socialSetId: payload.social_set_id,
        startDate: payload.start_date,
        endDate: payload.end_date,
      })

      return { queue }
    }),
  ),
).pipe(Command.withDescription("Get queue slots and scheduled drafts for a date range"))

const queueScheduleGetCommand = Command.make("get", { input: jsonInputArg }, ({ input }) =>
  executeJsonCommand(
    "queue schedule get",
    Effect.gen(function* () {
      const payload = yield* loadJsonInput(queueScheduleGetInputSchema, input)
      const schedule = yield* getQueueSchedule({ socialSetId: payload.social_set_id })

      return { schedule }
    }),
  ),
).pipe(Command.withDescription("Get queue schedule rules for a social set"))

const queueScheduleUpdateCommand = Command.make("update", { input: jsonInputArg }, ({ input }) =>
  executeJsonCommand(
    "queue schedule update",
    Effect.gen(function* () {
      const payload = yield* loadJsonInput(queueScheduleUpdateInputSchema, input)
      yield* validateQueueScheduleUpdateInput(payload)

      const schedule = yield* updateQueueSchedule({
        socialSetId: payload.social_set_id,
        body: buildQueueScheduleUpdateBody(payload),
      })

      return { schedule }
    }),
  ),
).pipe(Command.withDescription("Replace queue schedule rules for a social set"))

const queueScheduleCommand = Command.make("schedule").pipe(
  Command.withDescription("Queue schedule commands"),
  Command.withSubcommands([queueScheduleGetCommand, queueScheduleUpdateCommand]),
)

export const queueCommand = Command.make("queue").pipe(
  Command.withDescription("Queue inspection and schedule commands"),
  Command.withSubcommands([queueGetCommand, queueScheduleCommand]),
)
