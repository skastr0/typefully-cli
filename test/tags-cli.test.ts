import { afterEach, describe, expect, test } from "bun:test"

import { expectJson, runCli } from "./helpers/cli"

const servers: Array<{ stop: () => void }> = []

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop()
  }
})

describe("tags CLI", () => {
  test("tags list forwards social_set_id pagination to Typefully v2", async () => {
    const requests: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        requests.push(`${request.method} ${url.pathname}?${url.searchParams.toString()}`)

        return new Response(
          JSON.stringify({
            results: [
              {
                slug: "launch",
                name: "launch",
                created_at: "2026-04-05T12:00:00Z",
              },
            ],
            count: 1,
            limit: Number(url.searchParams.get("limit") ?? 0),
            offset: Number(url.searchParams.get("offset") ?? 0),
            next: null,
            previous: null,
          }),
          {
            headers: { "content-type": "application/json" },
          },
        )
      },
    })
    servers.push(server)

    const result = await runCli(["tags", "list", '{"social_set_id":123,"limit":10,"offset":2}'], {
      TYPEFULLY_API_KEY: "test-token",
      TYPEFULLY_API_BASE_URL: `http://127.0.0.1:${server.port}/v2`,
    })

    const payload = expectJson<{
      ok: boolean
      command: string
      data: {
        tags: {
          count: number
          limit: number
          offset: number
          results: Array<{
            slug: string
            name: string
            created_at: string
          }>
        }
      }
    }>(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe("")
    expect(payload.command).toBe("tags list")
    expect(payload.data.tags.limit).toBe(10)
    expect(payload.data.tags.offset).toBe(2)
    expect(payload.data.tags.results).toEqual([
      {
        slug: "launch",
        name: "launch",
        created_at: "2026-04-05T12:00:00Z",
      },
    ])
    expect(requests).toEqual(["GET /v2/social-sets/123/tags?limit=10&offset=2"])
  })

  test("tags list rejects invalid pagination", async () => {
    const result = await runCli(["tags", "list", '{"social_set_id":123,"offset":-1}'], {
      TYPEFULLY_API_KEY: "test-token",
      TYPEFULLY_API_BASE_URL: "http://127.0.0.1:65535/v2",
    })

    const payload = expectJson<{
      ok: boolean
      command: string
      error: {
        type: string
        message: string
        details?: {
          field?: string
        }
      }
    }>(result.stderr)

    expect(result.exitCode).toBe(1)
    expect(result.stdout.trim()).toBe("")
    expect(payload.ok).toBe(false)
    expect(payload.command).toBe("tags list")
    expect(payload.error.type).toBe("CommandInputError")
    expect(payload.error.details?.field).toBe("offset")
  })

  test("tags create posts the tag name and returns the created tag", async () => {
    const requests: Array<{ method: string; path: string; body: unknown }> = []
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        const body = await request.json()
        requests.push({
          method: request.method,
          path: url.pathname,
          body,
        })

        return new Response(
          JSON.stringify({
            slug: "my-tag",
            name: "my-tag",
            created_at: "2026-04-05T12:30:00Z",
          }),
          {
            headers: { "content-type": "application/json" },
          },
        )
      },
    })
    servers.push(server)

    const result = await runCli(["tags", "create", '{"social_set_id":123,"name":"my-tag"}'], {
      TYPEFULLY_API_KEY: "test-token",
      TYPEFULLY_API_BASE_URL: `http://127.0.0.1:${server.port}/v2`,
    })

    const payload = expectJson<{
      ok: boolean
      command: string
      data: {
        tag: {
          slug: string
          name: string
          created_at: string
        }
      }
    }>(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe("")
    expect(payload.command).toBe("tags create")
    expect(payload.data.tag).toEqual({
      slug: "my-tag",
      name: "my-tag",
      created_at: "2026-04-05T12:30:00Z",
    })
    expect(requests).toEqual([
      {
        method: "POST",
        path: "/v2/social-sets/123/tags",
        body: {
          name: "my-tag",
        },
      },
    ])
  })

  test("tags create returns a structured error envelope on API failure", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify({ error: "Tag already exists" }), {
          status: 409,
          headers: { "content-type": "application/json" },
        })
      },
    })
    servers.push(server)

    const result = await runCli(["tags", "create", '{"social_set_id":123,"name":"my-tag"}'], {
      TYPEFULLY_API_KEY: "test-token",
      TYPEFULLY_API_BASE_URL: `http://127.0.0.1:${server.port}/v2`,
    })

    const payload = expectJson<{
      ok: boolean
      command: string
      error: {
        type: string
        message: string
        details?: {
          status?: number
        }
      }
    }>(result.stderr)

    expect(result.exitCode).toBe(1)
    expect(result.stdout.trim()).toBe("")
    expect(payload.ok).toBe(false)
    expect(payload.command).toBe("tags create")
    expect(payload.error.type).toBe("TypefullyApiError")
    expect(payload.error.details?.status).toBe(409)
  })
})
