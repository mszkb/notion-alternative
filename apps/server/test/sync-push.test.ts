import { randomUUID } from 'node:crypto'
import type { Operation } from '@notion-alt/shared'
import { sql } from 'kysely'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../src/db/database'
import { createTestApp, register, type TestApp } from './helpers'

let app: TestApp
let db: Db
let cookie: string
let workspaceId: string
let deviceId: string

async function signUp(email: string) {
  const { cookie: c } = await register(app, email)
  const ws = (await app.inject({ url: '/api/workspaces', headers: { cookie: c } })).json()
    .workspaces[0].id as string
  const device = randomUUID()
  await app.inject({
    method: 'POST',
    url: '/api/devices',
    headers: { cookie: c },
    payload: { id: device, name: 'Test' },
  })
  return { cookie: c, workspaceId: ws, deviceId: device }
}

beforeEach(async () => {
  ;({ app, db } = await createTestApp({ allowRegistration: true, metricsEnabled: true }))
  ;({ cookie, workspaceId, deviceId } = await signUp('alice@example.com'))
})
afterEach(() => app.close())

function createDoc(id = randomUUID()): Operation {
  return {
    opId: randomUUID(),
    deviceId,
    workspaceId,
    entity: 'document',
    entityId: id,
    kind: 'create',
    baseRevision: null,
    payload: { parentId: null, title: 'T', sortKey: 'a0', favorite: false, createdAt: 'x' },
    createdAt: new Date().toISOString(),
  }
}

function push(operations: Operation[], c = cookie) {
  return app.inject({
    method: 'POST',
    url: '/api/sync/push',
    headers: { cookie: c },
    payload: { operations },
  })
}

describe('POST /api/sync/push', () => {
  it('applies operations in order and answers per opId', async () => {
    const doc = createDoc()
    const block: Operation = {
      ...doc,
      opId: randomUUID(),
      entity: 'block',
      entityId: randomUUID(),
      payload: {
        documentId: doc.entityId,
        type: 'paragraph',
        content: 'x',
        attrs: {},
        sortKey: 'a',
      },
    }
    const response = await push([doc, block])
    expect(response.statusCode).toBe(200)
    expect(response.json().results).toEqual([
      { opId: doc.opId, status: 'applied', revision: 1, seq: 1 },
      { opId: block.opId, status: 'applied', revision: 1, seq: 2 },
    ])
  })

  it('T-MD-04 / T-OFF-05: resending after a lost response applies nothing twice', async () => {
    const ops = [createDoc(), createDoc()]
    await push(ops)
    // The client never saw the answer and sends the queue again, plus a new operation.
    const fresh = createDoc()
    const again = (await push([...ops, fresh])).json().results
    expect(again.map((r: { status: string }) => r.status)).toEqual([
      'duplicate',
      'duplicate',
      'applied',
    ])
    expect(again[2].seq).toBe(3)
  })

  it('#95: one transaction per batch; a rejected operation only rolls back itself', async () => {
    const doc = createDoc()
    const foreign = { ...createDoc(), workspaceId: randomUUID() }
    const later = createDoc()
    const results = (await push([doc, foreign, later])).json().results
    expect(results.map((r: { status: string }) => r.status)).toEqual([
      'applied',
      'rejected',
      'applied',
    ])
    expect(results.map((r: { seq?: number }) => r.seq)).toEqual([1, undefined, 2])
  })

  it('T-OFF-05: an unexpected error mid-batch keeps what was applied before it', async () => {
    await sql`create trigger boom before insert on documents when new.title = 'boom'
      begin select raise(abort, 'boom'); end`.execute(db)
    const first = createDoc()
    const broken = { ...createDoc(), payload: { ...createDoc().payload, title: 'boom' } }
    const after = createDoc()
    expect((await push([first, broken, after])).statusCode).toBe(500)
    const ids = (await db.selectFrom('documents').select('id').execute()).map((r) => r.id)
    expect(ids).toContain(first.entityId)
    expect(ids).not.toContain(broken.entityId)
    expect(ids).not.toContain(after.entityId)
    const log = await db.selectFrom('changes').select('op_id').execute()
    expect(log.map((r) => r.op_id)).toEqual([first.opId])

    // The client resends the batch: the first is a duplicate, the rest applies once fixed.
    await sql`drop trigger boom`.execute(db)
    const again = (await push([first, broken, after])).json().results
    expect(again.map((r: { status: string }) => r.status)).toEqual([
      'duplicate',
      'applied',
      'applied',
    ])
  })

  it('rejects foreign workspaces per operation and requires a session', async () => {
    const bob = await signUp('bob@example.com')
    const results = (await push([createDoc()], bob.cookie)).json().results
    expect(results[0]).toMatchObject({ status: 'rejected', code: 'workspace_not_found' })
    expect((await push([createDoc()], 'session=nope')).statusCode).toBe(401)
  })

  it('validates the batch', async () => {
    expect((await push([])).statusCode).toBe(400)
    const tooMany = Array.from({ length: 501 }, () => createDoc())
    expect((await push(tooMany)).statusCode).toBe(400)
    const broken = { ...createDoc(), opId: 'nope' }
    expect((await push([broken as Operation])).statusCode).toBe(400)
  })

  it('marks the device as seen and counts results', async () => {
    await new Promise((resolve) => setTimeout(resolve, 5))
    await push([createDoc()])
    const devices = (await app.inject({ url: '/api/devices', headers: { cookie } })).json().devices
    expect(devices[0].lastSeenAt > devices[0].createdAt).toBe(true)
    const metrics = (await app.inject('/api/metrics')).body
    expect(metrics).toContain('sync_push_operations_total{status="applied"} 1')
  })
})
