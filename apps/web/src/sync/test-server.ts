import { type ChildProcess, spawn } from 'node:child_process'

/**
 * Starts the real server for an integration test, in its own process group so that a kill
 * reaches tsx and node, not only pnpm.
 */
export function spawnServer(
  port: number,
  databasePath: string,
  env: Record<string, string> = {},
): ChildProcess {
  return spawn('pnpm', ['--filter', '@notion-alt/server', 'exec', 'tsx', 'src/index.ts'], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATABASE_PATH: databasePath,
      LOG_LEVEL: 'silent',
      ALLOW_REGISTRATION: 'true',
      ...env,
    },
    stdio: 'ignore',
    detached: true,
  })
}

/**
 * Waits until the server answers `/api/ready`. Under `pnpm test` all packages test in parallel
 * and tsx starts slowly, so the wait is long (a fixed 15 s failed once); callers give their hook
 * a timeout above it. Fails at once if the server process exits.
 */
export async function waitForServer(
  child: ChildProcess,
  base: string,
  timeoutMs = 50_000,
): Promise<void> {
  let exited = child.exitCode !== null || child.signalCode !== null
  child.once('exit', () => (exited = true))
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (exited) throw new Error(`server exited (code ${child.exitCode}, ${child.signalCode})`)
    try {
      const ready = await fetch(`${base}/api/ready`, { signal: AbortSignal.timeout(2_000) })
      if (ready.ok) return
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`server did not start within ${timeoutMs / 1000} s`)
}
