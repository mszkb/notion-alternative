import 'fake-indexeddb/auto'
import type { ChildProcess } from 'node:child_process'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  type Block,
  newId,
  type Operation,
  type SyncPullQuery,
  type SyncPullResponse,
  type SyncPushResult,
  type SyncSnapshotResponse,
} from '@notion-alt/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LocalDb } from '../local/db'
import { LocalStore } from '../local/store'
import { pushQueue } from './push'
import { syncWorkspace } from './resync'
import { spawnServer, waitForServer } from './test-server'

// Protocol-level property test (issue #67, AC-03): random edits on three devices against the
// real server, random sync order and dropped connections. Invariants: devices converge, no
// edit is lost silently (it is on the server or kept in a conflict), nothing is rejected.

const PORT = 3300 + Math.floor(Math.random() * 500)
const BASE = `http://127.0.0.1:${PORT}`
const DB_PATH = path.join(tmpdir(), `notion-alt-property-${Date.now()}.sqlite`)
let server: ChildProcess

beforeAll(async () => {
  server = spawnServer(PORT, DB_PATH, {
    LOGIN_MAX_FAILURES_PER_IP: '100000',
    REGISTER_MAX_ATTEMPTS_PER_IP: '100000',
  })
  await waitForServer(server, BASE)
}, 60_000)

afterAll(() => {
  // The whole process group: pnpm alone would leave tsx and node running.
  if (server?.pid) process.kill(-server.pid, 'SIGTERM')
  rmSync(DB_PATH, { force: true })
})

/** Seeded PRNG (mulberry32): failures can be replayed with the printed seed. */
function random(seed: number) {
  let t = seed
  return () => {
    t = (t + 0x6d2b79f5) | 0
    let x = Math.imul(t ^ (t >>> 15), 1 | t)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

async function call<T>(cookie: string, method: string, url: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE}/api${url}`, {
    method,
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) throw new Error(`${method} ${url}: ${response.status}`)
  return (response.status === 204 ? undefined : await response.json()) as T
}

async function session(email: string, register: boolean): Promise<string> {
  const response = await fetch(`${BASE}/api/auth/${register ? 'register' : 'login'}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct horse battery' }),
  })
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  if (!cookie) throw new Error(`no session: ${response.status}`)
  return cookie
}

interface Device {
  name: string
  store: LocalStore
  cookie: string
  push: (input: { operations: Operation[] }) => Promise<{ results: SyncPushResult[] }>
  pull: (query: SyncPullQuery) => Promise<SyncPullResponse>
  snapshot: (workspaceId: string) => Promise<SyncSnapshotResponse>
}

async function device(name: string, cookie: string, rand: () => number, dropRate: number) {
  const store = await LocalStore.open(new LocalDb(`property-${name}-${newId()}`))
  // Pre-ADR-0017 behaviour: every page's content is synced.
  await store.db.meta.put({ key: 'offlineMode', value: 'all' })
  await call(cookie, 'POST', '/devices', { id: store.deviceId, name })
  const d: Device = {
    name,
    store,
    cookie,
    // The server applies the batch, but the answer may get lost (T-OFF-05).
    push: async (input) => {
      const result = await call<{ results: SyncPushResult[] }>(cookie, 'POST', '/sync/push', input)
      if (rand() < dropRate) throw new Error('connection lost after push')
      return result
    },
    pull: async ({ workspaceId, cursor, limit }) => {
      if (rand() < dropRate / 2) throw new Error('connection lost during pull')
      return call(
        cookie,
        'GET',
        `/sync/pull?${new URLSearchParams({ workspaceId, cursor: String(cursor), limit: String(limit) })}`,
      )
    },
    snapshot: (workspaceId) => call(cookie, 'GET', `/sync/snapshot?workspaceId=${workspaceId}`),
  }
  return d
}

async function sync(d: Device, workspaceId: string) {
  try {
    await pushQueue(d.store, d.push)
    await syncWorkspace(d.store, workspaceId, { pull: d.pull, snapshot: d.snapshot })
  } catch {
    // Dropped connection: the next sync repeats safely.
  }
}

const view = (blocks: Block[]) =>
  blocks.map((b) => ({ id: b.id, content: b.content, type: b.type }))

async function scenario(seed: number, steps: number) {
  const rand = random(seed)
  const pick = <T>(items: T[]): T => items[Math.floor(rand() * items.length)]!
  const email = `property-${seed}-${newId()}@example.com`
  const first = await session(email, true)
  const cookies = [first, await session(email, false), await session(email, false)]
  const workspaceId = (await call<{ workspaces: { id: string }[] }>(first, 'GET', '/workspaces'))
    .workspaces[0]!.id
  const devices = await Promise.all(cookies.map((cookie, i) => device(`d${i}`, cookie, rand, 0.2)))
  for (const d of devices) await d.store.cacheWorkspaces([{ id: workspaceId } as never])

  const [origin] = devices
  const doc = await origin!.store.createDocument({ workspaceId, title: 'Gemeinsam' })
  for (const word of ['eins', 'zwei', 'drei'])
    await origin!.store.createBlock(doc.id, { content: word })
  for (let i = 0; i < 2; i++) for (const d of devices) await sync(d, workspaceId)

  const tokens: string[] = []
  for (let step = 0; step < steps; step++) {
    const d = pick(devices)
    const blocks = await d.store.listBlocks(doc.id)
    const roll = rand()
    const token = `${d.name}s${step}`
    if (roll < 0.45 && blocks.length) {
      const block = pick(blocks)
      tokens.push(token)
      await d.store.updateBlock(block.id, { content: `${block.content} ${token}`.trim() })
    } else if (roll < 0.6) {
      tokens.push(token)
      await d.store.createBlock(doc.id, { content: token }, { afterId: pick(blocks)?.id ?? null })
    } else if (roll < 0.7 && blocks.length > 1) {
      await d.store.deleteBlock(pick(blocks).id)
    } else if (roll < 0.8 && blocks.length > 1) {
      await d.store.moveBlock(pick(blocks).id, { afterId: null })
    } else {
      await sync(d, workspaceId)
    }
  }

  // Settle: everyone syncs until nothing moves (reliable connection).
  for (const d of devices) {
    d.push = (input) => call(d.cookie, 'POST', '/sync/push', input)
    d.pull = ({ workspaceId: ws, cursor, limit }) =>
      call(
        d.cookie,
        'GET',
        `/sync/pull?${new URLSearchParams({ workspaceId: ws, cursor: String(cursor), limit: String(limit) })}`,
      )
  }
  for (let round = 0; round < 3; round++) for (const d of devices) await sync(d, workspaceId)

  const snapshot = await call<SyncSnapshotResponse>(
    first,
    'GET',
    `/sync/snapshot?workspaceId=${workspaceId}`,
  )
  const serverBlocks = snapshot.blocks
    .filter((b) => b.documentId === doc.id && !b.deletedAt)
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.id < b.id ? -1 : 1))

  // 1. Convergence: every device shows exactly the server state.
  for (const d of devices) {
    expect(await d.store.pendingOperationCount(), `${d.name} queue (seed ${seed})`).toBe(0)
    expect(view(await d.store.listBlocks(doc.id)), `${d.name} blocks (seed ${seed})`).toEqual(
      view(serverBlocks),
    )
  }

  // 2. No silent loss: each token is on the server (also in deleted blocks) or in a conflict.
  const kept = [
    ...snapshot.blocks.map((b) => b.content),
    ...snapshot.conflicts.map((c) => JSON.stringify(c.local.payload)),
  ].join('\n')
  for (const token of tokens) {
    expect(kept.includes(token), `token ${token} lost (seed ${seed})`).toBe(true)
  }
  return { tokens: tokens.length, conflicts: snapshot.conflicts.length }
}

describe('three devices, random edits and dropped connections (property)', () => {
  for (const seed of [1, 7, 42, 1337, 2026]) {
    it(`converges without losing edits (seed ${seed})`, async () => {
      const result = await scenario(seed, 60)
      expect(result.tokens).toBeGreaterThan(10)
    }, 60_000)
  }
})
