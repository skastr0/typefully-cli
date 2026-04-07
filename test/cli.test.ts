import { afterEach, describe, expect, test } from "bun:test"

import { expectJson, runCli } from "./helpers/cli"

const servers: Array<{ stop: () => void }> = []

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop()
  }
})

describe("typefully CLI foundation", () => {
  test("auth status reports missing API key without failing", async () => {
    const result = await runCli(["auth", "status"], {
      TYPEFULLY_API_KEY: undefined,
      TYPEFULLY_API_BASE_URL: undefined,
    })

    const payload = expectJson<{
      ok: boolean
      command: string
      data: { configured: boolean; authenticated: boolean }
    }>(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe("")
    expect(payload.ok).toBe(true)
    expect(payload.command).toBe("auth status")
    expect(payload.data.configured).toBe(false)
    expect(payload.data.authenticated).toBe(false)
  })

  test("me fetches the current account with the explicit typed subset", async () => {
    const requests: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        requests.push(`${request.method} ${new URL(request.url).pathname}`)

        return new Response(
          JSON.stringify({
            id: "user_123",
            name: "Test User",
            email: "test@example.com",
            username: "typefully",
            unexpected: "should-be-dropped",
          }),
          {
            headers: { "content-type": "application/json" },
          },
        )
      },
    })
    servers.push(server)

    const result = await runCli(["me"], {
      TYPEFULLY_API_KEY: "test-token",
      TYPEFULLY_API_BASE_URL: `http://127.0.0.1:${server.port}/v2`,
    })

    const payload = expectJson<{
      ok: boolean
      command: string
      data: {
        me: {
          id: string
          name?: string
          username?: string
          email?: string
        }
      }
    }>(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe("")
    expect(payload.command).toBe("me")
    expect(payload.data.me).toEqual({
      id: "user_123",
      name: "Test User",
      username: "typefully",
      email: "test@example.com",
    })
    expect(requests).toEqual(["GET /v2/me"])
  })

  test("me returns a structured error envelope on non-2xx responses", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        })
      },
    })
    servers.push(server)

    const result = await runCli(["me"], {
      TYPEFULLY_API_KEY: "test-token",
      TYPEFULLY_API_BASE_URL: `http://127.0.0.1:${server.port}/v2`,
    })

    const payload = expectJson<{
      ok: boolean
      command: string
      error: {
        type: string
        message: string
        details: {
          status: number
        }
      }
    }>(result.stderr)

    expect(result.exitCode).toBe(1)
    expect(result.stdout.trim()).toBe("")
    expect(payload.ok).toBe(false)
    expect(payload.command).toBe("me")
    expect(payload.error.type).toBe("TypefullyApiError")
    expect(payload.error.details.status).toBe(401)
  })

  test("social-sets list forwards pagination to Typefully v2", async () => {
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
                id: 12345,
                username: "typefully",
                name: "Typefully",
                profile_image_url: "https://example.com/avatar.png",
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

    const result = await runCli(["social-sets", "list", "--limit", "1", "--offset", "2"], {
      TYPEFULLY_API_KEY: "test-token",
      TYPEFULLY_API_BASE_URL: `http://127.0.0.1:${server.port}/v2`,
    })

    const payload = expectJson<{
      ok: boolean
      command: string
      data: {
        social_sets: {
          count: number
          limit: number
          offset: number
          results: Array<{ id: number; username: string }>
        }
      }
    }>(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe("")
    expect(payload.command).toBe("social-sets list")
    expect(payload.data.social_sets.limit).toBe(1)
    expect(payload.data.social_sets.offset).toBe(2)
    expect(payload.data.social_sets.results[0]?.username).toBe("typefully")
    expect(requests).toEqual(["GET /v2/social-sets?limit=1&offset=2"])
  })

  test("social-sets get fetches a single social set detail", async () => {
    const requests: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        requests.push(`${request.method} ${url.pathname}`)

        return new Response(
          JSON.stringify({
            id: 12345,
            username: "typefully",
            name: "Typefully",
            profile_image_url: "https://example.com/avatar.png",
            team: {
              id: "team_1",
              name: "Typefully Team",
            },
            platforms: {
              x: {
                username: "typefully",
                name: "Typefully",
                profile_url: "https://x.com/typefully",
                profile_image_url: "https://example.com/x-avatar.png",
              },
              linkedin: {
                username: "typefullycom",
                name: "Typefully",
                profile_url: "https://www.linkedin.com/company/typefullycom/",
                profile_image_url: "https://example.com/linkedin-avatar.png",
              },
            },
            publishing_quota: {
              used: 12,
              remaining: "unlimited",
              resets_at: null,
            },
          }),
          {
            headers: { "content-type": "application/json" },
          },
        )
      },
    })
    servers.push(server)

    const result = await runCli(["social-sets", "get", '{"social_set_id":12345}'], {
      TYPEFULLY_API_KEY: "test-token",
      TYPEFULLY_API_BASE_URL: `http://127.0.0.1:${server.port}/v2`,
    })

    const payload = expectJson<{
      ok: boolean
      command: string
      data: {
        social_set: {
          id: number
          username?: string
          name?: string
          profile_image_url?: string | null
          team?: {
            id: string
            name: string
          } | null
          platforms?: {
            x?: {
              username: string
              name?: string | null
              profile_url?: string | null
              profile_image_url?: string | null
            } | null
            linkedin?: {
              username: string
              name?: string | null
              profile_url?: string | null
              profile_image_url?: string | null
            } | null
          } | null
          publishing_quota?: {
            used: number
            remaining: number | "unlimited"
            resets_at?: string | null
          } | null
        }
      }
    }>(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe("")
    expect(payload.command).toBe("social-sets get")
    expect(payload.data.social_set).toEqual({
      id: 12345,
      username: "typefully",
      name: "Typefully",
      profile_image_url: "https://example.com/avatar.png",
      team: {
        id: "team_1",
        name: "Typefully Team",
      },
      platforms: {
        x: {
          username: "typefully",
          name: "Typefully",
          profile_url: "https://x.com/typefully",
          profile_image_url: "https://example.com/x-avatar.png",
        },
        linkedin: {
          username: "typefullycom",
          name: "Typefully",
          profile_url: "https://www.linkedin.com/company/typefullycom/",
          profile_image_url: "https://example.com/linkedin-avatar.png",
        },
      },
      publishing_quota: {
        used: 12,
        remaining: "unlimited",
        resets_at: null,
      },
    })
    expect(requests).toEqual(["GET /v2/social-sets/12345/"])
  })

  test("social-sets get returns a structured error for invalid JSON input", async () => {
    const result = await runCli(["social-sets", "get", '{"social_set_id":null}'], {
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
          source?: string
          reason?: string
        }
      }
    }>(result.stderr)

    expect(result.exitCode).toBe(1)
    expect(result.stdout.trim()).toBe("")
    expect(payload.ok).toBe(false)
    expect(payload.command).toBe("social-sets get")
    expect(payload.error.type).toBe("JsonInputError")
    expect(payload.error.details?.source).toBe("inline")
  })
})
