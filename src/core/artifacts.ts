import { mkdir, writeFile } from "node:fs/promises"
import { join, relative, resolve } from "node:path"

import { Effect } from "effect"

import { ArtifactWriteError } from "./errors"
import { resolveRuntimePaths } from "./runtime-paths"

export const OUTPUT_MODE_VALUES = ["inline", "artifact", "auto"] as const

export type OutputMode = (typeof OUTPUT_MODE_VALUES)[number]

const DEFAULT_AUTO_ARTIFACT_BYTES = 24 * 1024

export interface ArtifactRecord {
  readonly key: string
  readonly label: string
  readonly kind: "json"
  readonly absolute_path: string
  readonly relative_path: string
  readonly size_bytes: number
  readonly created_at: string
}

export interface ArtifactResult {
  readonly kind: "summary+artifact"
  readonly summary: string
  readonly artifact: ArtifactRecord
}

const artifactDir = () => {
  return resolve(resolveRuntimePaths().artifactsDir)
}

const safeSegment = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "artifact"

const timestampSegment = (createdAt: string) => createdAt.replace(/[:.]/g, "-")

const encodedJsonSize = (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value, null, 2), "utf8")

const writeJsonArtifact = (params: {
  readonly key: string
  readonly label: string
  readonly summary: string
  readonly data: unknown
}) =>
  Effect.tryPromise({
    try: async () => {
      const createdAt = new Date().toISOString()
      const directory = artifactDir()
      const fileName = `${timestampSegment(createdAt)}-${safeSegment(params.key)}.json`
      const absolutePath = join(directory, fileName)
      const contents = `${JSON.stringify(params.data, null, 2)}\n`

      await mkdir(directory, { recursive: true })
      await writeFile(absolutePath, contents, "utf8")

      return {
        kind: "summary+artifact",
        summary: params.summary,
        artifact: {
          key: params.key,
          label: params.label,
          kind: "json",
          absolute_path: absolutePath,
          relative_path: relative(process.cwd(), absolutePath),
          size_bytes: Buffer.byteLength(contents, "utf8"),
          created_at: createdAt,
        },
      } satisfies ArtifactResult
    },
    catch: (cause) =>
      new ArtifactWriteError({
        path: artifactDir(),
        message: cause instanceof Error ? cause.message : "Failed to write artifact",
      }),
  })

export const applyOutputPolicy = (params: {
  readonly outputMode: OutputMode
  readonly command: string
  readonly data: unknown
  readonly artifactKey?: string
  readonly artifactLabel?: string
  readonly summary?: string
  readonly autoThresholdBytes?: number
}) => {
  const thresholdBytes = params.autoThresholdBytes ?? DEFAULT_AUTO_ARTIFACT_BYTES
  const shouldWriteArtifact =
    params.outputMode === "artifact" ||
    (params.outputMode === "auto" && encodedJsonSize(params.data) > thresholdBytes)

  if (!shouldWriteArtifact) {
    return Effect.succeed(params.data)
  }

  const key = params.artifactKey ?? params.command.replace(/\s+/g, ".")
  const label = params.artifactLabel ?? `${params.command} response`

  return writeJsonArtifact({
    key,
    label,
    summary: params.summary ?? `Wrote ${label} to an artifact.`,
    data: params.data,
  })
}
