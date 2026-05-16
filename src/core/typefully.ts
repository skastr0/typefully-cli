import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "@effect/platform"
import { Effect, Either, Schema } from "effect"

import {
  readCachedResponse,
  writeCachedResponse,
  type CacheRequestIdentity,
  type TypefullyCacheOptions,
} from "./cache"
import { loadAppConfig, requireApiKey } from "./config"
import { TYPEFULLY_USER_AGENT } from "./constants"
import {
  TypefullyApiError,
  TypefullyDecodeError,
  TypefullyRequestError,
} from "./errors"
import { decodeUnknownJsonText } from "./json"

export const TypefullyIdentifierSchema = Schema.Union(Schema.Number, Schema.String)

export type TypefullyIdentifier = typeof TypefullyIdentifierSchema.Type

const TypefullyTeamSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
})

const SocialSetSummarySchema = Schema.Struct({
  id: TypefullyIdentifierSchema,
  username: Schema.String,
  name: Schema.String,
  profile_image_url: Schema.optional(Schema.NullOr(Schema.String)),
  team: Schema.optional(Schema.NullOr(TypefullyTeamSchema)),
})

const SocialSetPlatformAccountBaseSchema = Schema.Struct({
  username: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  profile_url: Schema.optional(Schema.NullOr(Schema.String)),
  profile_image_url: Schema.optional(Schema.NullOr(Schema.String)),
})

const SocialSetPlatformsSchema = Schema.Struct({
  x: Schema.optional(Schema.NullOr(SocialSetPlatformAccountBaseSchema)),
  linkedin: Schema.optional(Schema.NullOr(SocialSetPlatformAccountBaseSchema)),
  mastodon: Schema.optional(Schema.NullOr(SocialSetPlatformAccountBaseSchema)),
  threads: Schema.optional(Schema.NullOr(SocialSetPlatformAccountBaseSchema)),
  bluesky: Schema.optional(Schema.NullOr(SocialSetPlatformAccountBaseSchema)),
})

export const SocialSetListResponseSchema = Schema.Struct({
  results: Schema.Array(SocialSetSummarySchema),
  count: Schema.Number,
  limit: Schema.Number,
  offset: Schema.Number,
  next: Schema.optional(Schema.NullOr(Schema.String)),
  previous: Schema.optional(Schema.NullOr(Schema.String)),
})

export type SocialSetListResponse = typeof SocialSetListResponseSchema.Type

export const SocialSetDetailResponseSchema = Schema.Struct({
  id: TypefullyIdentifierSchema,
  username: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  profile_image_url: Schema.optional(Schema.NullOr(Schema.String)),
  team: Schema.optional(Schema.NullOr(TypefullyTeamSchema)),
  platforms: Schema.optional(Schema.NullOr(SocialSetPlatformsSchema)),
  publishing_quota: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        used: Schema.Number,
        remaining: Schema.Union(Schema.Number, Schema.Literal("unlimited")),
        resets_at: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
})

export type SocialSetDetailResponse = typeof SocialSetDetailResponseSchema.Type

export const TagSchema = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
  created_at: Schema.String,
})

export type Tag = typeof TagSchema.Type

export const TagListResponseSchema = Schema.Struct({
  results: Schema.Array(TagSchema),
  count: Schema.Number,
  limit: Schema.Number,
  offset: Schema.Number,
  next: Schema.NullOr(Schema.String),
  previous: Schema.NullOr(Schema.String),
})

export type TagListResponse = typeof TagListResponseSchema.Type

export const TagCreateRequestSchema = Schema.Struct({
  name: Schema.String,
})

export type TagCreateRequest = typeof TagCreateRequestSchema.Type

export const TypefullyMeSchema = Schema.Struct({
  id: TypefullyIdentifierSchema,
  name: Schema.optional(Schema.String),
  username: Schema.optional(Schema.String),
  email: Schema.optional(Schema.String),
})

export type TypefullyMe = typeof TypefullyMeSchema.Type

export const DraftStatusSchema = Schema.Literal(
  "draft",
  "scheduled",
  "published",
  "publishing",
  "error",
)

export type DraftStatus = typeof DraftStatusSchema.Type

export const DraftOrderBySchema = Schema.Literal(
  "created_at",
  "-created_at",
  "updated_at",
  "-updated_at",
  "scheduled_date",
  "-scheduled_date",
  "published_at",
  "-published_at",
)

export type DraftOrderBy = typeof DraftOrderBySchema.Type

export const DraftPostSchema = Schema.Struct({
  text: Schema.String,
  media_ids: Schema.optional(Schema.Array(Schema.String)),
  quote_post_url: Schema.optional(Schema.NullOr(Schema.String)),
})

export type DraftPost = typeof DraftPostSchema.Type

const XDraftSettingsSchema = Schema.Struct({
  reply_to_url: Schema.optional(Schema.NullOr(Schema.String)),
  community_id: Schema.optional(Schema.NullOr(Schema.String)),
  share_with_followers: Schema.optional(Schema.NullOr(Schema.Boolean)),
})

const EmptyDraftSettingsSchema = Schema.Struct({})

const DisabledDraftPlatformSchema = Schema.Struct({
  enabled: Schema.Literal(false),
})

const EnabledXDraftPlatformSchema = Schema.Struct({
  enabled: Schema.Literal(true),
  posts: Schema.Array(DraftPostSchema),
  settings: Schema.optional(Schema.NullOr(XDraftSettingsSchema)),
})

const EnabledGenericDraftPlatformSchema = Schema.Struct({
  enabled: Schema.Literal(true),
  posts: Schema.Array(DraftPostSchema),
  settings: Schema.optional(Schema.NullOr(EmptyDraftSettingsSchema)),
})

const XDraftPlatformSchema = Schema.NullOr(
  Schema.Union(EnabledXDraftPlatformSchema, DisabledDraftPlatformSchema),
)

const GenericDraftPlatformSchema = Schema.NullOr(
  Schema.Union(EnabledGenericDraftPlatformSchema, DisabledDraftPlatformSchema),
)

export const DraftPlatformsSchema = Schema.Struct({
  x: Schema.optional(XDraftPlatformSchema),
  linkedin: Schema.optional(GenericDraftPlatformSchema),
  mastodon: Schema.optional(GenericDraftPlatformSchema),
  threads: Schema.optional(GenericDraftPlatformSchema),
  bluesky: Schema.optional(GenericDraftPlatformSchema),
})

export type DraftPlatforms = typeof DraftPlatformsSchema.Type

export const DraftCreateRequestSchema = Schema.Struct({
  platforms: DraftPlatformsSchema,
  draft_title: Schema.optional(Schema.NullOr(Schema.String)),
  scratchpad_text: Schema.optional(Schema.NullOr(Schema.String)),
  tags: Schema.optional(Schema.Array(Schema.String)),
  share: Schema.optional(Schema.Boolean),
  publish_at: Schema.optional(Schema.NullOr(Schema.String)),
})

export type DraftCreateRequest = typeof DraftCreateRequestSchema.Type

export const DraftUpdateRequestSchema = Schema.Struct({
  platforms: Schema.optional(DraftPlatformsSchema),
  draft_title: Schema.optional(Schema.String),
  scratchpad_text: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
  share: Schema.optional(Schema.Boolean),
  publish_at: Schema.optional(Schema.String),
})

export type DraftUpdateRequest = typeof DraftUpdateRequestSchema.Type

const DraftPublishedUrlFields = {
  x_published_url: Schema.optional(Schema.NullOr(Schema.String)),
  linkedin_published_url: Schema.optional(Schema.NullOr(Schema.String)),
  mastodon_published_url: Schema.optional(Schema.NullOr(Schema.String)),
  threads_published_url: Schema.optional(Schema.NullOr(Schema.String)),
  bluesky_published_url: Schema.optional(Schema.NullOr(Schema.String)),
}

const DraftPublishedAtFields = {
  x_post_published_at: Schema.optional(Schema.NullOr(Schema.String)),
  linkedin_post_published_at: Schema.optional(Schema.NullOr(Schema.String)),
  mastodon_post_published_at: Schema.optional(Schema.NullOr(Schema.String)),
  threads_post_published_at: Schema.optional(Schema.NullOr(Schema.String)),
  bluesky_post_published_at: Schema.optional(Schema.NullOr(Schema.String)),
}

const DraftEnabledPlatformFields = {
  x_post_enabled: Schema.optional(Schema.Boolean),
  linkedin_post_enabled: Schema.optional(Schema.Boolean),
  mastodon_post_enabled: Schema.optional(Schema.Boolean),
  threads_post_enabled: Schema.optional(Schema.Boolean),
  bluesky_post_enabled: Schema.optional(Schema.Boolean),
}

const DraftListItemSchema = Schema.Struct({
  id: TypefullyIdentifierSchema,
  preview: Schema.optional(Schema.NullOr(Schema.String)),
  scheduled_date: Schema.optional(Schema.NullOr(Schema.String)),
  draft_title: Schema.optional(Schema.NullOr(Schema.String)),
  social_set_id: TypefullyIdentifierSchema,
  share_url: Schema.optional(Schema.NullOr(Schema.String)),
  private_url: Schema.String,
  status: DraftStatusSchema,
  tags: Schema.Array(Schema.String),
  created_at: Schema.String,
  updated_at: Schema.optional(Schema.NullOr(Schema.String)),
  published_at: Schema.optional(Schema.NullOr(Schema.String)),
  ...DraftEnabledPlatformFields,
  ...DraftPublishedAtFields,
  ...DraftPublishedUrlFields,
})

export type DraftListItem = typeof DraftListItemSchema.Type

export const DraftListResponseSchema = Schema.Struct({
  results: Schema.Array(DraftListItemSchema),
  count: Schema.Number,
  limit: Schema.Number,
  offset: Schema.Number,
  next: Schema.NullOr(Schema.String),
  previous: Schema.NullOr(Schema.String),
})

export type DraftListResponse = typeof DraftListResponseSchema.Type

export const DraftDetailResponseSchema = Schema.Struct({
  id: TypefullyIdentifierSchema,
  social_set_id: TypefullyIdentifierSchema,
  draft_id: Schema.optional(TypefullyIdentifierSchema),
  status: DraftStatusSchema,
  created_at: Schema.String,
  preview: Schema.String,
  private_url: Schema.String,
  platforms: DraftPlatformsSchema,
  updated_at: Schema.optional(Schema.NullOr(Schema.String)),
  scheduled_date: Schema.optional(Schema.NullOr(Schema.String)),
  published_at: Schema.optional(Schema.NullOr(Schema.String)),
  draft_title: Schema.optional(Schema.NullOr(Schema.String)),
  tags: Schema.Array(Schema.String),
  share_url: Schema.optional(Schema.NullOr(Schema.String)),
  scratchpad_text: Schema.optional(Schema.NullOr(Schema.String)),
  ...DraftPublishedUrlFields,
  ...DraftPublishedAtFields,
})

export type DraftDetailResponse = typeof DraftDetailResponseSchema.Type

export const QueueScheduleDaySchema = Schema.Literal(
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
)

export type QueueScheduleDay = typeof QueueScheduleDaySchema.Type

export const QueueScheduleRuleSchema = Schema.Struct({
  h: Schema.Number,
  m: Schema.Number,
  days: Schema.Array(QueueScheduleDaySchema),
})

export type QueueScheduleRule = typeof QueueScheduleRuleSchema.Type

export const QueueScheduleResponseSchema = Schema.Struct({
  social_set_id: TypefullyIdentifierSchema,
  timezone: Schema.String,
  rules: Schema.Array(QueueScheduleRuleSchema),
})

export type QueueScheduleResponse = typeof QueueScheduleResponseSchema.Type

export const QueueScheduleUpdateRequestSchema = Schema.Struct({
  rules: Schema.Array(QueueScheduleRuleSchema),
})

export type QueueScheduleUpdateRequest = typeof QueueScheduleUpdateRequestSchema.Type

const QueueItemSchema = Schema.Struct({
  at: Schema.String,
  kind: Schema.Literal("queue_slot", "custom_time"),
  draft: Schema.optional(Schema.NullOr(DraftListItemSchema)),
})

const QueueDaySchema = Schema.Struct({
  date: Schema.String,
  items: Schema.Array(QueueItemSchema),
})

export const QueueResponseSchema = Schema.Struct({
  social_set_id: TypefullyIdentifierSchema,
  start_date: Schema.String,
  end_date: Schema.String,
  days: Schema.Array(QueueDaySchema),
})

export type QueueResponse = typeof QueueResponseSchema.Type

// Analytics schemas
export const AnalyticsPlatformSchema = Schema.Literal("x")

export type AnalyticsPlatform = typeof AnalyticsPlatformSchema.Type

export const AnalyticsPostSchema = Schema.Struct({
  platform: AnalyticsPlatformSchema,
  post_id: Schema.String,
  created_at: Schema.String,
  preview_text: Schema.String,
  url: Schema.String,
  metrics: Schema.Struct({
    impressions: Schema.Number,
    engagement: Schema.Struct({
      total: Schema.Number,
      likes: Schema.Number,
      comments: Schema.Number,
      shares: Schema.Number,
      quotes: Schema.Number,
      profile_clicks: Schema.Number,
      saves: Schema.optional(Schema.NullOr(Schema.Number)),
      link_clicks: Schema.optional(Schema.NullOr(Schema.Number)),
    }),
  }),
  draft_id: Schema.optional(Schema.NullOr(Schema.Number)),
})

export type AnalyticsPost = typeof AnalyticsPostSchema.Type

export const AnalyticsPostsResponseSchema = Schema.Struct({
  results: Schema.Array(AnalyticsPostSchema),
  limit: Schema.Number,
  offset: Schema.Number,
  next: Schema.NullOr(Schema.String),
  previous: Schema.NullOr(Schema.String),
})

export type AnalyticsPostsResponse = typeof AnalyticsPostsResponseSchema.Type

export const LinkedInOrganizationResponseSchema = Schema.Struct({
  id: Schema.String,
  urn: Schema.String,
  mention_text: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  vanity_name: Schema.optional(Schema.NullOr(Schema.String)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  website: Schema.optional(Schema.NullOr(Schema.String)),
  logo_url: Schema.optional(Schema.NullOr(Schema.String)),
  url: Schema.optional(Schema.NullOr(Schema.String)),
})

export type LinkedInOrganizationResponse = typeof LinkedInOrganizationResponseSchema.Type

export const CreateMediaUploadRequestSchema = Schema.Struct({
  file_name: Schema.String,
})

export type CreateMediaUploadRequest = typeof CreateMediaUploadRequestSchema.Type

export const CreateMediaUploadResponseSchema = Schema.Struct({
  media_id: Schema.String,
  upload_url: Schema.String,
})

export type CreateMediaUploadResponse = typeof CreateMediaUploadResponseSchema.Type

export const MediaStatusSchema = Schema.Literal("processing", "ready", "failed", "error")

export type MediaStatus = typeof MediaStatusSchema.Type

export const MediaStatusResponseSchema = Schema.Struct({
  file_name: Schema.String,
  media_id: Schema.String,
  status: MediaStatusSchema,
  error_reason: Schema.optional(Schema.NullishOr(Schema.Unknown)),
  media_urls: Schema.optional(Schema.NullishOr(Schema.Unknown)),
  mime: Schema.optional(Schema.NullishOr(Schema.Unknown)),
})

export type MediaStatusResponse = typeof MediaStatusResponseSchema.Type

export interface TypefullyAuthStatus {
  readonly configured: boolean
  readonly authenticated: boolean
  readonly api_base_url: string
  readonly auth_path: string
  readonly api_key_source: "env" | "stored" | "none"
  readonly status: number | null
  readonly social_set_count: number
  readonly social_sets_preview?: SocialSetListResponse["results"]
  readonly error?: string
  readonly details?: unknown
}

const authStatus = (value: TypefullyAuthStatus): TypefullyAuthStatus => value

type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE"

interface RequestSpec<A, I, R> {
  readonly method: HttpMethod
  readonly path: string
  readonly query?: Record<string, string | undefined>
  readonly body?: unknown
  readonly responseSchema: Schema.Schema<A, I, R>
  readonly cache?: TypefullyCacheOptions
}

type RawRequestSpec = Omit<RequestSpec<unknown, unknown, never>, "responseSchema">

const toRawRequestSpec = (spec: {
  readonly method: HttpMethod
  readonly path: string
  readonly query?: Record<string, string | undefined>
  readonly body?: unknown
}): RawRequestSpec => ({
  method: spec.method,
  path: spec.path,
  ...(spec.query !== undefined ? { query: spec.query } : {}),
  ...(spec.body !== undefined ? { body: spec.body } : {}),
})

const compactQuery = (query: Record<string, string | undefined> | undefined) => {
  if (!query) {
    return undefined
  }

  return Object.fromEntries(
    Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
}

const baseClient = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient
  const config = yield* loadAppConfig()
  const apiKey = yield* requireApiKey()

  return client.pipe(
    HttpClient.mapRequest((request) =>
      request.pipe(
        HttpClientRequest.prependUrl(config.apiBaseUrl),
        HttpClientRequest.acceptJson,
        HttpClientRequest.bearerToken(apiKey),
        HttpClientRequest.setHeader("user-agent", TYPEFULLY_USER_AGENT),
      ),
    ),
  )
})

const buildRequest = (spec: RawRequestSpec) => {
  const query = compactQuery(spec.query)

  switch (spec.method) {
    case "GET":
      return HttpClientRequest.get(spec.path, { urlParams: query })
    case "POST": {
      const request = HttpClientRequest.post(spec.path, { urlParams: query })
      return spec.body === undefined ? request : request.pipe(HttpClientRequest.bodyUnsafeJson(spec.body))
    }
    case "PATCH": {
      const request = HttpClientRequest.patch(spec.path, { urlParams: query })
      return spec.body === undefined ? request : request.pipe(HttpClientRequest.bodyUnsafeJson(spec.body))
    }
    case "PUT": {
      const request = HttpClientRequest.put(spec.path, { urlParams: query })
      return spec.body === undefined ? request : request.pipe(HttpClientRequest.bodyUnsafeJson(spec.body))
    }
    case "DELETE": {
      const request = HttpClientRequest.del(spec.path, { urlParams: query })
      return spec.body === undefined ? request : request.pipe(HttpClientRequest.bodyUnsafeJson(spec.body))
    }
  }
}

const parseResponseBody = (text: string) =>
  text.trim().length === 0
    ? Effect.succeed<unknown | undefined>(undefined)
    : decodeUnknownJsonText(text, "typefully-response").pipe(
        Effect.catchAll(() => Effect.succeed<unknown>(text)),
      )

const extractApiMessage = (status: number, body: unknown) => {
  if (typeof body === "string" && body.trim().length > 0) {
    return body
  }

  if (body && typeof body === "object") {
    if ("error" in body) {
      const errorValue = body.error

      if (typeof errorValue === "string" && errorValue.trim().length > 0) {
        return errorValue
      }

      if (
        errorValue &&
        typeof errorValue === "object" &&
        "message" in errorValue &&
        typeof errorValue.message === "string" &&
        errorValue.message.trim().length > 0
      ) {
        return errorValue.message
      }
    }

    if ("message" in body && typeof body.message === "string" && body.message.trim().length > 0) {
      return body.message
    }
  }

  return `Typefully API request failed with status ${status}`
}

export const requestTypefullyJson = <A, I, R>(spec: RequestSpec<A, I, R>) =>
  Effect.gen(function* () {
    const rawSpec = toRawRequestSpec(spec)
    const cacheRequest: CacheRequestIdentity | undefined = rawSpec.method === "GET"
      ? rawSpec.query !== undefined
        ? { method: rawSpec.method, path: rawSpec.path, query: compactQuery(rawSpec.query) ?? {} }
        : { method: rawSpec.method, path: rawSpec.path }
      : undefined
    const cached = cacheRequest && spec.cache
      ? yield* readCachedResponse(cacheRequest, spec.responseSchema, spec.cache.maxAgeSeconds)
      : undefined

    if (cached && !spec.cache?.refresh && cached.valid && cached.data !== null) {
      return cached.data
    }

    const client = yield* baseClient
    const request = buildRequest(rawSpec)

    const fetchLive = Effect.gen(function* () {
      const response = yield* client.execute(request).pipe(
        Effect.mapError(
          (error) =>
            new TypefullyRequestError({
              method: spec.method,
              path: spec.path,
              reason: error._tag === "RequestError" ? error.reason : error._tag,
              message: error.message,
            }),
        ),
      )

      const responseText = yield* response.text.pipe(
        Effect.mapError(
          (error) =>
            new TypefullyRequestError({
              method: spec.method,
              path: spec.path,
              reason: error.reason,
              message: error.message,
            }),
        ),
      )

      if (response.status < 200 || response.status >= 300) {
        const body = yield* parseResponseBody(responseText)

        return yield* Effect.fail(
          new TypefullyApiError({
            method: spec.method,
            path: spec.path,
            status: response.status,
            message: extractApiMessage(response.status, body),
            body,
          }),
        )
      }

      if (responseText.trim().length === 0) {
        return yield* Effect.fail(
          new TypefullyDecodeError({
            method: spec.method,
            path: spec.path,
            message: "Typefully returned an empty response body",
          }),
        )
      }

      return yield* Schema.decodeUnknown(Schema.parseJson(spec.responseSchema))(responseText).pipe(
        Effect.mapError(
          (error) =>
            new TypefullyDecodeError({
              method: spec.method,
              path: spec.path,
              message: error.message,
            }),
        ),
      )
    })

    const fetchedResult = yield* Effect.either(fetchLive)

    if (Either.isLeft(fetchedResult)) {
      if (cached && spec.cache?.allowStaleOnError !== false && cached.data !== null) {
        return cached.data
      }

      return yield* Effect.fail(fetchedResult.left)
    }

    const fetched = fetchedResult.right

    if (cacheRequest && spec.cache) {
      yield* writeCachedResponse(cacheRequest, fetched)
    }

    return fetched
  })

export const requestTypefullyNoContent = (spec: RawRequestSpec) =>
  Effect.gen(function* () {
    const client = yield* baseClient
    const request = buildRequest(spec)

    const response = yield* client.execute(request).pipe(
      Effect.mapError(
        (error) =>
          new TypefullyRequestError({
            method: spec.method,
            path: spec.path,
            reason: error._tag === "RequestError" ? error.reason : error._tag,
            message: error.message,
          }),
      ),
    )

    const responseText = yield* response.text.pipe(
      Effect.mapError(
        (error) =>
          new TypefullyRequestError({
            method: spec.method,
            path: spec.path,
            reason: error.reason,
            message: error.message,
          }),
      ),
    )

    if (response.status < 200 || response.status >= 300) {
      const body = yield* parseResponseBody(responseText)

      return yield* Effect.fail(
        new TypefullyApiError({
          method: spec.method,
          path: spec.path,
          status: response.status,
          message: extractApiMessage(response.status, body),
          body,
        }),
      )
    }
  })

export const getMe = () =>
  requestTypefullyJson({
    method: "GET",
    path: "/me",
    responseSchema: TypefullyMeSchema,
  })

export const listSocialSets = (params?: {
  readonly limit?: number
  readonly offset?: number
  readonly cache?: TypefullyCacheOptions
}) =>
  requestTypefullyJson({
    method: "GET",
    path: "/social-sets",
    query: {
      limit: params?.limit !== undefined ? String(params.limit) : undefined,
      offset: params?.offset !== undefined ? String(params.offset) : undefined,
    },
    responseSchema: SocialSetListResponseSchema,
    ...(params?.cache ? { cache: params.cache } : {}),
  })

const toPathId = (value: TypefullyIdentifier) => String(value)

export const getSocialSet = (params: {
  readonly socialSetId: TypefullyIdentifier
  readonly cache?: TypefullyCacheOptions
}) =>
  requestTypefullyJson({
    method: "GET",
    path: `/social-sets/${toPathId(params.socialSetId)}/`,
    responseSchema: SocialSetDetailResponseSchema,
    ...(params.cache ? { cache: params.cache } : {}),
  })

export const listTags = (params: {
  readonly socialSetId: TypefullyIdentifier
  readonly limit?: number
  readonly offset?: number
  readonly cache?: TypefullyCacheOptions
}) =>
  requestTypefullyJson({
    method: "GET",
    path: `/social-sets/${toPathId(params.socialSetId)}/tags`,
    query: {
      limit: params.limit !== undefined ? String(params.limit) : undefined,
      offset: params.offset !== undefined ? String(params.offset) : undefined,
    },
    responseSchema: TagListResponseSchema,
    ...(params.cache ? { cache: params.cache } : {}),
  })

export const createTag = (params: {
  readonly socialSetId: TypefullyIdentifier
  readonly body: TagCreateRequest
}) =>
  requestTypefullyJson({
    method: "POST",
    path: `/social-sets/${toPathId(params.socialSetId)}/tags`,
    body: params.body,
    responseSchema: TagSchema,
  })

export const listDrafts = (params: {
  readonly socialSetId: TypefullyIdentifier
  readonly limit?: number
  readonly offset?: number
  readonly status?: DraftStatus
  readonly tag?: string
  readonly orderBy?: DraftOrderBy
}) =>
  requestTypefullyJson({
    method: "GET",
    path: `/social-sets/${toPathId(params.socialSetId)}/drafts`,
    query: {
      limit: params.limit !== undefined ? String(params.limit) : undefined,
      offset: params.offset !== undefined ? String(params.offset) : undefined,
      status: params.status,
      tag: params.tag,
      order_by: params.orderBy,
    },
    responseSchema: DraftListResponseSchema,
  })

export const getDraft = (params: {
  readonly socialSetId: TypefullyIdentifier
  readonly draftId: TypefullyIdentifier
}) =>
  requestTypefullyJson({
    method: "GET",
    path: `/social-sets/${toPathId(params.socialSetId)}/drafts/${toPathId(params.draftId)}`,
    responseSchema: DraftDetailResponseSchema,
  })

export const createDraft = (params: {
  readonly socialSetId: TypefullyIdentifier
  readonly body: DraftCreateRequest
}) =>
  requestTypefullyJson({
    method: "POST",
    path: `/social-sets/${toPathId(params.socialSetId)}/drafts`,
    body: params.body,
    responseSchema: DraftDetailResponseSchema,
  })

export const updateDraft = (params: {
  readonly socialSetId: TypefullyIdentifier
  readonly draftId: TypefullyIdentifier
  readonly body: DraftUpdateRequest
}) =>
  requestTypefullyJson({
    method: "PATCH",
    path: `/social-sets/${toPathId(params.socialSetId)}/drafts/${toPathId(params.draftId)}`,
    body: params.body,
    responseSchema: DraftDetailResponseSchema,
  })

export const deleteDraft = (params: {
  readonly socialSetId: TypefullyIdentifier
  readonly draftId: TypefullyIdentifier
}) =>
  requestTypefullyNoContent({
    method: "DELETE",
    path: `/social-sets/${toPathId(params.socialSetId)}/drafts/${toPathId(params.draftId)}`,
  })

export const getQueue = (params: {
  readonly socialSetId: TypefullyIdentifier
  readonly startDate: string
  readonly endDate: string
}) =>
  requestTypefullyJson({
    method: "GET",
    path: `/social-sets/${toPathId(params.socialSetId)}/queue`,
    query: {
      start_date: params.startDate,
      end_date: params.endDate,
    },
    responseSchema: QueueResponseSchema,
  })

export const getQueueSchedule = (params: {
  readonly socialSetId: TypefullyIdentifier
}) =>
  requestTypefullyJson({
    method: "GET",
    path: `/social-sets/${toPathId(params.socialSetId)}/queue/schedule`,
    responseSchema: QueueScheduleResponseSchema,
  })

export const updateQueueSchedule = (params: {
  readonly socialSetId: TypefullyIdentifier
  readonly body: QueueScheduleUpdateRequest
}) =>
  requestTypefullyJson({
    method: "PUT",
    path: `/social-sets/${toPathId(params.socialSetId)}/queue/schedule`,
    body: params.body,
    responseSchema: QueueScheduleResponseSchema,
  })

export const getAnalyticsPosts = (params: {
  readonly socialSetId: TypefullyIdentifier
  readonly platform: AnalyticsPlatform
  readonly startDate: string
  readonly endDate: string
  readonly includeReplies?: boolean
  readonly limit?: number
  readonly offset?: number
}) =>
  requestTypefullyJson({
    method: "GET",
    path: `/social-sets/${toPathId(params.socialSetId)}/analytics/${params.platform}/posts`,
    query: {
      start_date: params.startDate,
      end_date: params.endDate,
      include_replies:
        params.includeReplies !== undefined ? String(params.includeReplies) : undefined,
      limit: params.limit !== undefined ? String(params.limit) : undefined,
      offset: params.offset !== undefined ? String(params.offset) : undefined,
    },
    responseSchema: AnalyticsPostsResponseSchema,
  })

export const resolveLinkedInOrganization = (params: {
  readonly socialSetId: TypefullyIdentifier
  readonly organizationUrl: string
}) =>
  requestTypefullyJson({
    method: "GET",
    path: `/social-sets/${toPathId(params.socialSetId)}/linkedin/organizations/resolve`,
    query: {
      organization_url: params.organizationUrl,
    },
    responseSchema: LinkedInOrganizationResponseSchema,
  })

export const createMediaUpload = (params: {
  readonly socialSetId: TypefullyIdentifier
  readonly body: CreateMediaUploadRequest
}) =>
  requestTypefullyJson({
    method: "POST",
    path: `/social-sets/${toPathId(params.socialSetId)}/media/upload`,
    body: params.body,
    responseSchema: CreateMediaUploadResponseSchema,
  })

export const getMediaStatus = (params: {
  readonly socialSetId: TypefullyIdentifier
  readonly mediaId: string
}) =>
  requestTypefullyJson({
    method: "GET",
    path: `/social-sets/${toPathId(params.socialSetId)}/media/${params.mediaId}`,
    responseSchema: MediaStatusResponseSchema,
  })

export const getAuthStatus = Effect.gen(function* () {
  const config = yield* loadAppConfig()

  if (!config.apiKey) {
    return authStatus({
      configured: false,
      authenticated: false,
      api_base_url: config.apiBaseUrl,
      auth_path: config.authPath,
      api_key_source: config.apiKeySource,
      status: null,
      social_set_count: 0,
      error: "TYPEFULLY_API_KEY is not configured and no stored Typefully API key exists",
    })
  }

  return yield* listSocialSets({ limit: 1, offset: 0 }).pipe(
    Effect.map(
      (response) =>
        authStatus({
          configured: true,
          authenticated: true,
          api_base_url: config.apiBaseUrl,
          auth_path: config.authPath,
          api_key_source: config.apiKeySource,
          status: 200,
          social_set_count: response.count,
          social_sets_preview: response.results,
        }),
    ),
    Effect.catchAll((error) => {
      if (error instanceof TypefullyApiError) {
        return Effect.succeed(authStatus({
          configured: true,
          authenticated: false,
          api_base_url: config.apiBaseUrl,
          auth_path: config.authPath,
          api_key_source: config.apiKeySource,
          status: error.status,
          social_set_count: 0,
          error: error.message,
          details: {
            method: error.method,
            path: error.path,
            status: error.status,
            provider_body_omitted: true,
          },
        }))
      }

      if (error instanceof TypefullyRequestError) {
        return Effect.succeed(authStatus({
          configured: true,
          authenticated: false,
          api_base_url: config.apiBaseUrl,
          auth_path: config.authPath,
          api_key_source: config.apiKeySource,
          status: null,
          social_set_count: 0,
          error: error.message,
          details: {
            method: error.method,
            path: error.path,
            reason: error.reason,
          },
        }))
      }

      return Effect.fail(error)
    }),
  )
})

export const AppLayer = FetchHttpClient.layer
