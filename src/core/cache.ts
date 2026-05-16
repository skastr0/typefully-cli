import { FileSystem } from "@effect/platform"
import { createHash, randomUUID } from "node:crypto"
import { join } from "node:path"

import { Effect, Either, Schema } from "effect"

import {
  TYPEFULLY_CACHE_TTL_SECONDS_ENV,
  TYPEFULLY_DEFAULT_CACHE_TTL_SECONDS,
} from "./constants"
import { loadAppConfig, requireApiKey } from "./config"
import { CacheReadError, CacheRemoveError, CacheWriteError } from "./errors"
import { resolveRuntimePaths } from "./runtime-paths"

export interface TypefullyCacheOptions {
  readonly refresh?: boolean
  readonly maxAgeSeconds?: number
  readonly allowStaleOnError?: boolean
}

export interface CacheRequestIdentity {
  readonly method: "GET"
  readonly path: string
  readonly query?: Record<string, string | undefined>
}

export interface CacheReadResult<A> extends CacheStatus {
  readonly data: A | null
}

export interface CacheStatus {
  readonly enabled: true
  readonly path: string
  readonly snapshot_directory: string
  readonly snapshot_count: number
  readonly exists: boolean
  readonly valid: boolean
  readonly fresh: boolean
  readonly stale: boolean
  readonly cached_at: string | null
  readonly age_seconds: number | null
  readonly ttl_seconds: number
  readonly error: string | null
}

const CachedResponseFileSchema = Schema.Struct({
  schema_id: Schema.Literal("typefully/response-cache/v1"),
  provider: Schema.Literal("typefully"),
  api_base_url: Schema.String,
  auth_scope_hash: Schema.String,
  request: Schema.Struct({
    method: Schema.Literal("GET"),
    path: Schema.String,
    query: Schema.Record({ key: Schema.String, value: Schema.String }),
  }),
  cached_at: Schema.String,
  data: Schema.Unknown,
})

type CachedResponseFile = typeof CachedResponseFileSchema.Type

interface CacheLocation {
  readonly directory: string
  readonly key: string
  readonly latestPath: string
  readonly snapshotDirectory: string
}

const platformErrorReason = (error: { readonly _tag?: string; readonly reason?: unknown }) =>
  typeof error.reason === "string" ? error.reason : error._tag ?? "PlatformError"

const compactQuery = (query: Record<string, string | undefined> | undefined) =>
  Object.fromEntries(
    Object.entries(query ?? {})
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .sort(([left], [right]) => left.localeCompare(right)),
  )

const resolveCacheTtlSeconds = (maxAgeSeconds?: number) => {
  if (maxAgeSeconds !== undefined) {
    return Number.isFinite(maxAgeSeconds) && maxAgeSeconds >= 0
      ? maxAgeSeconds
      : TYPEFULLY_DEFAULT_CACHE_TTL_SECONDS
  }

  const rawValue = Bun.env[TYPEFULLY_CACHE_TTL_SECONDS_ENV]?.trim()

  if (!rawValue) {
    return TYPEFULLY_DEFAULT_CACHE_TTL_SECONDS
  }

  const parsed = Number.parseInt(rawValue, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : TYPEFULLY_DEFAULT_CACHE_TTL_SECONDS
}

const stableJson = (value: unknown) => JSON.stringify(value)

const hash = (value: string) => createHash("sha256").update(value).digest("hex")

const resolveLocation = Effect.fn("TypefullyCache.resolveLocation")(function* (
  request: CacheRequestIdentity,
) {
  const config = yield* loadAppConfig()
  const apiKey = yield* requireApiKey()
  const query = compactQuery(request.query)
  const authScopeHash = hash(apiKey).slice(0, 16)
  const key = hash(
    stableJson({
      api_base_url: config.apiBaseUrl,
      auth_scope_hash: authScopeHash,
      request: {
        method: request.method,
        path: request.path,
        query,
      },
    }),
  ).slice(0, 24)
  const directory = join(resolveRuntimePaths().cacheDir, "responses")

  return {
    directory,
    key,
    latestPath: join(directory, `typefully-response-${key}.json`),
    snapshotDirectory: join(directory, "snapshots"),
  } satisfies CacheLocation
})

const countSnapshots = Effect.fn("TypefullyCache.countSnapshots")(function* (location: CacheLocation) {
  const fileSystem = yield* FileSystem.FileSystem
  const exists = yield* fileSystem.exists(location.snapshotDirectory).pipe(
    Effect.mapError((error) =>
      new CacheReadError({
        path: location.snapshotDirectory,
        reason: platformErrorReason(error),
        message: error.message,
      }),
    ),
  )

  if (!exists) {
    return 0
  }

  const entries = yield* fileSystem.readDirectory(location.snapshotDirectory).pipe(
    Effect.mapError((error) =>
      new CacheReadError({
        path: location.snapshotDirectory,
        reason: platformErrorReason(error),
        message: error.message,
      }),
    ),
  )

  return entries.filter((entry) => entry.startsWith(`typefully-response-${location.key}-`) && entry.endsWith(".json"))
    .length
})

const emptyReadResult = <A>(
  location: CacheLocation,
  ttlSeconds: number,
  snapshotCount: number,
  exists: boolean,
): CacheReadResult<A> => ({
  enabled: true,
  path: location.latestPath,
  snapshot_directory: location.snapshotDirectory,
  snapshot_count: snapshotCount,
  exists,
  valid: false,
  fresh: false,
  stale: exists,
  cached_at: null,
  age_seconds: null,
  ttl_seconds: ttlSeconds,
  error: null,
  data: null,
})

const snapshotPathFor = (location: CacheLocation, cachedAt: string, snapshotId: string) =>
  join(
    location.snapshotDirectory,
    `typefully-response-${location.key}-${cachedAt.replace(/[:.]/g, "-")}-${snapshotId}.json`,
  )

const matchesRequest = (cached: CachedResponseFile, request: CacheRequestIdentity, apiBaseUrl: string, apiKey: string) =>
  cached.api_base_url === apiBaseUrl &&
  cached.auth_scope_hash === hash(apiKey).slice(0, 16) &&
  cached.request.method === request.method &&
  cached.request.path === request.path &&
  stableJson(cached.request.query) === stableJson(compactQuery(request.query))

export const readCachedResponse = Effect.fn("TypefullyCache.readCachedResponse")(function* <A, I, R>(
  request: CacheRequestIdentity,
  responseSchema: Schema.Schema<A, I, R>,
  maxAgeSeconds?: number,
) {
  const fileSystem = yield* FileSystem.FileSystem
  const config = yield* loadAppConfig()
  const apiKey = yield* requireApiKey()
  const location = yield* resolveLocation(request)
  const ttlSeconds = resolveCacheTtlSeconds(maxAgeSeconds)
  const snapshotCount = yield* countSnapshots(location)
  const exists = yield* fileSystem.exists(location.latestPath).pipe(
    Effect.mapError((error) =>
      new CacheReadError({
        path: location.latestPath,
        reason: platformErrorReason(error),
        message: error.message,
      }),
    ),
  )

  if (!exists) {
    return emptyReadResult<A>(location, ttlSeconds, snapshotCount, false)
  }

  const text = yield* fileSystem.readFileString(location.latestPath).pipe(
    Effect.mapError((error) =>
      new CacheReadError({
        path: location.latestPath,
        reason: platformErrorReason(error),
        message: error.message,
      }),
    ),
  )
  const decoded = yield* Schema.decodeUnknown(Schema.parseJson(CachedResponseFileSchema))(text).pipe(Effect.either)

  if (Either.isLeft(decoded) || !matchesRequest(decoded.right, request, config.apiBaseUrl, apiKey)) {
    return {
      ...emptyReadResult<A>(location, ttlSeconds, snapshotCount, true),
      error: Either.isLeft(decoded) ? decoded.left.message : "Cache file does not match request scope",
    } satisfies CacheReadResult<A>
  }

  const data = yield* Schema.decodeUnknown(responseSchema)(decoded.right.data).pipe(Effect.either)

  if (Either.isLeft(data)) {
    return {
      ...emptyReadResult<A>(location, ttlSeconds, snapshotCount, true),
      error: data.left.message,
    } satisfies CacheReadResult<A>
  }

  const cachedAtMs = Date.parse(decoded.right.cached_at)
  const ageSeconds = Number.isFinite(cachedAtMs)
    ? Math.max(0, Math.floor((Date.now() - cachedAtMs) / 1000))
    : null
  const fresh = ageSeconds !== null && ageSeconds <= ttlSeconds

  return {
    enabled: true,
    path: location.latestPath,
    snapshot_directory: location.snapshotDirectory,
    snapshot_count: snapshotCount,
    exists: true,
    valid: true,
    fresh,
    stale: !fresh,
    cached_at: decoded.right.cached_at,
    age_seconds: ageSeconds,
    ttl_seconds: ttlSeconds,
    error: null,
    data: data.right,
  } satisfies CacheReadResult<A>
})

export const writeCachedResponse = Effect.fn("TypefullyCache.writeCachedResponse")(function* (
  request: CacheRequestIdentity,
  data: unknown,
) {
  const fileSystem = yield* FileSystem.FileSystem
  const config = yield* loadAppConfig()
  const apiKey = yield* requireApiKey()
  const location = yield* resolveLocation(request)
  const cachedAt = new Date().toISOString()
  const snapshotPath = snapshotPathFor(location, cachedAt, randomUUID())
  const tempPath = `${location.latestPath}.${process.pid}.${randomUUID()}.tmp`
  const tempSnapshotPath = `${snapshotPath}.${process.pid}.${randomUUID()}.tmp`
  const cacheFile = {
    schema_id: "typefully/response-cache/v1",
    provider: "typefully",
    api_base_url: config.apiBaseUrl,
    auth_scope_hash: hash(apiKey).slice(0, 16),
    request: {
      method: request.method,
      path: request.path,
      query: compactQuery(request.query),
    },
    cached_at: cachedAt,
    data,
  } satisfies CachedResponseFile
  const serialized = `${JSON.stringify(cacheFile, null, 2)}\n`

  return yield* Effect.gen(function* () {
    yield* fileSystem.makeDirectory(location.directory, { recursive: true })
    yield* fileSystem.makeDirectory(location.snapshotDirectory, { recursive: true })
    yield* fileSystem.writeFileString(tempPath, serialized)
    yield* fileSystem.writeFileString(tempSnapshotPath, serialized)
    yield* fileSystem.rename(tempPath, location.latestPath)
    yield* fileSystem.rename(tempSnapshotPath, snapshotPath)
  }).pipe(
    Effect.mapError((error) =>
      new CacheWriteError({
        path: location.latestPath,
        reason: platformErrorReason(error),
        message: error.message,
      }),
    ),
    Effect.tapError(() =>
      Effect.all(
        [
          fileSystem.remove(tempPath).pipe(Effect.ignore),
          fileSystem.remove(tempSnapshotPath).pipe(Effect.ignore),
        ],
        { discard: true },
      ),
    ),
  )
})

export const getResponseCacheOverview = Effect.fn("TypefullyCache.getResponseCacheOverview")(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const directory = join(resolveRuntimePaths().cacheDir, "responses")
  const snapshotDirectory = join(directory, "snapshots")
  const ttlSeconds = resolveCacheTtlSeconds()
  const directoryExists = yield* fileSystem.exists(directory).pipe(
    Effect.mapError((error) =>
      new CacheReadError({
        path: directory,
        reason: platformErrorReason(error),
        message: error.message,
      }),
    ),
  )

  if (!directoryExists) {
    return {
      enabled: true,
      cache_dir: directory,
      snapshot_directory: snapshotDirectory,
      latest_count: 0,
      snapshot_count: 0,
      ttl_seconds: ttlSeconds,
    }
  }

  const entries = yield* fileSystem.readDirectory(directory).pipe(
    Effect.mapError((error) =>
      new CacheReadError({
        path: directory,
        reason: platformErrorReason(error),
        message: error.message,
      }),
    ),
  )
  const snapshotExists = yield* fileSystem.exists(snapshotDirectory).pipe(
    Effect.mapError((error) =>
      new CacheReadError({
        path: snapshotDirectory,
        reason: platformErrorReason(error),
        message: error.message,
      }),
    ),
  )
  const snapshotEntries = snapshotExists
    ? yield* fileSystem.readDirectory(snapshotDirectory).pipe(
        Effect.mapError((error) =>
          new CacheReadError({
            path: snapshotDirectory,
            reason: platformErrorReason(error),
            message: error.message,
          }),
        ),
      )
    : []

  return {
    enabled: true,
    cache_dir: directory,
    snapshot_directory: snapshotDirectory,
    latest_count: entries.filter((entry) => entry.startsWith("typefully-response-") && entry.endsWith(".json")).length,
    snapshot_count: snapshotEntries.filter((entry) => entry.startsWith("typefully-response-") && entry.endsWith(".json"))
      .length,
    ttl_seconds: ttlSeconds,
  }
})

export const clearResponseCache = Effect.fn("TypefullyCache.clearResponseCache")(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const overview = yield* getResponseCacheOverview()
  const exists = yield* fileSystem.exists(overview.cache_dir).pipe(
    Effect.mapError((error) =>
      new CacheRemoveError({
        path: overview.cache_dir,
        reason: platformErrorReason(error),
        message: error.message,
      }),
    ),
  )

  if (exists) {
    yield* fileSystem.remove(overview.cache_dir, { recursive: true }).pipe(
      Effect.mapError((error) =>
        new CacheRemoveError({
          path: overview.cache_dir,
          reason: platformErrorReason(error),
          message: error.message,
        }),
      ),
    )
  }

  return {
    cleared: true,
    cache_dir: overview.cache_dir,
    removed_latest_count: overview.latest_count,
    removed_snapshot_count: overview.snapshot_count,
  }
})
