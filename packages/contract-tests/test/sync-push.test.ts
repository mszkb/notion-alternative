import { randomUUID } from 'node:crypto'
import type { Operation } from '@notion-alt/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { type Account, blockPayload, docPayload, op, push, signUp } from '../src/client'

let alice: Account

beforeEach(async () => {
  alice = await signUp({ name: 'alice' })
})

const createDoc = (target: Account = alice) =>
  op(target, 'document', 'create', randomUUID(), docPayload('T'))

const pushRaw = (operations: unknown[], client = alice.client) =>
  client.post('/api/sync/push', { operations })

describe('POST /api/sync/push', () => {
  it('applies operations in order and answers per opId', async () => {
    const doc = createDoc()
    const block = op(alice, 'block', 'create', randomUUID(), blockPayload(doc.entityId))
    const response = await pushRaw([doc, block])
    expect(response.status).toBe(200)
    expect(response.json().results).toEqual([
      { opId: doc.opId, status: 'applied', revision: 1, seq: 1 },
      { opId: block.opId, status: 'applied', revision: 1, seq: 2 },
    ])
  })

  it('T-MD-04 / T-OFF-05: resending after a lost response applies nothing twice', async () => {
    const ops = [createDoc(), createDoc()]
    await push(alice, ...ops)
    // The client never saw the answer and sends the queue again, plus a new operation.
    const fresh = createDoc()
    const again = await push(alice, ...ops, fresh)
    expect(again).toEqual([
      { opId: ops[0]!.opId, status: 'duplicate', revision: 1, seq: 1 },
      { opId: ops[1]!.opId, status: 'duplicate', revision: 1, seq: 2 },
      { opId: fresh.opId, status: 'applied', revision: 1, seq: 3 },
    ])
  })

  it('#95: a rejected operation only rolls back itself', async () => {
    const doc = createDoc()
    const foreign = { ...createDoc(), workspaceId: randomUUID() }
    const later = createDoc()
    const results = await push(alice, doc, foreign, later)
    expect(results.map((r) => r.status)).toEqual(['applied', 'rejected', 'applied'])
    expect(results.map((r) => r.seq)).toEqual([1, undefined, 2])
    expect(results[1]).toMatchObject({
      opId: foreign.opId,
      code: 'workspace_not_found',
      message: expect.any(String),
    })
  })

  it('rejects foreign workspaces per operation and requires a session', async () => {
    const bob = await signUp({ name: 'bob' })
    const [result] = await push(bob, createDoc())
    expect(result).toMatchObject({ status: 'rejected', code: 'workspace_not_found' })
    const anonymous = await pushRaw([createDoc()], alice.client.fork('session=nope'))
    expect(anonymous.status).toBe(401)
  })

  it('validates the batch', async () => {
    const empty = await pushRaw([])
    expect(empty.status).toBe(400)
    expect(empty.json().error.code).toBe('invalid_input')
    const tooMany = Array.from({ length: 501 }, () => createDoc())
    expect((await pushRaw(tooMany)).status).toBe(400)
    const broken = { ...createDoc(), opId: 'nope' }
    const invalid = await pushRaw([broken])
    expect(invalid.status).toBe(400)
    expect(invalid.json().error.issues[0].path).toBe('operations.0.opId')
    expect((await alice.client.post('/api/sync/push', {})).status).toBe(400)
  })

  it('marks the device as seen', async () => {
    const before = (await alice.client.get('/api/devices')).json().devices[0]
    await new Promise((resolve) => setTimeout(resolve, 20))
    await push(alice, createDoc())
    const after = (await alice.client.get('/api/devices')).json().devices[0]
    expect(after.lastSeenAt > before.lastSeenAt).toBe(true)
  })

  it('accepts the largest batch', async () => {
    const ops: Operation[] = Array.from({ length: 500 }, () => createDoc())
    const results = await push(alice, ...ops)
    expect(results).toHaveLength(500)
    expect(results.at(-1)).toMatchObject({ status: 'applied', seq: 500 })
  })
})
