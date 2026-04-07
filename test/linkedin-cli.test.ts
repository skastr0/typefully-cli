import { afterEach, describe, expect, test } from "bun:test"

import { expectJson, runCli } from "./helpers/cli"

const servers: Array<{ stop: () => void }> = []

const examplePath = (name: string) => `@examples/linkedin/${name}`

const linkedInOrganizationResponse = (overrides: Record<string, unknown> = {}) => ({
  id: "987654",
  urn: "urn:li:organization:987654",
  mention_text: "@[Typefully](urn:li:organization:987654)",
  name: "Typefully",
  vanity_name: "typefullycom",
  description: "Social media publishing for creators.",
  website: "https://typefully.com",
  logo_url: "https://cdn.example.com/typefully.png",
  url: "https://www.linkedin.com/company/typefullycom/",
  ...overrides,
})

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop()
  }
})

describe("typefully linkedin commands", () => {
  test("linkedin organizations resolve loads @file JSON input and forwards the organization URL", async () => {
    const requests: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        requests.push(`${request.method} ${url.pathname}?${url.searchParams.toString()}`)

        return new Response(JSON.stringify(linkedInOrganizationResponse()), {
          headers: { "content-type": "application/json" },
        })
      },
    })
    servers.push(server)

    const result = await runCli(
      ["linkedin", "organizations", "resolve", examplePath("organizations-resolve.json")],
      {
        TYPEFULLY_API_KEY: "test-token",
        TYPEFULLY_API_BASE_URL: `http://127.0.0.1:${server.port}/v2`,
      },
    )

    const payload = expectJson<{
      ok: boolean
      command: string
      data: {
        organization: {
          id: string
          urn: string
          mention_text: string
          name?: string
          url?: string | null
        }
      }
    }>(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe("")
    expect(payload.command).toBe("linkedin organizations resolve")
    expect(payload.data.organization).toMatchObject({
      id: "987654",
      urn: "urn:li:organization:987654",
      mention_text: "@[Typefully](urn:li:organization:987654)",
      name: "Typefully",
      url: "https://www.linkedin.com/company/typefullycom/",
    })
    expect(requests).toEqual([
      "GET /v2/social-sets/123/linkedin/organizations/resolve?organization_url=https%3A%2F%2Fwww.linkedin.com%2Fcompany%2Ftypefullycom%2F",
    ])
  })

  test("linkedin organizations resolve validates organization_url before hitting the API", async () => {
    const result = await runCli(
      [
        "linkedin",
        "organizations",
        "resolve",
        '{"social_set_id":123,"organization_url":"not-a-url"}',
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
      command: "linkedin organizations resolve",
      error: {
        type: "CommandInputError",
        message: "organization_url must be a valid absolute URL",
        details: { field: "organization_url" },
      },
    })
  })

  test("linkedin organizations resolve surfaces Typefully API errors", async () => {
    const requests: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        requests.push(`${request.method} ${url.pathname}?${url.searchParams.toString()}`)

        return new Response(
          JSON.stringify({
            error: {
              code: "NOT_FOUND",
              message: "LinkedIn organization not found.",
            },
          }),
          {
            status: 404,
            headers: { "content-type": "application/json" },
          },
        )
      },
    })
    servers.push(server)

    const result = await runCli(
      [
        "linkedin",
        "organizations",
        "resolve",
        '{"social_set_id":123,"organization_url":"https://www.linkedin.com/company/unknown/"}',
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
    expect(payload.command).toBe("linkedin organizations resolve")
    expect(payload.error.type).toBe("TypefullyApiError")
    expect(payload.error.message).toBe("LinkedIn organization not found.")
    expect(payload.error.details.status).toBe(404)
    expect(requests).toEqual([
      "GET /v2/social-sets/123/linkedin/organizations/resolve?organization_url=https%3A%2F%2Fwww.linkedin.com%2Fcompany%2Funknown%2F",
    ])
  })
})
