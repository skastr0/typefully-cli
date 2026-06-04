import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"

import { expectJson, runCli } from "./helpers/cli"

const servers: Array<{ stop: () => void }> = []

const examplePath = (name: string) => `@examples/drafts/${name}`
const exampleFile = (name: string) => join(process.cwd(), "examples", "drafts", name)

const draftDetailResponse = (overrides: Record<string, unknown> = {}) => ({
  id: 987,
  social_set_id: 123,
  draft_id: 987,
  status: "draft",
  created_at: "2026-04-03T09:00:00Z",
  updated_at: "2026-04-03T09:15:00Z",
  scheduled_date: null,
  published_at: null,
  draft_title: "CLI example",
  tags: ["cli"],
  preview: "Hello from the Typefully CLI",
  share_url: null,
  private_url: "https://typefully.com/d/987",
  scratchpad_text: null,
  platforms: {
    x: {
      enabled: true,
      posts: [{ text: "Hello from the Typefully CLI" }],
    },
  },
  x_published_url: null,
  linkedin_published_url: null,
  mastodon_published_url: null,
  threads_published_url: null,
  bluesky_published_url: null,
  x_post_published_at: null,
  linkedin_post_published_at: null,
  mastodon_post_published_at: null,
  threads_post_published_at: null,
  bluesky_post_published_at: null,
  ...overrides,
})

const draftListItem = (overrides: Record<string, unknown> = {}) => ({
  id: 987,
  social_set_id: 123,
  status: "draft",
  private_url: "https://typefully.com/d/987",
  tags: ["queue"],
  created_at: "2026-04-03T09:00:00Z",
  updated_at: "2026-04-03T09:15:00Z",
  published_at: null,
  scheduled_date: null,
  draft_title: "Queue item",
  preview: "Queued draft",
  share_url: null,
  x_post_enabled: true,
  linkedin_post_enabled: false,
  mastodon_post_enabled: false,
  threads_post_enabled: false,
  bluesky_post_enabled: false,
  x_published_url: null,
  linkedin_published_url: null,
  mastodon_published_url: null,
  threads_published_url: null,
  bluesky_published_url: null,
  x_post_published_at: null,
  linkedin_post_published_at: null,
  mastodon_post_published_at: null,
  threads_post_published_at: null,
  bluesky_post_published_at: null,
  ...overrides,
})

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop()
  }
})

describe("typefully drafts commands", () => {
  test("drafts list accepts raw JSON input and forwards filters", async () => {
    const requests: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        requests.push(`${request.method} ${url.pathname}?${url.searchParams.toString()}`)

        return new Response(
          JSON.stringify({
            results: [draftListItem()],
            count: 1,
            limit: Number(url.searchParams.get("limit") ?? 10),
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

    const result = await runCli(
      [
        "drafts",
        "list",
        '{"social_set_id":123,"status":"draft","tag":"queue","order_by":"-updated_at","limit":5,"offset":1}',
      ],
      {
        TYPEFULLY_API_KEY: "test-token",
        TYPEFULLY_API_BASE_URL: `http://127.0.0.1:${server.port}/v2`,
      },
    )

    const payload = expectJson<{
      ok: boolean
      command: string
      data: {
        drafts: {
          count: number
          limit: number
          offset: number
          results: Array<{ id: number; status: string }>
        }
      }
    }>(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe("")
    expect(payload.command).toBe("drafts list")
    expect(payload.data.drafts.count).toBe(1)
    expect(payload.data.drafts.results[0]?.status).toBe("draft")
    expect(requests).toEqual([
      "GET /v2/social-sets/123/drafts?limit=5&offset=1&status=draft&tag=queue&order_by=-updated_at",
    ])
  })

  test("drafts get loads @file JSON input", async () => {
    const requests: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        requests.push(`${request.method} ${new URL(request.url).pathname}`)

        return new Response(JSON.stringify(draftDetailResponse()), {
          headers: { "content-type": "application/json" },
        })
      },
    })
    servers.push(server)

    const result = await runCli(["drafts", "get", examplePath("get.json")], {
      TYPEFULLY_API_KEY: "test-token",
      TYPEFULLY_API_BASE_URL: `http://127.0.0.1:${server.port}/v2`,
    })

    const payload = expectJson<{
      ok: boolean
      command: string
      data: {
        draft: {
          id: number
          social_set_id: number
          status: string
          private_url: string
        }
      }
    }>(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe("")
    expect(payload.command).toBe("drafts get")
    expect(payload.data.draft.id).toBe(987)
    expect(payload.data.draft.social_set_id).toBe(123)
    expect(requests).toEqual(["GET /v2/social-sets/123/drafts/987"])
  })

  test("drafts create reads a single payload from stdin", async () => {
    const requestBodies: Array<Record<string, unknown>> = []
    const stdinText = await Bun.file(exampleFile("create-single.json")).text()

    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        requestBodies.push((await request.json()) as Record<string, unknown>)

        return new Response(
          JSON.stringify(
            draftDetailResponse({
              platforms: requestBodies[0]?.platforms,
              draft_title: requestBodies[0]?.draft_title,
              tags: requestBodies[0]?.tags,
            }),
          ),
          {
            status: 201,
            headers: { "content-type": "application/json" },
          },
        )
      },
    })
    servers.push(server)

    const result = await runCli(
      ["drafts", "create", "-"],
      {
        TYPEFULLY_API_KEY: "test-token",
        TYPEFULLY_API_BASE_URL: `http://127.0.0.1:${server.port}/v2`,
      },
      { stdinText },
    )

    const payload = expectJson<{
      ok: boolean
      command: string
      data: {
        outcome: string
        total: number
        success_count: number
        error_count: number
        results: Array<{
          ok: boolean
          target: { social_set_id: number }
          data: {
            draft_title: string
            tags: string[]
          }
        }>
      }
    }>(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe("")
    expect(payload.command).toBe("drafts create")
    expect(payload.data.outcome).toBe("succeeded")
    expect(payload.data.total).toBe(1)
    expect(payload.data.success_count).toBe(1)
    expect(payload.data.error_count).toBe(0)
    expect(payload.data.results[0]).toMatchObject({
      ok: true,
      target: { social_set_id: 123 },
      data: {
        draft_title: "CLI example",
        tags: ["cli", "example"],
      },
    })
    expect(requestBodies).toHaveLength(1)
    expect(requestBodies[0]?.publish_at).toBe("next-free-slot")
  })

  test("drafts update returns structured per-item success and error results for batch input", async () => {
    const requests: string[] = []
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        requests.push(`${request.method} ${url.pathname}`)

        if (url.pathname.endsWith("/987")) {
          return new Response(
            JSON.stringify(
              draftDetailResponse({
                draft_title: "Batch updated draft",
                publish_at: "now",
              }),
            ),
            {
              headers: { "content-type": "application/json" },
            },
          )
        }

        return new Response(
          JSON.stringify({
            error: {
              code: "VALIDATION_ERROR",
              message: "Validation failed",
              details: [
                {
                  field: "publish_at",
                  message: "Schedule date must be in the future",
                },
              ],
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
      ["drafts", "update", examplePath("update-batch.json"), "--concurrency", "2"],
      {
        TYPEFULLY_API_KEY: "test-token",
        TYPEFULLY_API_BASE_URL: `http://127.0.0.1:${server.port}/v2`,
      },
    )

    const payload = expectJson<{
      ok: boolean
      command: string
      data: {
        outcome: string
        total: number
        success_count: number
        error_count: number
        concurrency: number
        results: Array<
          | {
              ok: true
              target: { social_set_id: number; draft_id: number }
              data: { draft_title: string }
            }
          | {
              ok: false
              target: { social_set_id: number; draft_id: number }
              error: {
                type: string
                details: { status: number; target: { index: number; social_set_id: number; draft_id: number } }
              }
            }
        >
      }
    }>(result.stdout)

    expect(result.exitCode).toBe(1)
    expect(result.stderr.trim()).toBe("")
    expect(payload.command).toBe("drafts update")
    expect(payload.data.outcome).toBe("partial_failure")
    expect(payload.data.total).toBe(2)
    expect(payload.data.success_count).toBe(1)
    expect(payload.data.error_count).toBe(1)
    expect(payload.data.concurrency).toBe(2)
    expect(payload.data.results[0]).toMatchObject({
      ok: true,
      target: { social_set_id: 123, draft_id: 987 },
      data: { draft_title: "Batch updated draft" },
    })
    expect(payload.data.results[1]).toMatchObject({
      ok: false,
      target: { social_set_id: 123, draft_id: 654 },
      error: {
        type: "TypefullyApiError",
        details: { status: 422, target: { index: 1, social_set_id: 123, draft_id: 654 } },
      },
    })
    expect(requests).toEqual([
      "PATCH /v2/social-sets/123/drafts/987",
      "PATCH /v2/social-sets/123/drafts/654",
    ])
  })

  test("drafts delete accepts batch @file input and returns per-item success results", async () => {
    const requests: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        requests.push(`${request.method} ${new URL(request.url).pathname}`)
        return new Response(null, { status: 204 })
      },
    })
    servers.push(server)

    const result = await runCli(["drafts", "delete", examplePath("delete-batch.json")], {
      TYPEFULLY_API_KEY: "test-token",
      TYPEFULLY_API_BASE_URL: `http://127.0.0.1:${server.port}/v2`,
    })

    const payload = expectJson<{
      ok: boolean
      command: string
      data: {
        outcome: string
        total: number
        success_count: number
        error_count: number
        results: Array<{
          index: number
          ok: boolean
          target: { social_set_id: number; draft_id: number }
          data: { deleted: boolean }
        }>
      }
    }>(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe("")
    expect(payload.command).toBe("drafts delete")
    expect(payload.data.outcome).toBe("succeeded")
    expect(payload.data.total).toBe(2)
    expect(payload.data.success_count).toBe(2)
    expect(payload.data.error_count).toBe(0)
    expect(payload.data.results).toEqual([
      {
        index: 0,
        ok: true,
        target: { social_set_id: 123, draft_id: 987 },
        data: { deleted: true },
      },
      {
        index: 1,
        ok: true,
        target: { social_set_id: 123, draft_id: 654 },
        data: { deleted: true },
      },
    ])
    expect(requests).toEqual([
      "DELETE /v2/social-sets/123/drafts/987",
      "DELETE /v2/social-sets/123/drafts/654",
    ])
  })
})
