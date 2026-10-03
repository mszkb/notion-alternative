import 'fake-indexeddb/auto'
import { newId, type Operation, type SyncPushResult } from '@notion-alt/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalDb } from '../local/db'
import { LocalStore } from '../local/store'
import { backoffDelay } from './engine'
import { pushQueue } from './push'

const WS = '11111111-1111-4111-8111-111111111111'

let db: LocalDb
let store: LocalStore

beforeEach(async () => {
  db = new LocalDb(`push-${newId()}`)
  store = await LocalStore.open(db)
})
afterEach(async () => {
  db.close()
  await db.delete()
})

/** Fake server: applies every op once, revision per entity, remembers op ids (idempotency). */
function fakeServer(decide?: (op: Operation) => SyncPushResult | undefined) {
  const seen = new Map<string, SyncPushResult>()
  const revisions = new Map<string, number>()
  const batches: Operation[][] = []
  let seq = 0
  const send = async ({ operations }: { operations: Operation[] }) => {
    batches.push(operations)
    const results = operations.map((op): SyncPushResult => {
      const known = seen.get(op.opId)
      if (known && known.status === 'applied') return { ...known, status: 'duplicate' }
      const custom = decide?.(op)
      if (custom) return custom
      const revision = (revisions.get(op.entityId) ?? 0) + 1
      revisions.set(op.entityId, revision)
      const result: SyncPushResult = { opId: op.opId, status: 'applied', revision, seq: ++seq }
      seen.set(op.opId, result)
      return result
    })
    return { results }
  }
  return { send, batches, seen }
}

describe('pushQueue', () => {
  it('sends in creation order, empties the queue and stores server revisions', async () => {
    const doc = await store.createDocument({ workspaceId: WS, title: 'A' })
    await store.renameDocument(doc.id, 'B')
    const queued = await store.pendingOperations()
    const server = fakeServer()

    const outcome = await pushQueue(store, server.send)
    expect(outcome).toEqual({ confirmed: 3, conflicts: 0, rejected: 0, deviceRevoked: false })
    expect(server.batches[0]!.map((op) => op.opId)).toEqual(queued.map((op) => op.opId))
    // Local bookkeeping never leaves the device.
    expect(server.batches[0]![0]).not.toHaveProperty('seq')
    expect(await store.pendingOperationCount()).toBe(0)
    expect((await store.getDocument(doc.id))!.revision).toBe(2)
    const [block] = await store.listBlocks(doc.id)
    expect(block!.revision).toBe(1)
  })

  it('T-OFF-05: a lost response is resent and answered as duplicate', async () => {
    await store.createDocument({ workspaceId: WS, title: 'A' })
    const server = fakeServer()
    let drop = true
    const flaky = async (input: { operations: Operation[] }) => {
      const response = await server.send(input)
      if (drop) {
        drop = false
        throw new TypeError('connection reset')
      }
      return response
    }
    await expect(pushQueue(store, flaky)).rejects.toThrow('connection reset')
    expect(await store.pendingOperationCount()).toBe(2)
    expect(await pushQueue(store, flaky)).toMatchObject({ confirmed: 2 })
    expect(await store.pendingOperationCount()).toBe(0)
    expect(server.seen.size).toBe(2)
  })

  it('keeps conflicts and rejections queued and marked', async () => {
    const doc = await store.createDocument({ workspaceId: WS, title: 'A' })
    await store.renameDocument(doc.id, 'B')
    const [create, , rename] = await store.pendingOperations()
    const server = fakeServer((op) =>
      op.opId === rename!.opId
        ? { opId: op.opId, status: 'conflict', currentRevision: 5, reason: 'changed' }
        : op.opId === create!.opId
          ? undefined
          : { opId: op.opId, status: 'rejected', code: 'invalid_payload', message: 'nope' },
    )
    expect(await pushQueue(store, server.send)).toMatchObject({
      confirmed: 1,
      conflicts: 1,
      rejected: 1,
    })
    const issues = await store.operationsWithIssues()
    expect(issues.map((op) => op.issue!.status).sort()).toEqual(['conflict', 'rejected'])
    expect(await store.pendingOperationCount()).toBe(2)
  })

  it('splits batches by count and size', async () => {
    const doc = await store.createDocument({ workspaceId: WS, title: 'A' })
    const [block] = await store.listBlocks(doc.id)
    for (let i = 0; i < 4; i++) await store.updateBlock(block!.id, { content: 'x'.repeat(400 + i) })
    const server = fakeServer()
    await pushQueue(store, server.send, { maxOperations: 3, maxBytes: 1200 })
    const sizes = server.batches.map((b) => b.length)
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(6)
    expect(Math.max(...sizes)).toBeLessThanOrEqual(3)
    expect(sizes.length).toBeGreaterThan(2)
    expect(await store.pendingOperationCount()).toBe(0)
  })

  it('stops when the device was removed', async () => {
    await store.createDocument({ workspaceId: WS, title: 'A' })
    const server = fakeServer((op) => ({
      opId: op.opId,
      status: 'rejected',
      code: 'device_not_active',
      message: 'removed',
    }))
    expect(await pushQueue(store, server.send, { maxOperations: 1, maxBytes: 1e6 })).toMatchObject({
      deviceRevoked: true,
      rejected: 1,
    })
    expect(server.batches).toHaveLength(1)
  })
})

describe('backoffDelay', () => {
  it('doubles up to five minutes', () => {
    expect([1, 2, 3, 10, 20].map(backoffDelay)).toEqual([1000, 2000, 4000, 300_000, 300_000])
  })
})
