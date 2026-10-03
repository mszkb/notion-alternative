import { randomUUID } from 'node:crypto'
import type { Operation, OperationEntity, OperationKind } from '@notion-alt/shared'
import { sql } from 'kysely'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../src/db/database'
import { insertDevice, revokeDevice } from '../src/devices/repository'
import { applyOperation } from '../src/sync/apply'
import { listChangesSince } from '../src/sync/changes'
import { toBlock, toChange, toDocument } from '../src/sync/mapping'
import { insertWorkspace } from '../src/workspaces/repository'
import { createTestApp, register, type TestApp } from './helpers'

let app: TestApp
let db: Db
let userId: string
let workspaceId: string
let deviceId: string

async function setupUser(email: string) {
  const { response } = await register(app, email)
  const id = response.json().user.id as string
  const workspace = await db
    .selectFrom('workspaces')
    .select('id')
    .where('owner_id', '=', id)
    .executeTakeFirstOrThrow()
  const device = randomUUID()
  await insertDevice(db, id, device, 'Test', new Date().toISOString())
  return { userId: id, workspaceId: workspace.id, deviceId: device }
}

beforeEach(async () => {
  ;({ app, db } = await createTestApp({ allowRegistration: true }))
  ;({ userId, workspaceId, deviceId } = await setupUser('alice@example.com'))
})
afterEach(() => app.close())

function op(
  entity: OperationEntity,
  kind: OperationKind,
  entityId: string,
  payload: Record<string, unknown>,
  baseRevision: number | null = null,
  overrides: Partial<Operation> = {},
): Operation {
  return {
    opId: randomUUID(),
    deviceId,
    workspaceId,
    entity,
    entityId,
    kind,
    baseRevision,
    payload,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

const createDoc = (id: string, parentId: string | null = null) =>
  op('document', 'create', id, {
    parentId,
    title: 'Seite',
    sortKey: 'a0',
    favorite: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  })

const apply = (operation: Operation, user = userId) => applyOperation(db, user, operation)

async function changes(ws = workspaceId) {
  return (await listChangesSince(db, userId, ws, 0, 1000))!.map(toChange)
}

describe('applyOperation', () => {
  it('applies operations, raising the revision per change and the seq without gaps', async () => {
    const doc = randomUUID()
    const block = randomUUID()
    expect(await apply(createDoc(doc))).toEqual({ status: 'applied', revision: 1, seq: 1 })
    expect(
      await apply(
        op('block', 'create', block, {
          documentId: doc,
          type: 'paragraph',
          content: 'Hallo',
          attrs: {},
          sortKey: 'a0',
        }),
      ),
    ).toEqual({ status: 'applied', revision: 1, seq: 2 })
    expect(await apply(op('block', 'update', block, { content: 'Welt', attrs: {} }, 1))).toEqual({
      status: 'applied',
      revision: 2,
      seq: 3,
    })
    expect(await apply(op('block', 'move', block, { sortKey: 'a5' }, 2))).toMatchObject({
      revision: 3,
      seq: 4,
    })
    expect(await apply(op('document', 'update', doc, { title: 'Neu', favorite: true }, 1))).toEqual(
      { status: 'applied', revision: 2, seq: 5 },
    )
    expect(await apply(op('block', 'delete', block, {}, 3))).toMatchObject({ revision: 4, seq: 6 })

    const storedBlock = toBlock(
      await db.selectFrom('blocks').selectAll().where('id', '=', block).executeTakeFirstOrThrow(),
    )
    expect(storedBlock).toMatchObject({ content: 'Welt', sortKey: 'a5', revision: 4 })
    expect(storedBlock.deletedAt).not.toBeNull()
    const storedDoc = toDocument(
      await db.selectFrom('documents').selectAll().where('id', '=', doc).executeTakeFirstOrThrow(),
    )
    expect(storedDoc).toMatchObject({ title: 'Neu', favorite: true, revision: 2, deletedAt: null })

    const log = await changes()
    expect(log.map((c) => c.seq)).toEqual([1, 2, 3, 4, 5, 6])
    expect(log.map((c) => `${c.entity}:${c.kind}:${c.revision}`)).toEqual([
      'document:create:1',
      'block:create:1',
      'block:update:2',
      'block:move:3',
      'document:update:2',
      'block:delete:4',
    ])
    expect(log[2]!.payload).toEqual({ content: 'Welt', attrs: {} })
    expect(log.every((c) => c.deviceId === deviceId)).toBe(true)
  })

  it('is idempotent by opId and refuses a reused opId', async () => {
    const doc = randomUUID()
    const create = createDoc(doc)
    await apply(create)
    expect(await apply(create)).toEqual({ status: 'duplicate', revision: 1, seq: 1 })
    expect(await changes()).toHaveLength(1)

    const reused = { ...createDoc(randomUUID()), opId: create.opId }
    expect(await apply(reused)).toMatchObject({ status: 'rejected', code: 'op_id_reused' })
  })

  it('reports a change by another device since the base revision as conflict', async () => {
    const phone = randomUUID()
    await insertDevice(db, userId, phone, 'Phone', new Date().toISOString())
    const doc = randomUUID()
    await apply(createDoc(doc))
    // The phone saw revision 1 and changed the title.
    await apply(op('document', 'update', doc, { title: 'A' }, 1, { deviceId: phone }))
    // This device also edited on top of revision 1: conflict, nothing written.
    expect(await apply(op('document', 'update', doc, { title: 'B' }, 1))).toEqual({
      status: 'conflict',
      currentRevision: 2,
      reason: 'changed',
    })
    const stored = await db
      .selectFrom('documents')
      .select(['title', 'revision'])
      .where('id', '=', doc)
      .executeTakeFirstOrThrow()
    expect(stored).toEqual({ title: 'A', revision: 2 })
    expect(await changes()).toHaveLength(2)
    expect(await apply(op('document', 'update', doc, { title: 'C' }, 7))).toMatchObject({
      code: 'invalid_payload',
    })
  })

  it('T-DEL-02: edits to what another device deleted become conflicts, never vanish', async () => {
    const phone = randomUUID()
    await insertDevice(db, userId, phone, 'Phone', new Date().toISOString())
    const doc = randomUUID()
    const block = randomUUID()
    await apply(createDoc(doc))
    await apply(
      op('block', 'create', block, {
        documentId: doc,
        type: 'paragraph',
        content: '',
        attrs: {},
        sortKey: 'a0',
      }),
    )
    // The phone deletes the page.
    await apply(op('document', 'delete', doc, {}, 1, { deviceId: phone }))

    // This device edited offline: block in the deleted page, the page itself, a new block.
    expect(await apply(op('block', 'update', block, { content: 'offline' }, 1))).toEqual({
      status: 'conflict',
      currentRevision: 2,
      reason: 'parent_deleted',
    })
    expect(await apply(op('document', 'update', doc, { title: 'x' }, 1))).toEqual({
      status: 'conflict',
      currentRevision: 2,
      reason: 'deleted',
    })
    expect(
      await apply(
        op('block', 'create', randomUUID(), {
          documentId: doc,
          type: 'paragraph',
          content: 'neu',
          attrs: {},
          sortKey: 'a1',
        }),
      ),
    ).toMatchObject({ status: 'conflict', reason: 'parent_deleted' })
    // Deleting it here as well is the same outcome; deleting its blocks is fine.
    expect(await apply(op('document', 'delete', doc, {}, 1))).toEqual({
      status: 'duplicate',
      revision: 2,
      seq: 3,
    })
    expect(await apply(op('block', 'delete', block, {}, 1))).toMatchObject({ status: 'applied' })
  })

  it("chains a device's own queued operations without conflict", async () => {
    const doc = randomUUID()
    // Created and edited offline: every queued op still has base revision null.
    await apply(createDoc(doc))
    await apply(op('document', 'update', doc, { title: 'eins' }, null))
    await apply(op('document', 'update', doc, { title: 'zwei' }, null))
    expect(await apply(op('document', 'move', doc, { parentId: null, sortKey: 'b' }, 1))).toEqual({
      status: 'applied',
      revision: 4,
      seq: 4,
    })
  })

  it('keeps users, workspaces and devices apart', async () => {
    const bob = await setupUser('bob@example.com')
    const doc = randomUUID()
    await apply(createDoc(doc))

    // Bob cannot write into Alice's workspace, nor touch her entities from his own workspace.
    expect(await apply(createDoc(randomUUID()), bob.userId)).toMatchObject({
      status: 'rejected',
      code: 'workspace_not_found',
    })
    const foreign = op('document', 'update', doc, { title: 'x' }, 1, {
      workspaceId: bob.workspaceId,
      deviceId: bob.deviceId,
    })
    expect(await apply(foreign, bob.userId)).toMatchObject({
      status: 'rejected',
      code: 'not_found',
    })
    // Alice cannot use Bob's device id.
    expect(await apply({ ...createDoc(randomUUID()), deviceId: bob.deviceId })).toMatchObject({
      status: 'rejected',
      code: 'device_not_active',
    })

    await revokeDevice(db, userId, deviceId, new Date().toISOString())
    expect(await apply(createDoc(randomUUID()))).toMatchObject({
      status: 'rejected',
      code: 'device_not_active',
    })
    expect(await listChangesSince(db, bob.userId, workspaceId, 0, 10)).toBeNull()
  })

  it('validates payloads, references and the page tree', async () => {
    const doc = randomUUID()
    const child = randomUUID()
    expect(await apply(op('document', 'create', doc, { title: 'ohne Rest' }))).toMatchObject({
      status: 'rejected',
      code: 'invalid_payload',
    })
    expect(await apply(createDoc(doc, randomUUID()))).toMatchObject({ code: 'not_found' })
    await apply(createDoc(doc))
    expect(await apply(createDoc(doc))).toMatchObject({ code: 'already_exists' })
    await apply(createDoc(child, doc))
    expect(
      await apply(op('document', 'move', doc, { parentId: child, sortKey: 'a1' }, 1)),
    ).toMatchObject({ code: 'invalid_payload' })
    expect(
      await apply(
        op('block', 'create', randomUUID(), {
          documentId: randomUUID(),
          type: 'paragraph',
          content: '',
          attrs: {},
          sortKey: 'a0',
        }),
      ),
    ).toMatchObject({ code: 'not_found' })
    expect(
      await apply(
        op('document_tag', 'create', randomUUID(), { documentId: doc, tagId: randomUUID() }),
      ),
    ).toMatchObject({ code: 'not_found' })
    await apply(op('document', 'delete', child, {}, 1))
    expect(await apply(op('document', 'update', child, { title: 'x' }, 2))).toMatchObject({
      code: 'deleted',
    })
    // Rejected operations leave no trace in the log.
    expect((await changes()).map((c) => c.seq)).toEqual([1, 2, 3])
  })

  it('applies tags and tag assignments', async () => {
    const doc = randomUUID()
    const tag = randomUUID()
    const assignment = randomUUID()
    await apply(createDoc(doc))
    expect(await apply(op('tag', 'create', tag, { name: 'Projekt' }))).toMatchObject({
      status: 'applied',
    })
    expect(
      await apply(op('document_tag', 'create', assignment, { documentId: doc, tagId: tag })),
    ).toMatchObject({ status: 'applied' })
    expect(await apply(op('document_tag', 'delete', assignment, {}, 1))).toMatchObject({
      status: 'applied',
      revision: 2,
    })
    expect(await apply(op('tag', 'move', tag, {}, 1))).toMatchObject({ code: 'invalid_payload' })
  })

  it('writes entity and change atomically', async () => {
    await sql`create trigger fail_changes before insert on changes
      begin select raise(abort, 'simulated failure'); end`.execute(db)
    const doc = randomUUID()
    await expect(apply(createDoc(doc))).rejects.toThrow(/simulated failure/)
    const stored = await db.selectFrom('documents').select('id').where('id', '=', doc).execute()
    expect(stored).toEqual([])
  })

  it('numbers changes per workspace and pages through them', async () => {
    const second = await insertWorkspace(db, userId, 'Zweiter')
    await apply(createDoc(randomUUID()))
    await apply(createDoc(randomUUID()))
    expect(await apply({ ...createDoc(randomUUID()), workspaceId: second.id })).toMatchObject({
      seq: 1,
    })

    const page = await listChangesSince(db, userId, workspaceId, 1, 10)
    expect(page!.map((c) => c.seq)).toEqual([2])
    expect((await listChangesSince(db, userId, workspaceId, 0, 1))!.map((c) => c.seq)).toEqual([1])
  })
})
