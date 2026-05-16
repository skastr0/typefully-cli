import { describe, expect, test } from "bun:test"

import { resolveRuntimePaths } from "../src/core/runtime-paths"

describe("runtime paths", () => {
  test("resolves home, auth, cache, and artifact overrides", () => {
    const paths = resolveRuntimePaths({
      HOME: "/tmp/home",
      TYPEFULLY_HOME: "/tmp/typefully-home",
      TYPEFULLY_AUTH_PATH: "/tmp/typefully-auth/auth.json",
      TYPEFULLY_CACHE_DIR: "/tmp/typefully-cache",
      TYPEFULLY_ARTIFACT_DIR: "/tmp/typefully-artifacts",
    })

    expect(paths.homeDir).toBe("/tmp/home")
    expect(paths.typefullyHome).toBe("/tmp/typefully-home")
    expect(paths.authPath).toBe("/tmp/typefully-auth/auth.json")
    expect(paths.cacheDir).toBe("/tmp/typefully-cache")
    expect(paths.artifactsDir).toBe("/tmp/typefully-artifacts")
  })
})
