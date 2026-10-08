import 'fake-indexeddb/auto'
import type { ChildProcess } from 'node:child_process'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { type Change, newId, type SyncPushResult } from '@notion-alt/shared'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { LocalDb } from '../local/db'
import { LocalStore } from '../local/store'
import { pushQueue } from './push'
import { spawnServer, waitForServer } from './test-server'

// #73: the server process dies (SIGKILL) in the middle of a sync and comes back with the same
// database. No local change may be lost or applied twice.

const PORT = 3800 + Math.floor(Math.random() * 500)
const BASE = `http://127.0.0.1:${PORT}`
const DB_PATH = path.join(tmpdir(), `notion-alt-restart-${Date.now()}.sqlite`)
let server: ChildProcess | null = null

async function startServer() {
  server = spawnServer(PORT, DB_PATH)
  await waitForServer(server, BASE)
}

async function killServer() {
  const running = server
  if (!running?.pid) return
  const exited = new Promise((resolve) => running.once('exit', resolve))
  process.kill(-running.pid, 'SIGKILL')
  await exited
  server = null
  // Wait until the port is free again.
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${BASE}/api/ready`)
    } catch {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

beforeAll(startServer, 60_000)
afterAll(async () => {
  await killServer()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

async function call<T>(cookie: string, method: string, url: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE}/api${url}`, {
    method,
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) throw new Error(`${method} ${url}: ${response.status}`)
  return (response.status === 204 ? undefined : await response.json()) as T
}

it('a server restart during push loses nothing and applies nothing twice', async () => {
  const response = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'restart@example.com', password: 'correct horse battery' }),
  })
  const cookie = response.headers.get('set-cookie')!.split(';')[0]!
  const { workspaces } = await call<{ workspaces: { id: string }[] }>(cookie, 'GET', '/workspaces')
  const workspaceId = workspaces[0]!.id
  const store = await LocalStore.open(new LocalDb(`restart-${newId()}`))
  // Pre-ADR-0017 behaviour: every page's content is synced.
  await store.db.meta.put({ key: 'offlineMode', value: 'all' })
  await call(cookie, 'POST', '/devices', { id: store.deviceId, name: 'Laptop' })

  const page = await store.createDocument({ workspaceId, title: 'Viele Blöcke' })
  for (let i = 0; i < 150; i++) {
    await store.createBlock(page.id, { type: 'paragraph', content: `Block ${i}` })
  }
  const queued = await store.pendingOperationCount()

  // Small batches; the server is killed while the third batch is in flight.
  let batches = 0
  const send = async (input: { operations: unknown[] }) => {
    batches++
    const request = call<{ results: SyncPushResult[] }>(cookie, 'POST', '/sync/push', input)
    if (batches === 3) {
      // Rejects while the server is being killed; pushQueue sees the rejection below.
      request.catch(() => {})
      await new Promise((resolve) => setTimeout(resolve, 2))
      await killServer()
    }
    return request
  }
  const limits = { maxOperations: 20, maxBytes: 1_000_000 }
  await expect(pushQueue(store, send, limits)).rejects.toThrow()
  expect(await store.pendingOperationCount()).toBeGreaterThan(0)

  await startServer()
  await pushQueue(store, send, limits)
  expect(await store.pendingOperationCount()).toBe(0)

  const snapshot = await call<{ blocks: { content: string }[] }>(
    cookie,
    'GET',
    `/sync/snapshot?workspaceId=${workspaceId}`,
  )
  const local = (await store.listBlocks(page.id)).map((b) => b.content).sort()
  expect(snapshot.blocks.map((b) => b.content).sort()).toEqual(local)

  // Every operation exactly once in the change log.
  const log = await call<{ changes: Change[] }>(
    cookie,
    'GET',
    `/sync/log?workspaceId=${workspaceId}`,
  )
  const opIds = log.changes.map((c) => c.opId)
  expect(new Set(opIds).size).toBe(opIds.length)
  expect(opIds).toHaveLength(queued)
}, 120_000)
