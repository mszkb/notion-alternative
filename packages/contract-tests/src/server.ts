import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DEFAULT_SERVER_CMD, PUSH_RECEIVER_CERT, REPO_ROOT, SERVER_SETTINGS } from './config'

export interface StartedServer {
  url: string
  stop: () => Promise<void>
}

/** A port that was free a moment ago (the server binds it right after). */
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

async function waitUntilReady(url: string, child: ChildProcess, output: () => string) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`server exited (${child.exitCode ?? child.signalCode}):\n${output()}`)
    }
    try {
      const response = await fetch(`${url}/api/ready`)
      if (response.ok) return
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`server not ready after 60 s:\n${output()}`)
}

function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const kill = (signal: NodeJS.Signals) => {
      try {
        // The whole process group: pnpm and a shell sit between us and the server.
        process.kill(-child.pid!, signal)
      } catch {
        // Already gone.
      }
    }
    const timer = setTimeout(() => kill('SIGKILL'), 5000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    kill('SIGTERM')
  })
}

/**
 * Starts the server under test with a fresh data directory on a free port and waits for
 * `/api/ready`. The command comes from SERVER_CMD (default: the PHP server); it runs in the
 * repository root through the shell, gets the port as `PORT` and `{port}` is replaced by it.
 */
export async function startServer(extraEnv: Record<string, string> = {}): Promise<StartedServer> {
  const port = await freePort()
  const dataDir = await mkdtemp(path.join(tmpdir(), 'notion-alt-contract-'))
  const command = (process.env.SERVER_CMD || DEFAULT_SERVER_CMD).replaceAll('{port}', String(port))
  let output = ''
  const child = spawn(command, {
    cwd: REPO_ROOT,
    shell: true,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      DATA_DIR: dataDir,
      DATABASE_PATH: path.join(dataDir, 'app.sqlite'),
      LOG_LEVEL: 'warn',
      ...SERVER_SETTINGS,
      // Node trusts the fake push service through this; other servers can use the path.
      NODE_EXTRA_CA_CERTS: PUSH_RECEIVER_CERT,
      PUSH_RECEIVER_CA: PUSH_RECEIVER_CERT,
      ...extraEnv,
    },
  })
  const collect = (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-20_000)
    if (process.env.CONTRACT_SERVER_LOG) process.stderr.write(chunk)
  }
  child.stdout!.on('data', collect)
  child.stderr!.on('data', collect)

  const url = `http://127.0.0.1:${port}`
  try {
    await waitUntilReady(url, child, () => output)
  } catch (error) {
    await stopProcess(child)
    await rm(dataDir, { recursive: true, force: true })
    throw error
  }
  return {
    url,
    stop: async () => {
      await stopProcess(child)
      await rm(dataDir, { recursive: true, force: true })
    },
  }
}
