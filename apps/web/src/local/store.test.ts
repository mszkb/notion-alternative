import 'fake-indexeddb/auto'
import { newId, operationSchema } from '@notion-alt/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalDb } from './db'
import { LocalStore, LocalStoreError, type StoreChange } from './store'

const WS = '11111111-1111-4111-8111-111111111111'

let db: LocalDb
let store: LocalStore
let clock = 0

beforeEach(async () => {
  clock = 0
  db = new LocalDb(`test-${newId()}`)
  // Deterministic, strictly increasing timestamps.
  store = await LocalStore.open(db, () =>
    new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)).toISOString(),
  )
})

afterEach(async () => {
  db.close()
  await db.delete()
})

async function ops() {
  return store.pendingOperations()
}

describe('device id', () => {
  it('is created once and stays stable across reopen', async () => {
    const reopened = await LocalStore.open(db)
    expect(reopened.deviceId).toBe(store.deviceId)
  })
})

describe('operations', () => {
  it('records one valid operation per change, in order', async () => {
    const document = await store.createDocument({ workspaceId: WS, title: 'Start' })
    const [block] = await store.listBlocks(document.id)
    await store.updateBlock(block!.id, { content: 'Hallo **Welt**' })
    await store.renameDocument(document.id, 'Start 2')

    const queue = await ops()
    expect(queue.map((op) => `${op.entity}:${op.kind}`)).toEqual([
      'document:create',
      'block:create',
      'block:update',
      'document:update',
    ])
    for (const op of queue) {
      expect(operationSchema.safeParse(op).success).toBe(true)
      expect(op.deviceId).toBe(store.deviceId)
      expect(op.workspaceId).toBe(WS)
      expect(op.baseRevision).toBeNull()
    }
    expect(new Set(queue.map((op) => op.opId)).size).toBe(queue.length)
    expect(queue[2]!.payload).toEqual({ content: 'Hallo **Welt**' })
  })

  it('creates no operation for an unchanged save', async () => {
    const document = await store.createDocument({ workspaceId: WS })
    const [block] = await store.listBlocks(document.id)
    const before = (await ops()).length
    await store.updateBlock(block!.id, { content: '', type: 'paragraph', attrs: {} })
    await store.renameDocument(document.id, '')
    expect((await ops()).length).toBe(before)
  })

  it('carries the synced revision as base revision', async () => {
    const document = await store.createDocument({ workspaceId: WS })
    const [block] = await store.listBlocks(document.id)
    await db.blocks.update(block!.id, { revision: 7 })
    await store.updateBlock(block!.id, { content: 'x' })
    expect((await ops()).at(-1)!.baseRevision).toBe(7)
  })

  it('writes content and operation atomically', async () => {
    const document = await store.createDocument({ workspaceId: WS })
    const [block] = await store.listBlocks(document.id)
    const before = (await ops()).length

    // Make the queue insert fail inside the transaction: a duplicate op id violates `&opId`.
    const existing = (await ops())[0]!
    const original = db.operations.add.bind(db.operations)
    db.operations.add = ((op: typeof existing) =>
      original({ ...op, opId: existing.opId })) as typeof db.operations.add
    await expect(store.updateBlock(block!.id, { content: 'lost' })).rejects.toThrow()
    db.operations.add = original

    expect((await store.listBlocks(document.id))[0]!.content).toBe('')
    expect((await ops()).length).toBe(before)
  })

  it('rejects invalid content without writing anything', async () => {
    const document = await store.createDocument({ workspaceId: WS })
    const before = (await ops()).length
    await expect(
      store.createBlock(document.id, { type: 'heading', attrs: { level: 9 } }),
    ).rejects.toThrow()
    expect((await ops()).length).toBe(before)
    expect(await store.listBlocks(document.id)).toHaveLength(1)
  })

  it('notifies listeners only after commit', async () => {
    const changes: StoreChange[] = []
    store.onChange((change) => changes.push(change))
    const document = await store.createDocument({ workspaceId: WS })
    expect(changes).toEqual([{ workspaceId: WS, documentIds: [document.id] }])
    await expect(store.renameDocument(newId(), 'x')).rejects.toBeInstanceOf(LocalStoreError)
    expect(changes).toHaveLength(1)
  })
})

describe('page tree', () => {
  it('orders siblings and supports nesting and moves', async () => {
    const a = await store.createDocument({ workspaceId: WS, title: 'A' })
    const c = await store.createDocument({ workspaceId: WS, title: 'C' })
    const b = await store.createDocument({
      workspaceId: WS,
      title: 'B',
      position: { afterId: a.id },
    })
    const child = await store.createDocument({ workspaceId: WS, title: 'A1', parentId: a.id })

    const roots = (await store.listDocuments(WS)).filter((d) => d.parentId === null)
    expect(roots.map((d) => d.title)).toEqual(['A', 'B', 'C'])

    await store.moveDocument(c.id, null, { afterId: null })
    await store.moveDocument(b.id, a.id, { afterId: child.id })
    const all = await store.listDocuments(WS)
    expect(all.filter((d) => d.parentId === null).map((d) => d.title)).toEqual(['C', 'A'])
    expect(all.filter((d) => d.parentId === a.id).map((d) => d.title)).toEqual(['A1', 'B'])
    expect((await ops()).filter((op) => op.kind === 'move')).toHaveLength(2)
  })

  it('refuses to move a page below itself', async () => {
    const a = await store.createDocument({ workspaceId: WS })
    const child = await store.createDocument({ workspaceId: WS, parentId: a.id })
    await expect(store.moveDocument(a.id, child.id)).rejects.toThrow(/below itself/)
    await expect(store.moveDocument(a.id, a.id)).rejects.toThrow(/below itself/)
  })

  it('tombstones a page with its subtree (T-DEL-03)', async () => {
    const a = await store.createDocument({ workspaceId: WS })
    const child = await store.createDocument({ workspaceId: WS, parentId: a.id })
    const grandchild = await store.createDocument({ workspaceId: WS, parentId: child.id })
    const other = await store.createDocument({ workspaceId: WS })

    const deleted = await store.deleteDocument(a.id)
    expect(new Set(deleted)).toEqual(new Set([a.id, child.id, grandchild.id]))
    expect((await store.listDocuments(WS)).map((d) => d.id)).toEqual([other.id])
    // Tombstones, not physical deletes.
    expect((await db.documents.get(grandchild.id))?.deletedAt).toBeTruthy()
    const deletes = (await ops()).filter((op) => op.kind === 'delete')
    expect(deletes.map((op) => op.entityId).sort()).toEqual(deleted.sort())
  })
})

describe('blocks', () => {
  it('splits and merges blocks in one transaction each', async () => {
    const document = await store.createDocument({ workspaceId: WS })
    const [first] = await store.listBlocks(document.id)
    await store.updateBlock(first!.id, { content: 'HelloWorld' })
    const tail = await store.splitBlock(first!.id, 'Hello', { content: 'World' })
    expect((await store.listBlocks(document.id)).map((b) => b.content)).toEqual(['Hello', 'World'])

    await store.mergeBlocks(first!.id, tail.id, 'HelloWorld')
    expect((await store.listBlocks(document.id)).map((b) => b.content)).toEqual(['HelloWorld'])
    expect((await db.blocks.get(tail.id))?.deletedAt).toBeTruthy()
  })

  it('inserts at the start, after a block and at the end', async () => {
    const document = await store.createDocument({ workspaceId: WS })
    const [first] = await store.listBlocks(document.id)
    await store.updateBlock(first!.id, { content: '2' })
    await store.createBlock(document.id, { content: '4' })
    await store.createBlock(document.id, { content: '1' }, { afterId: null })
    await store.createBlock(document.id, { content: '3' }, { afterId: first!.id })
    expect((await store.listBlocks(document.id)).map((b) => b.content)).toEqual([
      '1',
      '2',
      '3',
      '4',
    ])
  })

  it('bumps updatedAt for recently edited pages', async () => {
    const a = await store.createDocument({ workspaceId: WS, title: 'A' })
    await store.createDocument({ workspaceId: WS, title: 'B' })
    const [block] = await store.listBlocks(a.id)
    await store.updateBlock(block!.id, { content: 'edit' })
    expect((await store.recentDocuments(WS)).map((d) => d.title)).toEqual(['A', 'B'])
  })
})

describe('links and backlinks', () => {
  it('derives backlinks from page links and drops them when removed', async () => {
    const target = await store.createDocument({ workspaceId: WS, title: 'Ziel' })
    const source = await store.createDocument({ workspaceId: WS, title: 'Quelle' })
    const [block] = await store.listBlocks(source.id)
    await store.updateBlock(block!.id, { content: `siehe [Ziel](page:${target.id})` })
    expect((await store.backlinks(target.id)).map((d) => d.title)).toEqual(['Quelle'])

    await store.updateBlock(block!.id, { content: 'kein Link mehr' })
    expect(await store.backlinks(target.id)).toEqual([])
  })

  it('ignores links in code blocks, deleted blocks and deleted sources', async () => {
    const target = await store.createDocument({ workspaceId: WS })
    const source = await store.createDocument({ workspaceId: WS })
    const link = `[x](page:${target.id})`
    const code = await store.createBlock(source.id, { type: 'code', content: link })
    expect(await store.backlinks(target.id)).toEqual([])

    await store.updateBlock(code.id, { type: 'paragraph' })
    expect(await store.backlinks(target.id)).toHaveLength(1)
    await store.deleteBlock(code.id)
    expect(await store.backlinks(target.id)).toEqual([])

    const again = await store.createBlock(source.id, { content: link })
    expect(again).toBeTruthy()
    await store.deleteDocument(source.id)
    expect(await store.backlinks(target.id)).toEqual([])
  })
})

describe('tags and favorites', () => {
  it('reuses tags case-insensitively and records assignment operations', async () => {
    const a = await store.createDocument({ workspaceId: WS, title: 'A' })
    const b = await store.createDocument({ workspaceId: WS, title: 'B' })
    const tag = await store.addTag(a.id, 'Projekt')
    const same = await store.addTag(b.id, ' projekt ')
    await store.addTag(b.id, 'Projekt')
    expect(same.id).toBe(tag.id)
    expect(await store.listTags(WS)).toHaveLength(1)
    expect((await store.documentsForTag(tag.id)).map((d) => d.title)).toEqual(['A', 'B'])

    await store.removeTag(a.id, tag.id)
    expect(await store.tagsForDocument(a.id)).toEqual([])
    const tagOps = (await ops()).filter((op) => op.entity !== 'document' && op.entity !== 'block')
    expect(tagOps.map((op) => `${op.entity}:${op.kind}`)).toEqual([
      'tag:create',
      'document_tag:create',
      'document_tag:create',
      'document_tag:delete',
    ])
  })

  it('lists favorites', async () => {
    const a = await store.createDocument({ workspaceId: WS, title: 'A' })
    await store.createDocument({ workspaceId: WS, title: 'B' })
    await store.setFavorite(a.id, true)
    expect((await store.favoriteDocuments(WS)).map((d) => d.title)).toEqual(['A'])
    await store.setFavorite(a.id, false)
    expect(await store.favoriteDocuments(WS)).toEqual([])
  })
})

describe('persistence across reopen (T-OFF-02, data layer)', () => {
  it('keeps content and queue after closing and reopening the database', async () => {
    const document = await store.createDocument({ workspaceId: WS, title: 'Offline' })
    const [block] = await store.listBlocks(document.id)
    await store.updateBlock(block!.id, { content: 'bleibt erhalten' })
    const queued = (await ops()).length
    db.close()

    const reopenedDb = new LocalDb(db.name)
    const reopened = await LocalStore.open(reopenedDb)
    expect((await reopened.listBlocks(document.id))[0]!.content).toBe('bleibt erhalten')
    expect((await reopened.pendingOperations()).length).toBe(queued)
    reopenedDb.close()
    db = reopenedDb
  })
})
