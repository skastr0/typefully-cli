import { Args, Command } from "@effect/cli"
import { Effect, Either } from "effect"

import { analyticsPostsInputSchema } from "./analytics"
import {
  createDraftInputSchema,
  DEFAULT_BATCH_CONCURRENCY,
  deleteDraftInputSchema,
  getDraftInputSchema,
  listDraftsInputSchema,
  updateDraftInputSchema,
} from "./drafts"
import { linkedinOrganizationResolveInputSchema } from "./linkedin"
import { mediaUploadInputSchema } from "./media"
import {
  queueGetInputSchema,
  queueScheduleGetInputSchema,
  queueScheduleUpdateInputSchema,
} from "./queue"
import { socialSetsGetInputSchema, socialSetsListInputSchema } from "./social-sets"
import { tagsCreateInputSchema, tagsListInputSchema } from "./tags"
import { loadAppConfig } from "../core/config"
import {
  CLI_NAME,
  CLI_VERSION,
  TYPEFULLY_API_BASE_URL_ENV,
  TYPEFULLY_API_KEY_ENV,
  TYPEFULLY_ARTIFACT_DIR_ENV,
  TYPEFULLY_AUTH_PATH_ENV,
  TYPEFULLY_CACHE_DIR_ENV,
  TYPEFULLY_HOME_ENV,
} from "../core/constants"
import type { CommandCapability, CommandExample, CommandSchemaContract } from "../core/discovery"
import { renderSchemaContract } from "../core/discovery"
import { CommandInputError } from "../core/errors"
import { executeJsonCommand, toErrorDetails } from "../core/output"
import { getAuthStatus } from "../core/typefully"

const targetArg = Args.text({ name: "target" }).pipe(
  Args.withDescription("Schema id, command id, or command name"),
)

const inputModes = ["inline-json", "@file", "stdin"] as const
const outputModes = ["inline", "artifact", "auto"] as const

const noDurableIdempotency = {
  supported: false,
  strategy:
    "Typefully v2 does not expose documented idempotency keys. The CLI does not emulate durable mutation idempotency because that would overstate retry safety for create/update/delete calls.",
} as const

const schema = (contract: CommandSchemaContract) => contract

const commandSchemas = [
  schema({
    command_id: "social-sets.list",
    command: "social-sets list",
    schema_id: "social-sets.list.input/v1",
    description: "List social sets with optional pagination.",
    schema: socialSetsListInputSchema,
    input_modes: inputModes,
  }),
  schema({
    command_id: "social-sets.get",
    command: "social-sets get",
    schema_id: "social-sets.get.input/v1",
    description: "Get a social set by social_set_id.",
    schema: socialSetsGetInputSchema,
    input_modes: inputModes,
  }),
  schema({
    command_id: "tags.list",
    command: "tags list",
    schema_id: "tags.list.input/v1",
    description: "List tags for a social set with optional pagination.",
    schema: tagsListInputSchema,
    input_modes: inputModes,
  }),
  schema({
    command_id: "tags.create",
    command: "tags create",
    schema_id: "tags.create.input/v1",
    description: "Create a tag for a social set.",
    schema: tagsCreateInputSchema,
    input_modes: inputModes,
  }),
  schema({
    command_id: "drafts.list",
    command: "drafts list",
    schema_id: "drafts.list.input/v1",
    description: "List drafts for a social set with optional filters.",
    schema: listDraftsInputSchema,
    input_modes: inputModes,
  }),
  schema({
    command_id: "drafts.get",
    command: "drafts get",
    schema_id: "drafts.get.input/v1",
    description: "Get one draft by social_set_id and draft_id.",
    schema: getDraftInputSchema,
    input_modes: inputModes,
  }),
  schema({
    command_id: "drafts.create",
    command: "drafts create",
    schema_id: "drafts.create.input/v1",
    description: "Create one or more drafts.",
    schema: createDraftInputSchema,
    accepts_batch: true,
    input_modes: inputModes,
  }),
  schema({
    command_id: "drafts.update",
    command: "drafts update",
    schema_id: "drafts.update.input/v1",
    description: "Update one or more drafts using omit-to-leave-unchanged patch semantics.",
    schema: updateDraftInputSchema,
    accepts_batch: true,
    input_modes: inputModes,
  }),
  schema({
    command_id: "drafts.delete",
    command: "drafts delete",
    schema_id: "drafts.delete.input/v1",
    description: "Delete one or more drafts.",
    schema: deleteDraftInputSchema,
    accepts_batch: true,
    input_modes: inputModes,
  }),
  schema({
    command_id: "queue.get",
    command: "queue get",
    schema_id: "queue.get.input/v1",
    description: "Get queue slots and scheduled drafts for a date range.",
    schema: queueGetInputSchema,
    input_modes: inputModes,
  }),
  schema({
    command_id: "queue.schedule.get",
    command: "queue schedule get",
    schema_id: "queue.schedule.get.input/v1",
    description: "Get queue schedule rules for a social set.",
    schema: queueScheduleGetInputSchema,
    input_modes: inputModes,
  }),
  schema({
    command_id: "queue.schedule.update",
    command: "queue schedule update",
    schema_id: "queue.schedule.update.input/v1",
    description: "Replace queue schedule rules for a social set.",
    schema: queueScheduleUpdateInputSchema,
    input_modes: inputModes,
  }),
  schema({
    command_id: "analytics.posts",
    command: "analytics posts",
    schema_id: "analytics.posts.input/v1",
    description: "Get analytics posts for a social set, platform, and date range.",
    schema: analyticsPostsInputSchema,
    input_modes: inputModes,
  }),
  schema({
    command_id: "linkedin.organizations.resolve",
    command: "linkedin organizations resolve",
    schema_id: "linkedin.organizations.resolve.input/v1",
    description: "Resolve a LinkedIn organization URL for mention syntax.",
    schema: linkedinOrganizationResolveInputSchema,
    input_modes: inputModes,
  }),
  schema({
    command_id: "media.upload",
    command: "media upload",
    schema_id: "media.upload.input/v1",
    description: "Upload media from a local file and optionally wait for processing readiness.",
    schema: mediaUploadInputSchema,
    input_modes: inputModes,
  }),
] satisfies readonly CommandSchemaContract[]

const commandExamples = [
  {
    command_id: "social-sets.list",
    command: "social-sets list",
    name: "list social sets from file",
    args: ["social-sets", "list", "@examples/social-sets/list.json"],
    input: { limit: 10, offset: 0 },
  },
  {
    command_id: "social-sets.get",
    command: "social-sets get",
    name: "get social set from file",
    args: ["social-sets", "get", "@examples/social-sets/get.json"],
    input: { social_set_id: 123 },
  },
  {
    command_id: "tags.list",
    command: "tags list",
    name: "list tags from file",
    args: ["tags", "list", "@examples/tags/list.json"],
    input: { social_set_id: 123, limit: 10, offset: 0 },
  },
  {
    command_id: "tags.create",
    command: "tags create",
    name: "create tag from file",
    args: ["tags", "create", "@examples/tags/create.json"],
    input: { social_set_id: 123, name: "launch" },
  },
  {
    command_id: "drafts.list",
    command: "drafts list",
    name: "list drafts from file",
    args: ["drafts", "list", "@examples/drafts/list.json", "--output", "auto"],
  },
  {
    command_id: "drafts.create",
    command: "drafts create",
    name: "create draft batch from file",
    args: ["drafts", "create", "@examples/drafts/create-batch.json", "--concurrency", "2"],
  },
  {
    command_id: "drafts.update",
    command: "drafts update",
    name: "update draft batch from file",
    args: ["drafts", "update", "@examples/drafts/update-batch.json", "--concurrency", "2"],
  },
  {
    command_id: "drafts.delete",
    command: "drafts delete",
    name: "delete draft batch from file",
    args: ["drafts", "delete", "@examples/drafts/delete-batch.json", "--concurrency", "2"],
  },
  {
    command_id: "queue.get",
    command: "queue get",
    name: "get queue as artifact",
    args: ["queue", "get", "@examples/queue/get.json", "--output", "artifact"],
  },
  {
    command_id: "queue.schedule.update",
    command: "queue schedule update",
    name: "replace schedule from file",
    args: ["queue", "schedule", "update", "@examples/queue/schedule-update.json"],
  },
  {
    command_id: "analytics.posts",
    command: "analytics posts",
    name: "write analytics posts artifact",
    args: ["analytics", "posts", "@examples/analytics/posts.json", "--output", "artifact"],
  },
  {
    command_id: "linkedin.organizations.resolve",
    command: "linkedin organizations resolve",
    name: "resolve LinkedIn organization from file",
    args: ["linkedin", "organizations", "resolve", "@examples/linkedin/organizations-resolve.json"],
  },
  {
    command_id: "media.upload",
    command: "media upload",
    name: "upload media from file",
    args: ["media", "upload", "@examples/media/upload.json"],
  },
] satisfies readonly CommandExample[]

const schemaByCommandId = new Map(commandSchemas.map((entry) => [entry.command_id, entry]))

const workflowCapabilities = [
  capability("social-sets.list", "workflow", "List Typefully social sets.", { output: true }),
  capability("social-sets.get", "workflow", "Get Typefully social set details."),
  capability("tags.list", "workflow", "List tags for a social set.", { output: true }),
  capability("tags.create", "workflow", "Create a tag for a social set."),
  capability("drafts.list", "workflow", "List drafts with optional filters.", { output: true }),
  capability("drafts.get", "workflow", "Get one draft."),
  capability("drafts.create", "workflow", "Create one or more drafts.", { batch: true, idempotency: true }),
  capability("drafts.update", "workflow", "Update one or more drafts.", { batch: true, idempotency: true }),
  capability("drafts.delete", "workflow", "Delete one or more drafts.", { batch: true, idempotency: true }),
  capability("queue.get", "workflow", "Inspect queue slots and scheduled drafts.", { output: true }),
  capability("queue.schedule.get", "workflow", "Get queue schedule rules."),
  capability("queue.schedule.update", "workflow", "Replace queue schedule rules."),
  capability("analytics.posts", "workflow", "Read post analytics.", { output: true }),
  capability("linkedin.organizations.resolve", "workflow", "Resolve LinkedIn organization mentions."),
  capability("media.upload", "workflow", "Upload media and optionally wait for readiness.", {
    output: true,
    idempotency: true,
  }),
] satisfies readonly CommandCapability[]

const discoveryCapabilities = [
  {
    command_id: "doctor",
    command: "doctor",
    category: "diagnostic",
    description: "Inspect local runtime, configuration, and Typefully API readiness.",
  },
  {
    command_id: "capabilities",
    command: "capabilities",
    category: "discovery",
    description: "Describe supported Typefully CLI protocol features and commands.",
  },
  {
    command_id: "cache.status",
    command: "cache status",
    category: "diagnostic",
    description: "Inspect the local Typefully response cache.",
  },
  {
    command_id: "cache.clear",
    command: "cache clear",
    category: "diagnostic",
    description: "Clear the local Typefully response cache.",
  },
  {
    command_id: "schema.list",
    command: "schema list",
    category: "discovery",
    description: "List JSON input schemas exposed by commands.",
  },
  {
    command_id: "schema.show",
    command: "schema show",
    category: "discovery",
    description: "Show one JSON input schema by schema id, command id, or command name.",
  },
  {
    command_id: "examples.list",
    command: "examples list",
    category: "discovery",
    description: "List executable command examples.",
  },
  {
    command_id: "examples.show",
    command: "examples show",
    category: "discovery",
    description: "Show examples for one command by command id or command name.",
  },
] satisfies readonly CommandCapability[]

const commandCapabilities = [...workflowCapabilities, ...discoveryCapabilities]

function capability(
  commandId: string,
  category: CommandCapability["category"],
  description: string,
  options: {
    readonly batch?: boolean
    readonly output?: boolean
    readonly idempotency?: boolean
  } = {},
): CommandCapability {
  const schemaContract = schemaByCommandId.get(commandId)
  const examples = commandExamples.filter((example) => example.command_id === commandId)

  return {
    command_id: commandId,
    command: schemaContract?.command ?? commandId.replace(/\./g, " "),
    category,
    description,
    ...(schemaContract ? { schemas: [schemaContract] } : {}),
    ...(examples.length > 0 ? { examples } : {}),
    ...(options.batch
      ? {
          batch: {
            accepts_batch: true,
            default_concurrency: DEFAULT_BATCH_CONCURRENCY,
            supports_concurrency_option: true,
            partial_failure_exit_code: 1,
          },
        }
      : {}),
    ...(options.output
      ? {
          output: {
            modes: outputModes,
            default_mode: "inline" as const,
          },
        }
      : {}),
    ...(options.idempotency ? { idempotency: noDurableIdempotency } : {}),
  }
}

const matchesTarget = (
  target: string,
  entry: { readonly command_id: string; readonly command: string; readonly schema_id?: string },
) => {
  const normalized = target.trim()

  return (
    entry.command_id === normalized ||
    entry.command === normalized ||
    entry.schema_id === normalized
  )
}

const renderCapability = (capability: CommandCapability) => ({
  command_id: capability.command_id,
  command: capability.command,
  category: capability.category,
  description: capability.description,
  ...(capability.schemas
    ? {
        schemas: capability.schemas.map((entry) => ({
          schema_id: entry.schema_id,
          description: entry.description,
          accepts_batch: entry.accepts_batch ?? false,
        })),
      }
    : {}),
  ...(capability.examples
    ? {
        examples: capability.examples.map((example) => ({
          name: example.name,
          ...(example.description ? { description: example.description } : {}),
        })),
      }
    : {}),
  ...(capability.batch ? { batch: capability.batch } : {}),
  ...(capability.output ? { output: capability.output } : {}),
  ...(capability.idempotency ? { idempotency: capability.idempotency } : {}),
})

const compactExample = (example: CommandExample) => ({
  command_id: example.command_id,
  command: example.command,
  name: example.name,
  ...(example.description ? { description: example.description } : {}),
})

const renderExample = (example: CommandExample) => ({
  name: example.name,
  ...(example.description ? { description: example.description } : {}),
  ...(example.args ? { args: example.args } : {}),
  ...(example.input !== undefined ? { input: example.input } : {}),
})

const doctorReport = Effect.gen(function* () {
  const configResult = yield* Effect.either(loadAppConfig())
  const hasApiKey = Either.isRight(configResult) && configResult.right.apiKeySource !== "none"

  const apiKeyCheck = {
    name: "config.api_key",
    ok: hasApiKey,
    details: {
      env_var: TYPEFULLY_API_KEY_ENV,
      source: Either.isRight(configResult) ? configResult.right.apiKeySource : "unknown",
      auth_path: Either.isRight(configResult) ? configResult.right.authPath : undefined,
      required_for: ["API-backed workflow commands"],
      hint: hasApiKey
        ? "API key is configured."
        : `Run auth set, auth import-env, or set ${TYPEFULLY_API_KEY_ENV} before API-backed commands.`,
      retryable: false,
    },
  }

  if (Either.isLeft(configResult)) {
    const checks = [
      {
        name: "config.api_base_url",
        ok: false,
        details: toErrorDetails(configResult.left),
      },
      apiKeyCheck,
      {
        name: "api.auth",
        ok: false,
        skipped: true,
        details: {
          hint: "Fix TYPEFULLY_API_BASE_URL before probing the Typefully API.",
          retryable: false,
        },
      },
    ]

    return {
      cli: {
        name: CLI_NAME,
        version: CLI_VERSION,
      },
      runtime: {
        name: "bun",
        version: Bun.version,
      },
      status: "attention_required",
      checks,
    }
  }

  const authStatus = yield* getAuthStatus
  const checks = [
    {
      name: "config.api_base_url",
      ok: true,
      details: {
        env_var: TYPEFULLY_API_BASE_URL_ENV,
        value: configResult.right.apiBaseUrl,
      },
    },
    apiKeyCheck,
    {
      name: "api.auth",
      ok: authStatus.authenticated,
      details: {
        configured: authStatus.configured,
        authenticated: authStatus.authenticated,
        api_base_url: authStatus.api_base_url,
        auth_path: authStatus.auth_path,
        api_key_source: authStatus.api_key_source,
        status: authStatus.status,
        ...(authStatus.error ? { error: authStatus.error } : {}),
        ...(authStatus.details ? { provider_details: authStatus.details } : {}),
        retryable: authStatus.configured && !authStatus.authenticated,
      },
    },
  ]

  return {
    cli: {
      name: CLI_NAME,
      version: CLI_VERSION,
    },
    runtime: {
      name: "bun",
      version: Bun.version,
    },
    status: checks.every((check) => check.ok) ? "ok" : "attention_required",
    checks,
  }
})

const capabilities = Effect.succeed({
  cli: {
    name: CLI_NAME,
    version: CLI_VERSION,
  },
  protocol_version: "agentic-cli/typefully/v1",
  api: {
    provider: "typefully",
    base_url_env: TYPEFULLY_API_BASE_URL_ENV,
    api_key_env: TYPEFULLY_API_KEY_ENV,
    auth_path_env: TYPEFULLY_AUTH_PATH_ENV,
    supported_features: [
      "auth status",
      "social sets",
      "tags",
      "drafts",
      "queue",
      "analytics posts",
      "LinkedIn organization resolution",
      "media upload with readiness polling",
    ],
  },
  input_modes: inputModes,
  output: {
    success: { stream: "stdout", envelope: "{ ok: true, command, data }" },
    failure: { stream: "stderr", envelope: "{ ok: false, command, error }" },
    large_response_modes: outputModes,
  },
  batch: {
    outcome_values: ["succeeded", "partial_failure", "failed"],
    default_concurrency: DEFAULT_BATCH_CONCURRENCY,
    partial_failure_exit_code: 1,
    result_order: "input order is preserved",
  },
  idempotency: noDurableIdempotency,
  artifacts: {
    policy: "Use --output inline|artifact|auto on list, analytics, queue, and media diagnostic commands.",
    env_var: TYPEFULLY_ARTIFACT_DIR_ENV,
    default_location: "~/.typefully/artifacts",
  },
  cache: {
    policy:
      "Stable read commands can reuse schema-tagged local response cache files. Pass --refresh to force a provider request and --stale-if-error to return cached data after a refresh failure.",
    env_var: TYPEFULLY_CACHE_DIR_ENV,
    ttl_env_var: "TYPEFULLY_CACHE_TTL_SECONDS",
    default_location: "~/.typefully/cache",
    cached_commands: ["social-sets list", "social-sets get", "tags list"],
  },
  runtime_paths: {
    home_env: TYPEFULLY_HOME_ENV,
    auth_path_env: TYPEFULLY_AUTH_PATH_ENV,
    cache_dir_env: TYPEFULLY_CACHE_DIR_ENV,
    artifact_dir_env: TYPEFULLY_ARTIFACT_DIR_ENV,
    default_home: "~/.typefully",
    default_auth_path: "~/.typefully/auth.json",
    default_cache_dir: "~/.typefully/cache",
    default_artifact_dir: "~/.typefully/artifacts",
  },
  discovery: {
    commands: discoveryCapabilities.map((capability) => capability.command),
  },
  commands: commandCapabilities.map(renderCapability),
})

const listSchemas = Effect.succeed({
  schemas: commandSchemas.map((entry) => ({
    command_id: entry.command_id,
    command: entry.command,
    schema_id: entry.schema_id,
    description: entry.description,
    accepts_batch: entry.accepts_batch ?? false,
  })),
})

const showSchema = (target: string) =>
  Effect.gen(function* () {
    const schemaContract = commandSchemas.find((entry) => matchesTarget(target, entry))

    if (!schemaContract) {
      return yield* Effect.fail(
        new CommandInputError({
          field: "target",
          message: `No schema found for ${target}`,
        }),
      )
    }

    return renderSchemaContract(schemaContract)
  })

const listExamples = Effect.succeed({
  examples: commandExamples.map(compactExample),
})

const showExamples = (target: string) =>
  Effect.gen(function* () {
    const examples = commandExamples.filter((entry) => matchesTarget(target, entry))
    const first = examples[0]

    if (!first) {
      return yield* Effect.fail(
        new CommandInputError({
          field: "target",
          message: `No examples found for ${target}`,
        }),
      )
    }

    return {
      command_id: first.command_id,
      command: first.command,
      examples: examples.map(renderExample),
    }
  })

export const doctorCommand = Command.make("doctor", {}, () =>
  executeJsonCommand("doctor", doctorReport),
).pipe(Command.withDescription("Inspect local runtime, configuration, and Typefully API readiness"))

export const capabilitiesCommand = Command.make("capabilities", {}, () =>
  executeJsonCommand("capabilities", capabilities),
).pipe(Command.withDescription("Describe supported Typefully CLI protocol features and commands"))

const schemaListCommand = Command.make("list", {}, () =>
  executeJsonCommand("schema list", listSchemas),
).pipe(Command.withDescription("List JSON input schemas exposed by commands"))

const schemaShowCommand = Command.make("show", { target: targetArg }, ({ target }) =>
  executeJsonCommand("schema show", showSchema(target)),
).pipe(Command.withDescription("Show one JSON input schema"))

export const schemaCommand = Command.make("schema").pipe(
  Command.withDescription("Schema discovery commands"),
  Command.withSubcommands([schemaListCommand, schemaShowCommand]),
)

const examplesListCommand = Command.make("list", {}, () =>
  executeJsonCommand("examples list", listExamples),
).pipe(Command.withDescription("List executable command examples"))

const examplesShowCommand = Command.make("show", { target: targetArg }, ({ target }) =>
  executeJsonCommand("examples show", showExamples(target)),
).pipe(Command.withDescription("Show examples for one command"))

export const examplesCommand = Command.make("examples").pipe(
  Command.withDescription("Example discovery commands"),
  Command.withSubcommands([examplesListCommand, examplesShowCommand]),
)
