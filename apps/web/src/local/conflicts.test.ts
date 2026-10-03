import 'fake-indexeddb/auto'
import {
  type Change,
  type ConflictCreatePayload,
  newId,
  validateOperationPayload,
} from '@notion-alt/shared'
import { Dexie } from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalDb } from './db'
import { LocalStore } from './store'

const WS = '11111111-1111-4111-8111-111111111111'
const OTHER_DEVICE = '22222222-2222-4222-8222-222222222222'

let db: LocalDb
let store: LocalStore
let seq = 100

beforeEach(async () => {
  db = new LocalDb(`conflicts-${newId()}`)
  store = await LocalStore.open(db)
})
afterEach(async () => {
  db.close()
  await db.delete()
})

/** A synced page with one block (revision 1) whose queue is empty. */
async function syncedPage(content = 'Basis') {
  const doc = await store.createDocument({ workspaceId: WS, title: 'Seite' })
  const [block] = await store.listBlocks(doc.id)
  await store.updateBlock(block!.id, { content })
  await db.operations.clear()
  await db.documents.update(doc.id, { revision: 1 })
  await db.blocks.update(block!.id, { revision: 1 })
  return { doc, blockId: block!.id }
}

/** Conflict created by the server for an operation of `deviceId`, as pulled. */
function conflictChange(
  payload: Partial<ConflictCreatePayload> &
    Pick<ConflictCreatePayload, 'entity' | 'entityId' | 'documentId' | 'reason' | 'remote'>,
  deviceId = '',
) {
  const full: ConflictCreatePayload = {
    baseRevision: 1,
    local: { kind: 'update', payload: { content: 'meine Version' }, deviceId, opId: newId() },
    createdAt: '2026-02-01T00:00:00.000Z',
    resolvedAt: null,
    resolution: null,
    ...payload,
  }
  const change: Change = {
    seq: ++seq,
    opId: newId(),
    deviceId: full.local.deviceId,
    entity: 'conflict',
    entityId: newId(),
    kind: 'create',
    revision: 1,
    payload: full,
    appliedAt: full.createdAt,
  }
  return change
}

describe('local schema upgrade (T-MIG-02)', () => {
  it('version 2 keeps the data of version 1 and adds conflicts', async () => {
    const name = `upgrade-${newId()}`
    const v1 = new Dexie(name)
    v1.version(1).stores({
      meta: 'key',
      workspaces: 'id',
      documents: 'id, workspaceId, parentId, updatedAt',
      blocks: 'id, documentId',
      tags: 'id, workspaceId',
      documentTags: 'id, documentId, tagId, workspaceId',
      operations: '++seq, &opId, entityId, workspaceId',
      links: 'blockId, documentId, workspaceId, *targets',
    })
    await v1.table('documents').put({ id: 'd1', workspaceId: WS, title: 'Alt' })
    await v1.table('operations').add({ opId: 'o1', entityId: 'd1', workspaceId: WS })
    v1.close()

    const upgraded = new LocalDb(name)
    expect((await upgraded.documents.get('d1'))?.title).toBe('Alt')
    expect(await upgraded.operations.count()).toBe(1)
    expect(await upgraded.conflicts.count()).toBe(0)
    upgraded.close()
    await Dexie.delete(name)
  })
})

describe('conflicts', () => {
  it('shows the server version again on the authoring device and resolves to its own', async () => {
    const { doc, blockId } = await syncedPage()
    const change = conflictChange(
      {
        entity: 'block',
        entityId: blockId,
        documentId: doc.id,
        reason: 'changed',
        remote: { ...(await db.blocks.get(blockId))!, content: 'Server-Version', revision: 2 },
      },
      store.deviceId,
    )
    await store.applyRemoteChanges(WS, [change], change.seq)

    expect((await store.listBlocks(doc.id))[0]!.content).toBe('Server-Version')
    const [open] = await store.openConflicts(WS)
    expect(open).toMatchObject({ id: change.entityId, reason: 'changed', documentId: doc.id })

    await store.resolveConflict(open!.id, 'local')
    const block = (await store.listBlocks(doc.id))[0]!
    expect(block.content).toBe('meine Version')
    expect(await store.openConflicts(WS)).toEqual([])
    const queue = await store.pendingOperations()
    expect(queue.map((op) => `${op.entity}:${op.kind}:${op.baseRevision}`)).toEqual([
      'block:update:2',
      'conflict:update:1',
    ])
    for (const op of queue)
      expect(validateOperationPayload(op.entity, op.kind, op.payload)).toBeNull()
  })

  it('keeps the server version or a manual merge', async () => {
    const { doc, blockId } = await syncedPage()
    const remote = { ...(await db.blocks.get(blockId))!, content: 'Server', revision: 2 }
    const first = conflictChange(
      { entity: 'block', entityId: blockId, documentId: doc.id, reason: 'changed', remote },
      store.deviceId,
    )
    await store.applyRemoteChanges(WS, [first], first.seq)
    await store.resolveConflict(first.entityId, 'remote')
    expect((await store.listBlocks(doc.id))[0]!.content).toBe('Server')
    expect((await store.pendingOperations()).map((op) => op.entity)).toEqual(['conflict'])

    const second = conflictChange(
      { entity: 'block', entityId: blockId, documentId: doc.id, reason: 'changed', remote },
      store.deviceId,
    )
    await store.applyRemoteChanges(WS, [second], second.seq)
    await store.resolveConflict(second.entityId, 'manual', 'Server und meine Version')
    expect((await store.listBlocks(doc.id))[0]!.content).toBe('Server und meine Version')
    await expect(store.resolveConflict(second.entityId, 'remote')).rejects.toThrow()
  })

  it('leaves other devices untouched and follows a resolution made elsewhere', async () => {
    const { doc, blockId } = await syncedPage('Mein Stand')
    const change = conflictChange(
      {
        entity: 'block',
        entityId: blockId,
        documentId: doc.id,
        reason: 'changed',
        remote: { content: 'egal' },
      },
      OTHER_DEVICE,
    )
    await store.applyRemoteChanges(WS, [change], change.seq)
    expect((await store.listBlocks(doc.id))[0]!.content).toBe('Mein Stand')
    expect(await store.openConflicts(WS)).toHaveLength(1)

    const resolved: Change = {
      ...change,
      seq: ++seq,
      opId: newId(),
      kind: 'update',
      revision: 2,
      payload: { resolution: 'remote' },
    }
    await store.applyRemoteChanges(WS, [resolved], resolved.seq)
    expect(await store.openConflicts(WS)).toEqual([])
  })

  it('T-DEL-02: an edit on a page deleted elsewhere comes back as a restored copy', async () => {
    const { doc, blockId } = await syncedPage('Vorher')
    await store.createBlock(doc.id, { content: 'Zweiter Block' })
    await db.operations.clear()
    const change = conflictChange(
      {
        entity: 'block',
        entityId: blockId,
        documentId: doc.id,
        reason: 'parent_deleted',
        remote: { ...(await db.blocks.get(blockId))!, revision: 1 },
        local: {
          kind: 'update',
          payload: { content: 'Nachher (offline)' },
          deviceId: store.deviceId,
          opId: newId(),
        },
      },
      store.deviceId,
    )
    await store.applyRemoteChanges(WS, [change], change.seq)
    // The page is gone here as well now; the edit lives in the conflict.
    expect(await store.listDocuments(WS)).toEqual([])

    const restored = await store.resolveConflict(change.entityId, 'local')
    const copy = await store.getDocument(restored!)
    expect(copy!.title).toBe('Seite (wiederhergestellt)')
    expect((await store.listBlocks(copy!.id)).map((b) => b.content)).toEqual([
      'Nachher (offline)',
      'Zweiter Block',
    ])
    const kinds = (await store.pendingOperations()).map((op) => `${op.entity}:${op.kind}`)
    expect(kinds).toEqual(['document:create', 'block:create', 'block:create', 'conflict:update'])
  })
})
