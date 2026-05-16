import { join, resolve } from "node:path"

import {
  TYPEFULLY_ARTIFACT_DIR_ENV,
  TYPEFULLY_AUTH_PATH_ENV,
  TYPEFULLY_CACHE_DIR_ENV,
  TYPEFULLY_HOME_ENV,
} from "./constants"

export interface RuntimePaths {
  readonly homeDir: string
  readonly typefullyHome: string
  readonly authPath: string
  readonly cacheDir: string
  readonly artifactsDir: string
}

const expandHomePath = (value: string, homeDir: string) => {
  if (value === "~") {
    return homeDir
  }

  return value.startsWith("~/") ? join(homeDir, value.slice(2)) : value
}

const optionalEnv = (env: NodeJS.ProcessEnv, key: string) => {
  const value = env[key]?.trim()
  return value && value.length > 0 ? value : undefined
}

export const resolveRuntimePaths = (env: NodeJS.ProcessEnv = process.env): RuntimePaths => {
  const homeDir = env.HOME ?? process.cwd()
  const typefullyHome = resolve(expandHomePath(optionalEnv(env, TYPEFULLY_HOME_ENV) ?? "~/.typefully", homeDir))
  const authPath = resolve(
    expandHomePath(optionalEnv(env, TYPEFULLY_AUTH_PATH_ENV) ?? join(typefullyHome, "auth.json"), homeDir),
  )
  const cacheDir = resolve(
    expandHomePath(optionalEnv(env, TYPEFULLY_CACHE_DIR_ENV) ?? join(typefullyHome, "cache"), homeDir),
  )
  const artifactsDir = resolve(
    expandHomePath(optionalEnv(env, TYPEFULLY_ARTIFACT_DIR_ENV) ?? join(typefullyHome, "artifacts"), homeDir),
  )

  return {
    homeDir,
    typefullyHome,
    authPath,
    cacheDir,
    artifactsDir,
  }
}
