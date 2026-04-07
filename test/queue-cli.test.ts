import { afterEach, describe, expect, test } from "bun:test"

import { expectJson, runCli } from "./helpers/cli"

const servers: Array<{ stop: () => void }> = []

const examplePath = (name: string) => `@examples/queue/${name}`

const queueDraftItem = (overrides: Record<string, unknown> = {}) => ({
  id: 987,
  social_set_id: 123,
  status: "scheduled",
  private_url: "https://typefully.com/d/987",
  tags: ["queue"],
  created_at: "2026-02-12T09:00:00Z",
  updated_at: null,
  published_at: null,
  scheduled_date: "2026-02-12T17:00:00Z",
  draft_title: null,
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

const queueResponse = () => ({
  social_set_id: 123,
  start_date: "2026-02-12",
  end_date: "2026-02-14",
  days: [
    {
      date: "2026-02-12",
      items: [
        {
          at: "2026-02-12T12:00:00Z",
          kind: "queue_slot",
          draft: null,
        },
        {
          at: "2026-02-12T17:00:00Z",
          kind: "queue_slot",
          draft: queueDraftItem(),
        },
        {
          at: "2026-02-12T20:00:00Z",
          kind: "custom_time",
          draft: queueDraftItem({
            id: 654,
            private_url: "https://typefully.com/d/654",
            preview: "Custom time draft",
            scheduled_date: "2026-02-12T20:00:00Z",
          }),
        },
      ],
    },
  ],
})

const queueScheduleResponse = (overrides: Record<string, unknown> = {}) => ({
  social_set_id: 123,
  timezone: "America/New_York",
  rules: [
    { h: 12, m: 0, days: ["mon", "tue", "wed", "thu", "fri"] },
    { h: 17, m: 0, days: ["mon", "wed", "fri"] },
  ],
  ...overrides,
})

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop()
  }
})

describe("typefully queue commands", () => {
  test("queue get accepts raw JSON input and forwards the date range", async () => {
    const requests: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        requests.push(`${request.method} ${url.pathname}?${url.searchParams.toString()}`)

        return new Response(JSON.stringify(queueResponse()), {
          headers: { "content-type": "application/json" },
        })
      },
    })
    servers.push(server)

    const result = await runCli(
      [
        "queue",
        "get",
        '{"social_set_id":123,"start_date":"2026-02-12","end_date":"2026-02-14"}',
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
        queue: {
          social_set_id: number
          days: Array<{
            date: string
            items: Array<{
              kind: string
              draft?: { id: number; preview?: string } | null
            }>
          }>
        }
      }
    }>(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe("")
    expect(payload.command).toBe("queue get")
    expect(payload.data.queue.social_set_id).toBe(123)
    expect(payload.data.queue.days[0]?.items[0]?.draft).toBeNull()
    expect(payload.data.queue.days[0]?.items[1]?.draft?.id).toBe(987)
    expect(payload.data.queue.days[0]?.items[2]?.kind).toBe("custom_time")
    expect(requests).toEqual([
      "GET /v2/social-sets/123/queue?start_date=2026-02-12&end_date=2026-02-14",
    ])
  })

  test("queue schedule get loads @file JSON input", async () => {
    const requests: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        requests.push(`${request.method} ${new URL(request.url).pathname}`)

        return new Response(JSON.stringify(queueScheduleResponse()), {
          headers: { "content-type": "application/json" },
        })
      },
    })
    servers.push(server)

    const result = await runCli(["queue", "schedule", "get", examplePath("schedule-get.json")], {
      TYPEFULLY_API_KEY: "test-token",
      TYPEFULLY_API_BASE_URL: `http://127.0.0.1:${server.port}/v2`,
    })

    const payload = expectJson<{
      ok: boolean
      command: string
      data: {
        schedule: {
          social_set_id: number
          timezone: string
          rules: Array<{ h: number; m: number; days: string[] }>
        }
      }
    }>(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe("")
    expect(payload.command).toBe("queue schedule get")
    expect(payload.data.schedule.timezone).toBe("America/New_York")
    expect(payload.data.schedule.rules).toHaveLength(2)
    expect(requests).toEqual(["GET /v2/social-sets/123/queue/schedule"])
  })

  test("queue schedule update sends a PUT request with the replacement rules", async () => {
    const requests: string[] = []
    const requestBodies: Array<Record<string, unknown>> = []
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        requests.push(`${request.method} ${url.pathname}`)
        requestBodies.push((await request.json()) as Record<string, unknown>)

        return new Response(
          JSON.stringify(
            queueScheduleResponse({
              rules: requestBodies[0]?.rules,
            }),
          ),
          {
            headers: { "content-type": "application/json" },
          },
        )
      },
    })
    servers.push(server)

    const result = await runCli(["queue", "schedule", "update", examplePath("schedule-update.json")], {
      TYPEFULLY_API_KEY: "test-token",
      TYPEFULLY_API_BASE_URL: `http://127.0.0.1:${server.port}/v2`,
    })

    const payload = expectJson<{
      ok: boolean
      command: string
      data: {
        schedule: {
          social_set_id: number
          rules: Array<{ h: number; m: number; days: string[] }>
        }
      }
    }>(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe("")
    expect(payload.command).toBe("queue schedule update")
    expect(payload.data.schedule.rules).toEqual([{ h: 9, m: 30, days: ["mon", "wed", "fri"] }])
    expect(requestBodies).toEqual([
      {
        rules: [{ h: 9, m: 30, days: ["mon", "wed", "fri"] }],
      },
    ])
    expect(requests).toEqual(["PUT /v2/social-sets/123/queue/schedule"])
  })

  test("queue get returns a structured error when required fields are missing", async () => {
    const result = await runCli(
      ["queue", "get", '{"social_set_id":123,"start_date":"2026-02-12"}'],
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
        details: { source: string; reason: string }
      }
    }>(result.stderr)

    expect(result.exitCode).toBe(1)
    expect(result.stdout.trim()).toBe("")
    expect(payload.command).toBe("queue get")
    expect(payload.error.type).toBe("JsonInputError")
    expect(payload.error.message).toContain("end_date")
  })

  test("queue get validates date strings before hitting the API", async () => {
    const result = await runCli(
      ["queue", "get", '{"social_set_id":123,"start_date":"2026-02-30","end_date":"2026-03-01"}'],
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
      command: "queue get",
      error: {
        type: "CommandInputError",
        message: "start_date must be a valid date string in YYYY-MM-DD format",
        details: { field: "start_date" },
      },
    })
  })

  test("queue schedule update validates rule days before hitting the API", async () => {
    const result = await runCli(
      [
        "queue",
        "schedule",
        "update",
        '{"social_set_id":123,"rules":[{"h":9,"m":30,"days":["monday"]}]}',
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
      command: "queue schedule update",
      error: {
        type: "CommandInputError",
        message: "days must be one of mon, tue, wed, thu, fri, sat, sun",
        details: { field: "rules[0].days[0]" },
      },
    })
  })

  test("queue schedule update surfaces Typefully API errors", async () => {
    const requests: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        requests.push(`${request.method} ${new URL(request.url).pathname}`)

        return new Response(
          JSON.stringify({
            error: {
              code: "VALIDATION_ERROR",
              message: "Some fields are invalid.",
              details: [
                {
                  field: "rules.0.days",
                  message: "Duplicate day and time combinations are not allowed.",
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
      [
        "queue",
        "schedule",
        "update",
        '{"social_set_id":123,"rules":[{"h":9,"m":30,"days":["mon","wed","fri"]}]}',
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
    expect(payload.command).toBe("queue schedule update")
    expect(payload.error.type).toBe("TypefullyApiError")
    expect(payload.error.details.status).toBe(422)
    expect(requests).toEqual(["PUT /v2/social-sets/123/queue/schedule"])
  })
})
