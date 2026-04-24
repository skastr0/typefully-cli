import { rm } from "node:fs/promises"

import { afterEach, describe, expect, test } from "bun:test"

import { expectJson, runCli } from "./helpers/cli"

const servers: Array<{ stop: () => void }> = []
const tempDirs: string[] = []

const examplePath = (name: string) => `@examples/analytics/${name}`

const analyticsPostsResponse = (overrides: Record<string, unknown> = {}) => ({
  results: [
    {
      platform: "x",
      post_id: "post-123",
      created_at: "2026-03-15T14:30:00Z",
      preview_text: "Top post from analytics",
      url: "https://typefully.com/post/post-123",
      metrics: {
        impressions: 4200,
        engagement: {
          total: 287,
          likes: 210,
          comments: 18,
          shares: 34,
          quotes: 7,
          profile_clicks: 12,
          saves: null,
          link_clicks: 6,
        },
      },
      draft_id: 456,
    },
  ],
  limit: 10,
  offset: 5,
  next: null,
  previous: null,
  ...overrides,
})

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.stop()
  }

  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("typefully analytics commands", () => {
  test("analytics posts loads @file JSON input and forwards query params", async () => {
    const requests: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        requests.push(`${request.method} ${url.pathname}?${url.searchParams.toString()}`)

        return new Response(JSON.stringify(analyticsPostsResponse()), {
          headers: { "content-type": "application/json" },
        })
      },
    })
    servers.push(server)

    const result = await runCli(["analytics", "posts", examplePath("posts.json")], {
      TYPEFULLY_API_KEY: "test-token",
      TYPEFULLY_API_BASE_URL: `http://127.0.0.1:${server.port}/v2`,
    })

    const payload = expectJson<{
      ok: boolean
      command: string
      data: {
        posts: {
          limit: number
          offset: number
          results: Array<{
            platform: "x"
            post_id: string
            created_at: string
            preview_text: string
            url: string
            metrics: {
              impressions: number
              engagement: {
                total: number
                likes: number
                comments: number
                shares: number
                quotes: number
                profile_clicks: number
                saves?: number | null
                link_clicks?: number | null
              }
            }
            draft_id?: number | null
          }>
        }
      }
    }>(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe("")
    expect(payload.command).toBe("analytics posts")
    expect(payload.data.posts.limit).toBe(10)
    expect(payload.data.posts.offset).toBe(5)
    expect(payload.data.posts.results[0]).toMatchObject({
      platform: "x",
      post_id: "post-123",
      created_at: "2026-03-15T14:30:00Z",
      preview_text: "Top post from analytics",
      url: "https://typefully.com/post/post-123",
      metrics: {
        impressions: 4200,
        engagement: {
          total: 287,
          likes: 210,
          comments: 18,
          shares: 34,
          quotes: 7,
          profile_clicks: 12,
          saves: null,
          link_clicks: 6,
        },
      },
      draft_id: 456,
    })
    expect(requests).toEqual([
      "GET /v2/social-sets/123/analytics/x/posts?start_date=2026-03-01&end_date=2026-03-31&include_replies=true&limit=10&offset=5",
    ])
  })

  test("analytics posts validates date order before hitting the API", async () => {
    const result = await runCli(
      [
        "analytics",
        "posts",
        '{"social_set_id":123,"platform":"x","start_date":"2026-03-31","end_date":"2026-03-01"}',
      ],
      {
        TYPEFULLY_API_KEY: "test-token",
      },
    )

    const payload = expectJson<{
      ok: boolean
      command: string
      error: {
        type: string
        message: string
        details: { field: string }
      }
    }>(result.stderr)

    expect(result.exitCode).toBe(1)
    expect(result.stdout.trim()).toBe("")
    expect(payload).toMatchObject({
      ok: false,
      command: "analytics posts",
      error: {
        type: "CommandInputError",
        message: "end_date must be on or after start_date",
        details: { field: "end_date" },
      },
    })
  })

  test("analytics posts supports artifact output mode", async () => {
    const artifactDir = `/tmp/typefully-cli-artifacts-${Date.now()}-${Math.random().toString(16).slice(2)}`
    tempDirs.push(artifactDir)

    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify(analyticsPostsResponse()), {
          headers: { "content-type": "application/json" },
        })
      },
    })
    servers.push(server)

    const result = await runCli(
      ["analytics", "posts", examplePath("posts.json"), "--output", "artifact"],
      {
        TYPEFULLY_API_KEY: "test-token",
        TYPEFULLY_API_BASE_URL: `http://127.0.0.1:${server.port}/v2`,
        TYPEFULLY_ARTIFACT_DIR: artifactDir,
      },
    )

    const payload = expectJson<{
      ok: boolean
      command: string
      data: {
        kind: "summary+artifact"
        artifact: {
          key: string
          absolute_path: string
          relative_path: string
          size_bytes: number
        }
      }
    }>(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe("")
    expect(payload.command).toBe("analytics posts")
    expect(payload.data.kind).toBe("summary+artifact")
    expect(payload.data.artifact.key).toBe("analytics.posts")
    expect(payload.data.artifact.size_bytes).toBeGreaterThan(0)

    const artifact = expectJson<{
      posts: {
        results: Array<{ post_id: string }>
      }
    }>(await Bun.file(payload.data.artifact.absolute_path).text())

    expect(artifact.posts.results[0]?.post_id).toBe("post-123")
  })

  test("analytics posts surfaces Typefully API errors", async () => {
    const requests: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        requests.push(`${request.method} ${url.pathname}?${url.searchParams.toString()}`)

        return new Response(
          JSON.stringify({
            error: {
              code: "VALIDATION_ERROR",
              message: "Date range is too large.",
            },
          }),
          {
            status: 422,
            headers: { "content-type": "application/json" },
          },
        )
      },
    })
    servers.push(server)

    const result = await runCli(
      [
        "analytics",
        "posts",
        '{"social_set_id":123,"platform":"x","start_date":"2026-03-01","end_date":"2026-03-31"}',
      ],
      {
        TYPEFULLY_API_KEY: "test-token",
        TYPEFULLY_API_BASE_URL: `http://127.0.0.1:${server.port}/v2`,
      },
    )

    const payload = expectJson<{
      ok: boolean
      command: string
      error: {
        type: string
        message: string
        details: { status: number }
      }
    }>(result.stderr)

    expect(result.exitCode).toBe(1)
    expect(result.stdout.trim()).toBe("")
    expect(payload.command).toBe("analytics posts")
    expect(payload.error.type).toBe("TypefullyApiError")
    expect(payload.error.message).toBe("Date range is too large.")
    expect(payload.error.details.status).toBe(422)
    expect(requests).toEqual([
      "GET /v2/social-sets/123/analytics/x/posts?start_date=2026-03-01&end_date=2026-03-31",
    ])
  })
})
