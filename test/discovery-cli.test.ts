import { describe, expect, test } from "bun:test"

import { expectJson, runCli } from "./helpers/cli"

describe("typefully discovery commands", () => {
  test("doctor reports local readiness without requiring an API key", async () => {
    const result = await runCli(["doctor"], {
      TYPEFULLY_API_KEY: undefined,
      TYPEFULLY_API_BASE_URL: undefined,
    })

    const payload = expectJson<{
      ok: boolean
      command: string
      data: {
        status: string
        checks: Array<{ name: string; ok: boolean }>
      }
    }>(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe("")
    expect(payload.command).toBe("doctor")
    expect(payload.data.status).toBe("attention_required")
    expect(payload.data.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "config.api_base_url", ok: true }),
        expect.objectContaining({ name: "config.api_key", ok: false }),
        expect.objectContaining({ name: "api.auth", ok: false }),
      ]),
    )
  })

  test("capabilities documents batch, artifact, and idempotency support", async () => {
    const result = await runCli(["capabilities"], {
      TYPEFULLY_API_KEY: undefined,
      TYPEFULLY_API_BASE_URL: undefined,
    })

    const payload = expectJson<{
      ok: boolean
      command: string
      data: {
        batch: { outcome_values: string[]; partial_failure_exit_code: number }
        idempotency: { supported: boolean; strategy: string }
        commands: Array<{
          command_id: string
          output?: { modes: string[] }
          batch?: { accepts_batch: boolean }
          idempotency?: { supported: boolean }
        }>
      }
    }>(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe("")
    expect(payload.command).toBe("capabilities")
    expect(payload.data.batch.outcome_values).toEqual(["succeeded", "partial_failure", "failed"])
    expect(payload.data.batch.partial_failure_exit_code).toBe(1)
    expect(payload.data.idempotency.supported).toBe(false)
    expect(payload.data.idempotency.strategy).toContain("does not expose documented idempotency keys")
    expect(payload.data.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command_id: "drafts.create",
          batch: expect.objectContaining({ accepts_batch: true }),
          idempotency: expect.objectContaining({ supported: false }),
        }),
        expect.objectContaining({
          command_id: "analytics.posts",
          output: expect.objectContaining({ modes: ["inline", "artifact", "auto"] }),
        }),
      ]),
    )
  })

  test("schema list and show expose Effect-derived JSON schemas", async () => {
    const listResult = await runCli(["schema", "list"], {
      TYPEFULLY_API_KEY: undefined,
      TYPEFULLY_API_BASE_URL: undefined,
    })
    const listPayload = expectJson<{
      data: { schemas: Array<{ command_id: string; schema_id: string }> }
    }>(listResult.stdout)

    expect(listResult.exitCode).toBe(0)
    expect(listPayload.data.schemas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command_id: "social-sets.list",
          schema_id: "social-sets.list.input/v1",
        }),
      ]),
    )

    const showResult = await runCli(["schema", "show", "social-sets.list"], {
      TYPEFULLY_API_KEY: undefined,
      TYPEFULLY_API_BASE_URL: undefined,
    })
    const showPayload = expectJson<{
      data: {
        command_id: string
        accepts_batch: boolean
        schema: { properties: Record<string, unknown> }
      }
    }>(showResult.stdout)

    expect(showResult.exitCode).toBe(0)
    expect(showPayload.data.command_id).toBe("social-sets.list")
    expect(showPayload.data.accepts_batch).toBe(false)
    expect(showPayload.data.schema.properties.limit).toBeDefined()
    expect(showPayload.data.schema.properties.offset).toBeDefined()
  })

  test("examples list and show prefer @file payloads", async () => {
    const listResult = await runCli(["examples", "list"], {
      TYPEFULLY_API_KEY: undefined,
      TYPEFULLY_API_BASE_URL: undefined,
    })
    const listPayload = expectJson<{
      data: { examples: Array<{ command_id: string; name: string }> }
    }>(listResult.stdout)

    expect(listResult.exitCode).toBe(0)
    expect(listPayload.data.examples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command_id: "analytics.posts",
          name: "write analytics posts artifact",
        }),
      ]),
    )

    const showResult = await runCli(["examples", "show", "analytics posts"], {
      TYPEFULLY_API_KEY: undefined,
      TYPEFULLY_API_BASE_URL: undefined,
    })
    const showPayload = expectJson<{
      data: {
        command_id: string
        examples: Array<{ args: string[] }>
      }
    }>(showResult.stdout)

    expect(showResult.exitCode).toBe(0)
    expect(showPayload.data.command_id).toBe("analytics.posts")
    expect(showPayload.data.examples[0]?.args).toContain("@examples/analytics/posts.json")
  })
})
