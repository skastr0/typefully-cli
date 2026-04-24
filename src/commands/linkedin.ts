import { Args, Command } from "@effect/cli"
import { Effect, Schema } from "effect"

import { CommandInputError } from "../core/errors"
import { loadJsonInput } from "../core/json"
import { executeJsonCommand } from "../core/output"
import { resolveLinkedInOrganization, TypefullyIdentifierSchema } from "../core/typefully"

const jsonInputArg = Args.text({ name: "input" }).pipe(
  Args.withDescription("JSON object, @file path, raw JSON string, or - for stdin"),
)

export const linkedinOrganizationResolveInputSchema = Schema.Struct({
  social_set_id: TypefullyIdentifierSchema,
  organization_url: Schema.String,
})

type LinkedInOrganizationResolveInput = typeof linkedinOrganizationResolveInputSchema.Type

const validateOrganizationUrl = (input: LinkedInOrganizationResolveInput) =>
  Effect.gen(function* () {
    let url: URL

    try {
      url = new URL(input.organization_url)
    } catch {
      yield* Effect.fail(
        new CommandInputError({
          field: "organization_url",
          message: "organization_url must be a valid absolute URL",
        }),
      )
      return
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      yield* Effect.fail(
        new CommandInputError({
          field: "organization_url",
          message: "organization_url must use http or https",
        }),
      )
    }
  })

const linkedinOrganizationsResolveCommand = Command.make(
  "resolve",
  { input: jsonInputArg },
  ({ input }) =>
    executeJsonCommand(
      "linkedin organizations resolve",
      Effect.gen(function* () {
        const payload = yield* loadJsonInput(linkedinOrganizationResolveInputSchema, input)
        yield* validateOrganizationUrl(payload)

        const organization = yield* resolveLinkedInOrganization({
          socialSetId: payload.social_set_id,
          organizationUrl: payload.organization_url,
        })

        return { organization }
      }),
    ),
).pipe(
  Command.withDescription(
    "Resolve a LinkedIn organization URL into metadata you can use in LinkedIn draft mention syntax",
  ),
)

const linkedinOrganizationsCommand = Command.make("organizations").pipe(
  Command.withDescription("LinkedIn organization commands"),
  Command.withSubcommands([linkedinOrganizationsResolveCommand]),
)

export const linkedinCommand = Command.make("linkedin").pipe(
  Command.withDescription("LinkedIn commands"),
  Command.withSubcommands([linkedinOrganizationsCommand]),
)
