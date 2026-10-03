import 'fake-indexeddb/auto'
import { type Change, newId, validateOperationPayload } from '@notion-alt/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalDb } from './db'
import { LocalStore } from './store'

const WS = '11111111-1111-4111-8111-111111111111'

let db: LocalDb
let store: LocalStore
beforeEach(async () => {
  db = new LocalDb(`trash-${newId()}`)
  store = await LocalStore.open(db)
})
afterEach(async () => {
  db.close()
  await db.delete()
})

describe('trash (#66)', () => {
  it('restores a deleted page with its subpages, blocks, tags and links', async () => {
    const parent = await store.createDocument({ workspaceId: WS, title: 'Eltern' })
    const child = await store.createDocument({
      workspaceId: WS,
      title: 'Kind',
      parentId: parent.id,
    })
    const target = await store.createDocument({ workspaceId: WS, title: 'Ziel' })
    const [block] = await store.listBlocks(child.id)
    await store.updateBlock(block!.id, { content: `Siehe [Ziel](page:${target.id})` })
    await store.addTag(parent.id, 'Projekt')
    await store.deleteDocument(parent.id)

    // Only the top deleted page is offered; the child comes with it.
    expect((await store.trashedDocuments(WS)).map((d) => d.title)).toEqual(['Eltern'])
    expect(await store.backlinks(target.id)).toEqual([])

    const count = (await store.pendingOperations()).length
    expect(await store.restoreDocument(parent.id)).toEqual([parent.id, child.id])
    expect((await store.listDocuments(WS)).map((d) => d.title).sort()).toEqual([
      'Eltern',
      'Kind',
      'Ziel',
    ])
    expect((await store.listBlocks(child.id))[0]!.content).toContain('page:')
    expect((await store.tagsForDocument(parent.id)).map((t) => t.name)).toEqual(['Projekt'])
    expect((await store.backlinks(target.id)).map((d) => d.id)).toEqual([child.id])
    expect(await store.trashedDocuments(WS)).toEqual([])

    const ops = (await store.pendingOperations()).slice(count)
    expect(ops.map((op) => `${op.entity}:${op.kind}`)).toEqual([
      'document:restore',
      'document:restore',
    ])
    for (const op of ops)
      expect(validateOperationPayload(op.entity, op.kind, op.payload)).toBeNull()
  })

  it('applies a restore pulled from another device', async () => {
    const doc = await store.createDocument({ workspaceId: WS, title: 'Weg und wieder da' })
    await store.deleteDocument(doc.id)
    await db.operations.clear()
    const change: Change = {
      seq: 1,
      opId: newId(),
      deviceId: newId(),
      entity: 'document',
      entityId: doc.id,
      kind: 'restore',
      revision: 3,
      payload: {},
      appliedAt: new Date().toISOString(),
    }
    await store.applyRemoteChanges(WS, [change], 1)
    expect(await store.getDocument(doc.id)).toMatchObject({ revision: 3, deletedAt: null })
  })
})
