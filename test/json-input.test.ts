import { describe, expect, test } from "bun:test"
import { BunContext } from "@effect/platform-bun"
import { Effect, Schema } from "effect"

import { loadJsonInput } from "../src/core/json"

const ExampleSchema = Schema.Struct({
  name: Schema.String,
  enabled: Schema.Boolean,
})

describe("loadJsonInput", () => {
  test("loads raw inline JSON", async () => {
    const value = await Effect.runPromise(
      loadJsonInput(ExampleSchema, '{"name":"draft","enabled":true}').pipe(
        Effect.provide(BunContext.layer),
      ),
    )

    expect(value).toEqual({
      name: "draft",
      enabled: true,
    })
  })

  test("loads JSON from @file input", async () => {
    const tempPath = `/tmp/typefully-cli-json-${Date.now()}.json`
    await Bun.write(tempPath, '{"name":"file","enabled":false}')

    const value = await Effect.runPromise(
      loadJsonInput(ExampleSchema, `@${tempPath}`).pipe(Effect.provide(BunContext.layer)),
    )

    expect(value).toEqual({
      name: "file",
      enabled: false,
    })
  })
})
