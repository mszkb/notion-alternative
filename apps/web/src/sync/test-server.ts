import { type ChildProcess, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** The PHP server (ADR 0018); needs `composer install` in apps/server-php. */
export const SERVER_DIR = fileURLToPath(new URL('../../../server-php/', import.meta.url))

/**
 * Starts the real server for an integration test (PHP's built-in web server), in its own
 * process group so that a kill reaches every worker.
 */
export function spawnServer(
  port: number,
  databasePath: string,
  env: Record<string, string> = {},
): ChildProcess {
  return spawn('php', ['-S', `127.0.0.1:${port}`, '-t', 'public', 'public/index.php'], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PHP_CLI_SERVER_WORKERS: '4',
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
 * Waits until the server answers `/api/ready`. Under `pnpm test` all packages test in parallel,
 * so the wait is long; callers give their hook a timeout above it. Fails at once if the server process exits.
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
