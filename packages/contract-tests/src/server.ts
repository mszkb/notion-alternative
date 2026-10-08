import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { TestProject } from 'vitest/node'

/**
 * Global setup (#118): tests talk HTTP to `SERVER_URL`. Without it, a server is started with
 * `SERVER_CMD` (default: the Node server) on a free port with an empty data directory, and
 * stopped afterwards. The command gets PORT, HOST, DATA_DIR, DATABASE_PATH and the settings
 * below as environment, so any implementation of the API can be tested the same way.
 */
const DEFAULT_CMD = 'pnpm --filter @notion-alt/server exec tsx src/index.ts'

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new Error('no port')),
      )
    })
  })
}

async function waitForReady(base: string, child: ChildProcess | null, timeoutMs = 60_000) {
  let exited = false
  child?.once('exit', () => (exited = true))
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (exited) throw new Error('server exited before it was ready')
    try {
      const ready = await fetch(`${base}/api/ready`, { signal: AbortSignal.timeout(2_000) })
      if (ready.ok) return
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`server at ${base} not ready within ${timeoutMs / 1000} s`)
}

export default async function setup(project: TestProject) {
  if (process.env.SERVER_URL) {
    const base = process.env.SERVER_URL.replace(/\/$/, '')
    await waitForReady(base, null)
    project.provide('serverUrl', base)
    return
  }
  const port = await freePort()
  const dataDir = mkdtempSync(path.join(tmpdir(), 'contract-'))
  const child = spawn(process.env.SERVER_CMD ?? DEFAULT_CMD, {
    shell: true,
    detached: true,
    stdio: 'ignore',
    cwd: path.resolve(import.meta.dirname, '../../..'),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      DATABASE_PATH: path.join(dataDir, 'app.sqlite'),
      ATTACHMENTS_DIR: path.join(dataDir, 'attachments'),
      LOG_LEVEL: 'silent',
      ALLOW_REGISTRATION: 'true',
      ATTACHMENT_MAX_MB: '1',
      WORKSPACE_STORAGE_MB: '2',
      PUSH_ALLOWED_HOSTS: 'push.example.com',
      // Every test registers its own accounts from one address.
      REGISTER_MAX_ATTEMPTS_PER_IP: '100000',
      LOGIN_MAX_FAILURES_PER_IP: '100000',
    },
  })
  const base = `http://127.0.0.1:${port}`
  try {
    await waitForReady(base, child)
  } catch (error) {
    if (child.pid) process.kill(-child.pid, 'SIGTERM')
    throw error
  }
  project.provide('serverUrl', base)
  return () => {
    if (child.pid) process.kill(-child.pid, 'SIGTERM')
    rmSync(dataDir, { recursive: true, force: true })
  }
}

declare module 'vitest' {
  export interface ProvidedContext {
    serverUrl: string
  }
}
