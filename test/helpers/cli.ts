import { expect } from "bun:test"

export interface CliResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export interface RunCliOptions {
  readonly stdinText?: string
}

export const runCli = async (
  args: ReadonlyArray<string>,
  env: Record<string, string | undefined>,
  options?: RunCliOptions,
): Promise<CliResult> => {
  const processEnv = Object.fromEntries(
    Object.entries({
      ...Bun.env,
      ...env,
    }).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )

  const subprocess = Bun.spawn(["bun", "run", "./src/cli.ts", ...args], {
    cwd: "/Users/guilhermecastro/Projects/typefully-cli",
    env: processEnv,
    stdin: options?.stdinText !== undefined ? new Blob([options.stdinText]) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ])

  return {
    stdout,
    stderr,
    exitCode,
  }
}

export const expectJson = <T>(text: string): T => {
  expect(text.trim().length).toBeGreaterThan(0)
  return JSON.parse(text) as T
}
