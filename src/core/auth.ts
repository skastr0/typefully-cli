import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

import { TYPEFULLY_API_KEY_ENV } from "./constants"
import { resolveRuntimePaths } from "./runtime-paths"

export interface StoredAuth {
  readonly api_key?: string
}

export interface StoredAuthStatus {
  readonly auth_path: string
  readonly api_key_configured: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const normalizeStoredAuth = (value: unknown): StoredAuth => {
  if (!isRecord(value)) {
    return {}
  }

  return {
    ...(typeof value.api_key === "string" && value.api_key.trim() !== "" ? { api_key: value.api_key } : {}),
  }
}

export const getAuthPath = () => resolveRuntimePaths().authPath

export const readStoredAuth = (authPath = getAuthPath()): StoredAuth => {
  if (!existsSync(authPath)) {
    return {}
  }

  return normalizeStoredAuth(JSON.parse(readFileSync(authPath, "utf8")))
}

export const readStoredAuthSafe = (authPath = getAuthPath()): StoredAuth => {
  try {
    return readStoredAuth(authPath)
  } catch {
    return {}
  }
}

const writeStoredAuth = (auth: StoredAuth, authPath = getAuthPath()) => {
  mkdirSync(dirname(authPath), { recursive: true, mode: 0o700 })
  const tempPath = `${authPath}.${process.pid}.tmp`
  writeFileSync(tempPath, `${JSON.stringify(auth, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  })
  chmodSync(tempPath, 0o600)
  renameSync(tempPath, authPath)
  chmodSync(authPath, 0o600)
}

export const saveAuthKey = (apiKey: string, authPath = getAuthPath()): StoredAuthStatus => {
  const trimmed = apiKey.trim()

  if (trimmed.length === 0) {
    throw new Error("Typefully API key must not be empty")
  }

  const current = readStoredAuthSafe(authPath)
  writeStoredAuth({ ...current, api_key: trimmed }, authPath)

  return authStatus(authPath)
}

export const importAuthFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
  authPath = getAuthPath(),
): StoredAuthStatus => {
  const apiKey = env[TYPEFULLY_API_KEY_ENV]?.trim()

  if (!apiKey) {
    throw new Error(`${TYPEFULLY_API_KEY_ENV} is not set in the current environment`)
  }

  return saveAuthKey(apiKey, authPath)
}

export const authStatus = (authPath = getAuthPath()): StoredAuthStatus => {
  const auth = readStoredAuthSafe(authPath)

  return {
    auth_path: authPath,
    api_key_configured: typeof auth.api_key === "string" && auth.api_key.trim() !== "",
  }
}
