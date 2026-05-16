import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { expectJson, runCli } from "./helpers/cli"

const servers: Array<{ stop: () => void }> = []

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop()
  }
})

const socialSetsPayload = (username: string) => ({
  results: [
    {
      id: 12345,
      username,
      name: username,
      profile_image_url: null,
    },
  ],
  count: 1,
  limit: 10,
  offset: 0,
  next: null,
  previous: null,
})

const tagsPayload = (name: string) => ({
  results: [
    {
      slug: name.toLowerCase(),
      name,
      created_at: "2026-01-01T00:00:00Z",
    },
  ],
  count: 1,
  limit: 10,
  offset: 0,
  next: null,
  previous: null,
})

const setStoredAuth = (typefullyHome: string, token: string) =>
  runCli(
    ["auth", "set"],
    {
      TYPEFULLY_HOME: typefullyHome,
      TYPEFULLY_API_KEY: undefined,
      TYPEFULLY_API_BASE_URL: undefined,
    },
    { stdinText: token },
  )

const fileMode = (path: string) => statSync(path).mode & 0o777

const responseCacheDir = (typefullyHome: string) => join(typefullyHome, "cache", "responses")

const responseCacheFiles = (directory: string) =>
  readdirSync(directory).filter((entry) => entry.startsWith("typefully-response-") && entry.endsWith(".json"))

const firstResponseCachePath = (typefullyHome: string) => {
  const directory = responseCacheDir(typefullyHome)
  const file = responseCacheFiles(directory).at(0)

  if (file === undefined) {
    throw new Error(`Expected at least one response cache file in ${directory}`)
  }

  return join(directory, file)
}

describe("typefully local response cache", () => {
  test("social-sets list reuses cached data without a shell API key or network", async () => {
    const typefullyHome = mkdtempSync(join(tmpdir(), "typefully-cli-cache-"))
    const requests: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        requests.push(new URL(request.url).pathname)

        return new Response(JSON.stringify(socialSetsPayload("cached-user")), {
          headers: { "content-type": "application/json" },
        })
      },
    })

    await setStoredAuth(typefullyHome, "stored-token")
    const env = {
      TYPEFULLY_HOME: typefullyHome,
      TYPEFULLY_API_KEY: undefined,
      TYPEFULLY_API_BASE_URL: `http://127.0.0.1:${server.port}/v2`,
    }

    const first = await runCli(["social-sets", "list", '{"limit":10}'], env)
    expect(first.exitCode).toBe(0)
    server.stop()

    const second = await runCli(["social-sets", "list", '{"limit":10}'], env)
    const payload = expectJson<{
      data: { social_sets: { results: Array<{ username: string }> } }
    }>(second.stdout)

    expect(second.exitCode).toBe(0)
    expect(payload.data.social_sets.results[0]?.username).toBe("cached-user")
    expect(requests).toEqual(["/v2/social-sets"])
  })

  test("refresh bypasses cached social-set data", async () => {
    const typefullyHome = mkdtempSync(join(tmpdir(), "typefully-cli-cache-refresh-"))
    let requestCount = 0
    const server = Bun.serve({
      port: 0,
      fetch() {
        requestCount += 1

        return new Response(
          JSON.stringify(socialSetsPayload(requestCount === 1 ? "first-user" : "fresh-user")),
          { headers: { "content-type": "application/json" } },
        )
      },
    })
    servers.push(server)

    await setStoredAuth(typefullyHome, "stored-token")
    const env = {
      TYPEFULLY_HOME: typefullyHome,
      TYPEFULLY_API_KEY: undefined,
      TYPEFULLY_API_BASE_URL: `http://127.0.0.1:${server.port}/v2`,
    }

    const first = await runCli(["social-sets", "list", "{}"], env)
    const cached = await runCli(["social-sets", "list", "{}"], env)
    const refreshed = await runCli(["social-sets", "list", "{}", "--refresh"], env)
    const cachedPayload = expectJson<{
      data: { social_sets: { results: Array<{ username: string }> } }
    }>(cached.stdout)
    const refreshedPayload = expectJson<{
      data: { social_sets: { results: Array<{ username: string }> } }
    }>(refreshed.stdout)

    expect(first.exitCode).toBe(0)
    expect(cachedPayload.data.social_sets.results[0]?.username).toBe("first-user")
    expect(refreshedPayload.data.social_sets.results[0]?.username).toBe("fresh-user")
    expect(requestCount).toBe(2)
  })

  test("stale cache entries are refreshed during normal reads", async () => {
    const typefullyHome = mkdtempSync(join(tmpdir(), "typefully-cli-cache-expiry-"))
    let requestCount = 0
    const server = Bun.serve({
      port: 0,
      fetch() {
        requestCount += 1

        return new Response(
          JSON.stringify(socialSetsPayload(requestCount === 1 ? "first-user" : "fresh-user")),
          { headers: { "content-type": "application/json" } },
        )
      },
    })
    servers.push(server)

    await setStoredAuth(typefullyHome, "stored-token")
    const env = {
      TYPEFULLY_HOME: typefullyHome,
      TYPEFULLY_API_KEY: undefined,
      TYPEFULLY_API_BASE_URL: `http://127.0.0.1:${server.port}/v2`,
    }

    const first = await runCli(["social-sets", "list", "{}", "--cache-ttl-seconds", "1"], env)
    expect(first.exitCode).toBe(0)

    const cachePath = firstResponseCachePath(typefullyHome)
    const cached = JSON.parse(readFileSync(cachePath, "utf8")) as Record<string, unknown>
    writeFileSync(
      cachePath,
      `${JSON.stringify({ ...cached, cached_at: "2000-01-01T00:00:00.000Z" }, null, 2)}\n`,
    )

    const second = await runCli(["social-sets", "list", "{}", "--cache-ttl-seconds", "1"], env)
    const payload = expectJson<{
      data: { social_sets: { results: Array<{ username: string }> } }
    }>(second.stdout)

    expect(second.exitCode).toBe(0)
    expect(payload.data.social_sets.results[0]?.username).toBe("fresh-user")
    expect(requestCount).toBe(2)
  })

  test("refresh can fall back to stale cached data on provider errors", async () => {
    const typefullyHome = mkdtempSync(join(tmpdir(), "typefully-cli-cache-stale-"))
    let fail = false
    const server = Bun.serve({
      port: 0,
      fetch() {
        if (fail) {
          return new Response(JSON.stringify({ error: "rate limited" }), {
            status: 429,
            headers: { "content-type": "application/json" },
          })
        }

        return new Response(JSON.stringify(socialSetsPayload("stale-user")), {
          headers: { "content-type": "application/json" },
        })
      },
    })
    servers.push(server)

    await setStoredAuth(typefullyHome, "stored-token")
    const env = {
      TYPEFULLY_HOME: typefullyHome,
      TYPEFULLY_API_KEY: undefined,
      TYPEFULLY_API_BASE_URL: `http://127.0.0.1:${server.port}/v2`,
    }

    await runCli(["social-sets", "list", "{}"], env)
    fail = true

    const result = await runCli(["social-sets", "list", "{}", "--refresh", "--stale-if-error"], env)
    const payload = expectJson<{
      data: { social_sets: { results: Array<{ username: string }> } }
    }>(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(payload.data.social_sets.results[0]?.username).toBe("stale-user")
  })

  test("cache status and clear report deterministic cache metadata", async () => {
    const typefullyHome = mkdtempSync(join(tmpdir(), "typefully-cli-cache-status-"))
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify(socialSetsPayload("status-user")), {
          headers: { "content-type": "application/json" },
        })
      },
    })
    servers.push(server)

    await setStoredAuth(typefullyHome, "stored-token")
    const env = {
      TYPEFULLY_HOME: typefullyHome,
      TYPEFULLY_API_KEY: undefined,
      TYPEFULLY_API_BASE_URL: `http://127.0.0.1:${server.port}/v2`,
    }

    await runCli(["social-sets", "list", "{}"], env)
    const statusResult = await runCli(["cache", "status"], env)
    const status = expectJson<{
      data: { cache_dir: string; snapshot_directory: string; latest_count: number; snapshot_count: number }
    }>(statusResult.stdout)

    expect(statusResult.exitCode).toBe(0)
    expect(status.data.cache_dir).toBe(join(typefullyHome, "cache", "responses"))
    expect(status.data.latest_count).toBe(1)
    expect(status.data.snapshot_count).toBe(1)
    expect(fileMode(status.data.cache_dir)).toBe(0o700)
    expect(fileMode(status.data.snapshot_directory)).toBe(0o700)

    const latestFile = responseCacheFiles(status.data.cache_dir).at(0)
    const snapshotFile = responseCacheFiles(status.data.snapshot_directory).at(0)

    if (latestFile === undefined || snapshotFile === undefined) {
      throw new Error("Expected response cache latest and snapshot files")
    }

    expect(fileMode(join(status.data.cache_dir, latestFile))).toBe(0o600)
    expect(fileMode(join(status.data.snapshot_directory, snapshotFile))).toBe(0o600)

    const clearResult = await runCli(["cache", "clear"], env)
    const cleared = expectJson<{
      data: { cleared: boolean; removed_latest_count: number; removed_snapshot_count: number }
    }>(clearResult.stdout)

    expect(clearResult.exitCode).toBe(0)
    expect(cleared.data.cleared).toBe(true)
    expect(cleared.data.removed_latest_count).toBe(1)
    expect(cleared.data.removed_snapshot_count).toBe(1)
  })

  test("cache keys are separated by stored auth scope", async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), "typefully-cli-shared-cache-"))
    const homeA = mkdtempSync(join(tmpdir(), "typefully-cli-cache-a-"))
    const homeB = mkdtempSync(join(tmpdir(), "typefully-cli-cache-b-"))
    const seenAuth: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const auth = request.headers.get("authorization") ?? ""
        seenAuth.push(auth)

        return new Response(
          JSON.stringify(socialSetsPayload(auth.includes("token-b") ? "account-b" : "account-a")),
          { headers: { "content-type": "application/json" } },
        )
      },
    })
    servers.push(server)

    await setStoredAuth(homeA, "token-a")
    await setStoredAuth(homeB, "token-b")
    const baseEnv = {
      TYPEFULLY_CACHE_DIR: cacheDir,
      TYPEFULLY_API_KEY: undefined,
      TYPEFULLY_API_BASE_URL: `http://127.0.0.1:${server.port}/v2`,
    }

    const first = await runCli(["social-sets", "list", "{}"], {
      ...baseEnv,
      TYPEFULLY_HOME: homeA,
    })
    const second = await runCli(["social-sets", "list", "{}"], {
      ...baseEnv,
      TYPEFULLY_HOME: homeB,
    })
    const secondPayload = expectJson<{
      data: { social_sets: { results: Array<{ username: string }> } }
    }>(second.stdout)

    expect(first.exitCode).toBe(0)
    expect(second.exitCode).toBe(0)
    expect(secondPayload.data.social_sets.results[0]?.username).toBe("account-b")
    expect(seenAuth).toEqual(["Bearer token-a", "Bearer token-b"])
  })

  test("tags list uses the response cache", async () => {
    const typefullyHome = mkdtempSync(join(tmpdir(), "typefully-cli-tags-cache-"))
    let requestCount = 0
    const server = Bun.serve({
      port: 0,
      fetch() {
        requestCount += 1

        return new Response(JSON.stringify(tagsPayload("Launch")), {
          headers: { "content-type": "application/json" },
        })
      },
    })
    servers.push(server)

    await setStoredAuth(typefullyHome, "stored-token")
    const env = {
      TYPEFULLY_HOME: typefullyHome,
      TYPEFULLY_API_KEY: undefined,
      TYPEFULLY_API_BASE_URL: `http://127.0.0.1:${server.port}/v2`,
    }

    const first = await runCli(["tags", "list", '{"social_set_id":12345}'], env)
    const second = await runCli(["tags", "list", '{"social_set_id":12345}'], env)
    const payload = expectJson<{
      data: { tags: { results: Array<{ name: string }> } }
    }>(second.stdout)

    expect(first.exitCode).toBe(0)
    expect(second.exitCode).toBe(0)
    expect(payload.data.tags.results[0]?.name).toBe("Launch")
    expect(requestCount).toBe(1)
  })

  test("cache ttl zero is accepted for cached read commands", async () => {
    const typefullyHome = mkdtempSync(join(tmpdir(), "typefully-cli-cache-ttl-zero-"))
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)

        if (url.pathname.endsWith("/tags")) {
          return new Response(JSON.stringify(tagsPayload("Launch")), {
            headers: { "content-type": "application/json" },
          })
        }

        return new Response(JSON.stringify(socialSetsPayload("ttl-zero-user")), {
          headers: { "content-type": "application/json" },
        })
      },
    })
    servers.push(server)

    await setStoredAuth(typefullyHome, "stored-token")
    const env = {
      TYPEFULLY_HOME: typefullyHome,
      TYPEFULLY_API_KEY: undefined,
      TYPEFULLY_API_BASE_URL: `http://127.0.0.1:${server.port}/v2`,
    }

    const socialSets = await runCli(["social-sets", "list", "{}", "--cache-ttl-seconds", "0"], env)
    const tags = await runCli(
      ["tags", "list", '{"social_set_id":12345}', "--cache-ttl-seconds", "0"],
      env,
    )

    expect(socialSets.exitCode).toBe(0)
    expect(tags.exitCode).toBe(0)
  })
})
