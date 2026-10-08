import 'fake-indexeddb/auto'
import type { ChildProcess } from 'node:child_process'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { newId, type SyncPullQuery, type SyncPushResult } from '@notion-alt/shared'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { ApiError } from '../api'
import { LocalDb } from '../local/db'
import { LocalStore } from '../local/store'
import { pushQueue } from './push'
import { syncWorkspace } from './resync'
import { spawnServer, waitForServer } from './test-server'

// #75: the server is restored from a backup older than what the devices synced. Devices must
// re-sync (410) and send again what the restored server lost, without losing local data.

const PORT = 4400 + Math.floor(Math.random() * 500)
const BASE = `http://127.0.0.1:${PORT}`
const DB_PATH = path.join(tmpdir(), `notion-alt-restore-${Date.now()}.sqlite`)
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
  if (!response.ok) throw new ApiError(response.status, 'error', `${method} ${url}`)
  return (response.status === 204 ? undefined : await response.json()) as T
}

/** Runs a one-off server command (backup/restore) against the same database. */
function serverCommand(...args: string[]) {
  return execFileSync(
    'pnpm',
    ['--filter', '@notion-alt/server', 'exec', 'tsx', 'src/index.ts', ...args],
    { env: { ...process.env, DATABASE_PATH: DB_PATH, LOG_LEVEL: 'silent' }, encoding: 'utf8' },
  )
}

it('devices re-sync after a restore and send what the backup lacks', async () => {
  const response = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'restore@example.com', password: 'correct horse battery' }),
  })
  const cookie = response.headers.get('set-cookie')!.split(';')[0]!
  const { workspaces } = await call<{ workspaces: { id: string }[] }>(cookie, 'GET', '/workspaces')
  const workspaceId = workspaces[0]!.id
  const store = await LocalStore.open(new LocalDb(`restore-${newId()}`))
  // Pre-ADR-0017 behaviour: every page's content is synced.
  await store.db.meta.put({ key: 'offlineMode', value: 'all' })
  await call(cookie, 'POST', '/devices', { id: store.deviceId, name: 'Laptop' })
  const transport = {
    push: (input: unknown) =>
      call<{ results: SyncPushResult[] }>(cookie, 'POST', '/sync/push', input),
    pull: ({ workspaceId, cursor, limit }: SyncPullQuery) =>
      call<never>(
        cookie,
        'GET',
        `/sync/pull?${new URLSearchParams({ workspaceId, cursor: String(cursor), limit: String(limit) })}`,
      ),
    snapshot: (id: string) => call<never>(cookie, 'GET', `/sync/snapshot?workspaceId=${id}`),
  }
  const sync = async () => {
    await pushQueue(store, transport.push)
    await syncWorkspace(store, workspaceId, transport)
  }

  const before = await store.createDocument({ workspaceId, title: 'Vor dem Backup' })
  await sync()
  const backupRoot = mkdtempSync(path.join(tmpdir(), 'notion-alt-backups-'))
  const { dir } = JSON.parse(serverCommand('backup', backupRoot).trim().split('\n').at(-1)!)

  const after = await store.createDocument({ workspaceId, title: 'Nach dem Backup' })
  await store.renameDocument(before.id, 'Vor dem Backup, umbenannt')
  await sync()
  expect(await store.pendingOperationCount()).toBe(0)

  await killServer()
  serverCommand('restore', dir, '--force')
  await startServer()

  // The next sync notices the restore, rebuilds from the snapshot and re-sends what is missing.
  await sync()
  await sync()
  expect(await store.pendingOperationCount()).toBe(0)
  const local = (await store.listDocuments(workspaceId)).map((d) => d.title).sort()
  expect(local).toContain('Nach dem Backup')
  const server = await call<{
    documents: { id: string; title: string; deletedAt: string | null }[]
  }>(cookie, 'GET', `/sync/snapshot?workspaceId=${workspaceId}`)
  expect(server.documents.find((d) => d.id === after.id)?.title).toBe('Nach dem Backup')
  // A change made after the backup to an entity the backup has is sent again too.
  expect(server.documents.find((d) => d.id === before.id)?.title).toBe('Vor dem Backup, umbenannt')
  expect(local).toEqual(
    server.documents
      .filter((d) => !d.deletedAt)
      .map((d) => d.title)
      .sort(),
  )
  rmSync(backupRoot, { recursive: true, force: true })
}, 180_000)
