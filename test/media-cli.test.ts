import { unlink } from "node:fs/promises"
import { basename } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"

import { expectJson, runCli } from "./helpers/cli"

const servers: Array<{ stop: () => void }> = []
const tempFiles: string[] = []

const createTempMediaFile = async (contents: Uint8Array) => {
  const filePath = `/tmp/typefully-cli-media-${Date.now()}-${Math.random().toString(16).slice(2)}.png`
  await Bun.write(filePath, contents)
  tempFiles.push(filePath)
  return filePath
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.stop()
  }

  await Promise.all(
    tempFiles.splice(0).map((filePath) => unlink(filePath).catch(() => undefined)),
  )
})

describe("typefully media upload", () => {
  test("media upload performs the presign, raw PUT upload, and ready polling flow", async () => {
    const uploadedBodies: Uint8Array[] = []
    const uploadedHeaders: Array<{ authorization: string | null; contentType: string | null }> = []
    const requests: string[] = []
    const mediaFile = await createTempMediaFile(new Uint8Array([137, 80, 78, 71]))

    let statusChecks = 0
    let server!: ReturnType<typeof Bun.serve>
    server = Bun.serve({
      port: 0,
      async fetch(request): Promise<Response> {
        const url = new URL(request.url)
        requests.push(`${request.method} ${url.pathname}`)

        if (request.method === "POST" && url.pathname === "/v2/social-sets/123/media/upload") {
          return new Response(
            JSON.stringify({
              media_id: "media-123",
              upload_url: `http://127.0.0.1:${server.port}/presigned/media-123?token=test`,
            }),
            {
              status: 201,
              headers: { "content-type": "application/json" },
            },
          )
        }

        if (request.method === "PUT" && url.pathname === "/presigned/media-123") {
          uploadedBodies.push(new Uint8Array(await request.arrayBuffer()))
          uploadedHeaders.push({
            authorization: request.headers.get("authorization"),
            contentType: request.headers.get("content-type"),
          })
          return new Response(null, { status: 204 })
        }

        if (request.method === "GET" && url.pathname === "/v2/social-sets/123/media/media-123") {
          statusChecks += 1

          return new Response(
            JSON.stringify({
              media_id: "media-123",
              file_name: basename(mediaFile),
              status: statusChecks === 1 ? "processing" : "ready",
              error_reason: null,
              media_urls:
                statusChecks === 1
                  ? null
                  : {
                      original: "https://cdn.example.com/media-123/original.png",
                      medium: "https://cdn.example.com/media-123/medium.png",
                    },
              mime: "image/png",
            }),
            {
              headers: { "content-type": "application/json" },
            },
          )
        }

        return new Response("not found", { status: 404 })
      },
    })
    servers.push(server)

    const result = await runCli(
      [
        "media",
        "upload",
        JSON.stringify({
          social_set_id: 123,
          file_path: mediaFile,
          poll_interval_ms: 1,
          timeout_seconds: 5,
        }),
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
        media_id: string
        social_set_id: number
        file_name: string
        status: string
        waited: boolean
        message: string
        media: {
          status: string
          media_urls: { original: string }
        }
      }
    }>(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe("")
    expect(payload.command).toBe("media upload")
    expect(payload.data).toMatchObject({
      media_id: "media-123",
      social_set_id: 123,
      file_name: basename(mediaFile),
      status: "ready",
      waited: true,
      message: "Media uploaded and ready to use",
      media: {
        status: "ready",
        media_urls: {
          original: "https://cdn.example.com/media-123/original.png",
        },
      },
    })
    expect(requests).toEqual([
      "POST /v2/social-sets/123/media/upload",
      "PUT /presigned/media-123",
      "GET /v2/social-sets/123/media/media-123",
      "GET /v2/social-sets/123/media/media-123",
    ])
    expect(uploadedBodies).toEqual([new Uint8Array([137, 80, 78, 71])])
    expect(uploadedHeaders).toEqual([
      {
        authorization: null,
        contentType: null,
      },
    ])
  })

  test("media upload can return immediately after the raw upload", async () => {
    const mediaFile = await createTempMediaFile(new Uint8Array([1, 2, 3]))
    const requests: string[] = []

    let server!: ReturnType<typeof Bun.serve>
    server = Bun.serve({
      port: 0,
      fetch(request): Response {
        const url = new URL(request.url)
        requests.push(`${request.method} ${url.pathname}`)

        if (request.method === "POST" && url.pathname === "/v2/social-sets/123/media/upload") {
          return new Response(
            JSON.stringify({
              media_id: "media-456",
              upload_url: `http://127.0.0.1:${server.port}/presigned/media-456`,
            }),
            {
              status: 201,
              headers: { "content-type": "application/json" },
            },
          )
        }

        if (request.method === "PUT" && url.pathname === "/presigned/media-456") {
          return new Response(null, { status: 200 })
        }

        return new Response("not found", { status: 404 })
      },
    })
    servers.push(server)

    const result = await runCli(
      [
        "media",
        "upload",
        JSON.stringify({
          social_set_id: 123,
          file_path: mediaFile,
          wait_for_ready: false,
        }),
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
        media_id: string
        status: string
        waited: boolean
        message: string
      }
    }>(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe("")
    expect(payload.command).toBe("media upload")
    expect(payload.data).toMatchObject({
      media_id: "media-456",
      status: "processing",
      waited: false,
      message: "Media uploaded. Poll later if it is not ready yet.",
    })
    expect(requests).toEqual([
      "POST /v2/social-sets/123/media/upload",
      "PUT /presigned/media-456",
    ])
  })

  test("media upload redacts the presigned URL from surfaced upload errors", async () => {
    const mediaFile = await createTempMediaFile(new Uint8Array([4, 5, 6]))
    const secretUploadUrl = "http://127.0.0.1:9999/presigned/media-secret?signature=top-secret"
    const providerBody = `SignatureDoesNotMatch for ${secretUploadUrl}`

    let server!: ReturnType<typeof Bun.serve>
    server = Bun.serve({
      port: 0,
      fetch(request): Response {
        const url = new URL(request.url)

        if (request.method === "POST" && url.pathname === "/v2/social-sets/123/media/upload") {
          return new Response(
            JSON.stringify({
              media_id: "media-secret",
              upload_url: `http://127.0.0.1:${server.port}/presigned/media-secret?signature=top-secret`,
            }),
            {
              status: 201,
              headers: { "content-type": "application/json" },
            },
          )
        }

        if (request.method === "PUT" && url.pathname === "/presigned/media-secret") {
          return new Response(providerBody, { status: 403 })
        }

        return new Response("not found", { status: 404 })
      },
    })
    servers.push(server)

    const result = await runCli(
      [
        "media",
        "upload",
        JSON.stringify({
          social_set_id: 123,
          file_path: mediaFile,
          wait_for_ready: false,
        }),
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
        details: Record<string, unknown>
      }
    }>(result.stderr)

    expect(result.exitCode).toBe(1)
    expect(result.stdout.trim()).toBe("")
    expect(payload).toMatchObject({
      ok: false,
      command: "media upload",
      error: {
        type: "MediaUploadError",
        message: "Presigned upload failed with status 403. Request a new upload URL and retry.",
        details: {
          file_path: mediaFile,
          status: 403,
        },
      },
    })
    expect(payload.error.details.upload_url).toBeUndefined()
    expect(result.stderr).not.toContain(secretUploadUrl)
    expect(result.stderr).not.toContain(providerBody)
    expect(result.stderr).not.toContain("upload_url")
  })

  test("media upload returns a timed_out processing result when readiness polling expires", async () => {
    const mediaFile = await createTempMediaFile(new Uint8Array([7, 8, 9]))
    const requests: string[] = []

    let server!: ReturnType<typeof Bun.serve>
    server = Bun.serve({
      port: 0,
      fetch(request): Response {
        const url = new URL(request.url)
        requests.push(`${request.method} ${url.pathname}`)

        if (request.method === "POST" && url.pathname === "/v2/social-sets/123/media/upload") {
          return new Response(
            JSON.stringify({
              media_id: "media-timeout",
              upload_url: `http://127.0.0.1:${server.port}/presigned/media-timeout`,
            }),
            {
              status: 201,
              headers: { "content-type": "application/json" },
            },
          )
        }

        if (request.method === "PUT" && url.pathname === "/presigned/media-timeout") {
          return new Response(null, { status: 204 })
        }

        if (request.method === "GET" && url.pathname === "/v2/social-sets/123/media/media-timeout") {
          return new Response(
            JSON.stringify({
              media_id: "media-timeout",
              file_name: basename(mediaFile),
              status: "processing",
              error_reason: null,
              media_urls: null,
              mime: "image/png",
            }),
            {
              headers: { "content-type": "application/json" },
            },
          )
        }

        return new Response("not found", { status: 404 })
      },
    })
    servers.push(server)

    const result = await runCli(
      [
        "media",
        "upload",
        JSON.stringify({
          social_set_id: 123,
          file_path: mediaFile,
          timeout_seconds: 1,
          poll_interval_ms: 200,
        }),
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
        media_id: string
        status: string
        waited: boolean
        timed_out: boolean
        message: string
        media: {
          status: string
        }
      }
    }>(result.stdout)

    expect(result.exitCode).toBe(0)
    expect(result.stderr.trim()).toBe("")
    expect(payload.command).toBe("media upload")
    expect(payload.data).toMatchObject({
      media_id: "media-timeout",
      status: "processing",
      waited: true,
      timed_out: true,
      message: "Media uploaded but is still processing",
      media: {
        status: "processing",
      },
    })
    expect(requests[0]).toBe("POST /v2/social-sets/123/media/upload")
    expect(requests[1]).toBe("PUT /presigned/media-timeout")
    expect(requests.slice(2).every((request) => request === "GET /v2/social-sets/123/media/media-timeout")).toBe(true)
    expect(requests.length).toBeGreaterThanOrEqual(3)
  })

  test("media upload returns a structured error envelope when processing fails", async () => {
    const mediaFile = await createTempMediaFile(new Uint8Array([9, 9, 9]))

    let server!: ReturnType<typeof Bun.serve>
    server = Bun.serve({
      port: 0,
      fetch(request): Response {
        const url = new URL(request.url)

        if (request.method === "POST" && url.pathname === "/v2/social-sets/123/media/upload") {
          return new Response(
            JSON.stringify({
              media_id: "media-failed",
              upload_url: `http://127.0.0.1:${server.port}/presigned/media-failed`,
            }),
            {
              status: 201,
              headers: { "content-type": "application/json" },
            },
          )
        }

        if (request.method === "PUT" && url.pathname === "/presigned/media-failed") {
          return new Response(null, { status: 204 })
        }

        if (request.method === "GET" && url.pathname === "/v2/social-sets/123/media/media-failed") {
          return new Response(
            JSON.stringify({
              media_id: "media-failed",
              file_name: basename(mediaFile),
              status: "failed",
              error_reason: {
                code: "UNSUPPORTED_MEDIA",
                message: "The uploaded file could not be processed",
              },
              media_urls: null,
              mime: "image/png",
            }),
            {
              headers: { "content-type": "application/json" },
            },
          )
        }

        return new Response("not found", { status: 404 })
      },
    })
    servers.push(server)

    const result = await runCli(
      [
        "media",
        "upload",
        JSON.stringify({
          social_set_id: 123,
          file_path: mediaFile,
          poll_interval_ms: 1,
          timeout_seconds: 5,
        }),
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
        details: {
          social_set_id: number
          media_id: string
          reason: { code: string; message: string }
        }
      }
    }>(result.stderr)

    expect(result.exitCode).toBe(1)
    expect(result.stdout.trim()).toBe("")
    expect(payload).toMatchObject({
      ok: false,
      command: "media upload",
      error: {
        type: "MediaProcessingError",
        message: "Typefully reported media processing failure",
        details: {
          social_set_id: 123,
          media_id: "media-failed",
          reason: {
            code: "UNSUPPORTED_MEDIA",
            message: "The uploaded file could not be processed",
          },
        },
      },
    })
  })
})
