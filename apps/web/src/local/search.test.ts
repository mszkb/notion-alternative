import 'fake-indexeddb/auto'
import { newId } from '@notion-alt/shared'
import { Dexie } from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalDb } from './db'
import { makeSnippet, SEARCH_INDEX_FORMAT, SearchIndex, WorkspaceSearch } from './search'
import { LocalStore } from './store'

describe('SearchIndex', () => {
  it('finds by title, text and tags with prefix and fuzzy matching', () => {
    const index = new SearchIndex()
    index.upsert({ id: '1', title: 'Einkaufsliste', text: 'Milch und Brot', tags: 'privat' })
    index.upsert({ id: '2', title: 'Projektplan', text: 'Meilensteine für Phase zwei', tags: '' })

    expect(index.search('einkauf').map((hit) => hit.id)).toEqual(['1'])
    expect(index.search('Meilenstein').map((hit) => hit.id)).toEqual(['2'])
    expect(index.search('privat').map((hit) => hit.id)).toEqual(['1'])
    expect(index.search('Projetplan').map((hit) => hit.id)).toEqual(['2'])
    expect(index.search('   ')).toEqual([])
  })

  it('updates and removes entries', () => {
    const index = new SearchIndex()
    index.upsert({ id: '1', title: 'Alt', text: '', tags: '' })
    index.upsert({ id: '1', title: 'Neu', text: '', tags: '' })
    expect(index.search('alt')).toEqual([])
    expect(index.search('neu')).toHaveLength(1)
    index.remove('1')
    index.remove('unknown')
    expect(index.size).toBe(0)
  })

  it('builds snippets around the first match', () => {
    const text = `${'a '.repeat(100)}Treffer ${'b '.repeat(100)}`
    const snippet = makeSnippet(text, ['treffer'], 10)
    expect(snippet).toMatch(/^….*Treffer.*…$/)
  })
})

describe('WorkspaceSearch', () => {
  const WS = '22222222-2222-4222-8222-222222222222'
  let db: LocalDb
  let store: LocalStore
  let search: WorkspaceSearch

  beforeEach(async () => {
    db = new LocalDb(`search-${newId()}`)
    store = await LocalStore.open(db)
  })

  afterEach(async () => {
    search?.stop()
    db.close()
    await db.delete()
  })

  it('builds the index from one bulk read with the same content as per-page reads', async () => {
    const page = await store.createDocument({ workspaceId: WS, title: 'Projekt' })
    const [first] = await store.listBlocks(page.id)
    await store.updateBlock(first!.id, { content: 'erster' })
    const second = await store.createBlock(page.id, { type: 'paragraph', content: 'zweiter' })
    const gone = await store.createBlock(page.id, { type: 'paragraph', content: 'geloescht' })
    await store.deleteBlock(gone.id)
    await store.addTag(page.id, 'Zeta')
    const removed = await store.addTag(page.id, 'Weg')
    await store.removeTag(page.id, removed.id)
    await store.addTag(page.id, 'Alpha')
    const other = await store.createDocument({ workspaceId: WS, title: 'Leer' })
    const trashed = await store.createDocument({ workspaceId: WS, title: 'Papierkorb' })
    await store.deleteDocument(trashed.id)
    await store.createDocument({ workspaceId: newId(), title: 'Fremd' })

    const bulk = await store.documentsWithContent(WS)
    expect(bulk.map((entry) => entry.document.id)).toEqual(
      (await store.listDocuments(WS)).map((d) => d.id),
    )
    for (const { document, blocks, tags } of bulk) {
      expect(blocks).toEqual(await store.listBlocks(document.id))
      expect(tags).toEqual(await store.tagsForDocument(document.id))
    }
    const entry = bulk.find((e) => e.document.id === page.id)!
    expect(entry.blocks.map((b) => b.id)).toEqual([first!.id, second.id])
    expect(entry.tags.map((t) => t.name)).toEqual(['Alpha', 'Zeta'])
    expect(bulk.find((e) => e.document.id === other.id)!.blocks).toHaveLength(1)

    search = new WorkspaceSearch(store, WS)
    await search.start()
    expect(search.index.search('zweiter').map((hit) => hit.id)).toEqual([page.id])
    expect(search.index.search('geloescht')).toEqual([])
    expect(search.index.search('alpha').map((hit) => hit.id)).toEqual([page.id])
    expect(search.index.search('fremd')).toEqual([])
  })

  it('indexes existing pages and follows edits, tags and deletes', async () => {
    const existing = await store.createDocument({ workspaceId: WS, title: 'Bestehend' })
    search = new WorkspaceSearch(store, WS)
    await search.start()
    expect(search.index.search('bestehend').map((hit) => hit.id)).toEqual([existing.id])

    const page = await store.createDocument({ workspaceId: WS, title: 'Notizen' })
    const [block] = await store.listBlocks(page.id)
    await store.updateBlock(block!.id, { content: 'Das **Quartalsziel** ist klar' })
    await store.addTag(page.id, 'Arbeit')
    await search.flush()
    const [hit] = search.index.search('quartalsziel')
    expect(hit?.id).toBe(page.id)
    expect(hit?.snippet).toContain('Quartalsziel ist klar')
    expect(search.index.search('arbeit').map((h) => h.id)).toEqual([page.id])

    await store.deleteDocument(page.id)
    await search.flush()
    expect(search.index.search('quartalsziel')).toEqual([])
  })

  it('ignores other workspaces', async () => {
    search = new WorkspaceSearch(store, WS)
    await search.start()
    await store.createDocument({ workspaceId: newId(), title: 'Fremd' })
    await search.flush()
    expect(search.index.search('fremd')).toEqual([])
  })

  describe('saved index (#98)', () => {
    async function restart() {
      search.stop()
      search = new WorkspaceSearch(store, WS)
      await search.start()
      await search.saved()
      return search
    }
    const hits = (q: string) => search.index.search(q).map((hit) => hit.id)

    it('saves after a build and loads it at the next start', async () => {
      const page = await store.createDocument({ workspaceId: WS, title: 'Gespeichert' })
      search = new WorkspaceSearch(store, WS)
      await search.start()
      await search.saved()
      expect(search.startedFrom).toBe('build')
      expect((await store.searchIndexCache(WS))?.documentCount).toBe(1)
      expect((await store.searchDirtyMarks(WS)).size).toBe(0)

      await restart()
      expect(search.startedFrom).toBe('cache')
      expect(hits('gespeichert')).toEqual([page.id])
    })

    it('indexes pages changed while no search ran, and only those', async () => {
      const kept = await store.createDocument({ workspaceId: WS, title: 'Bleibt' })
      const edited = await store.createDocument({ workspaceId: WS, title: 'Alt' })
      const removed = await store.createDocument({ workspaceId: WS, title: 'Verschwindet' })
      search = new WorkspaceSearch(store, WS)
      await search.start()
      await search.saved()
      search.stop()

      await store.renameDocument(edited.id, 'Umbenannt')
      const [block] = await store.listBlocks(edited.id)
      await store.updateBlock(block!.id, { content: 'Neuer Absatz' })
      await store.deleteDocument(removed.id)
      const created = await store.createDocument({ workspaceId: WS, title: 'Hinzugekommen' })
      expect([...(await store.searchDirtyMarks(WS)).keys()].sort()).toEqual(
        [edited.id, removed.id, created.id].sort(),
      )

      await restart()
      expect(search.startedFrom).toBe('cache')
      expect(hits('umbenannt')).toEqual([edited.id])
      expect(hits('absatz')).toEqual([edited.id])
      expect(hits('alt')).toEqual([])
      expect(hits('verschwindet')).toEqual([])
      expect(hits('hinzugekommen')).toEqual([created.id])
      expect(hits('bleibt')).toEqual([kept.id])
    })

    it('keeps the mark of a page changed while the index was saved', async () => {
      const page = await store.createDocument({ workspaceId: WS, title: 'Vorher' })
      search = new WorkspaceSearch(store, WS)
      await search.start()
      await search.saved()
      const marks = await store.searchDirtyMarks(WS)
      await store.renameDocument(page.id, 'Nachher')
      const other = await store.createDocument({ workspaceId: WS, title: 'Anderes' })
      // The save took in the state before the rename: its marks do not match any more.
      await search.save(marks)
      expect([...(await store.searchDirtyMarks(WS)).keys()].sort()).toEqual(
        [page.id, other.id].sort(),
      )
      await restart()
      expect(hits('nachher')).toEqual([page.id])
    })

    it('rebuilds a damaged or outdated index and after many changes', async () => {
      const page = await store.createDocument({ workspaceId: WS, title: 'Robust' })
      await db.searchIndexes.put({
        workspaceId: WS,
        format: SEARCH_INDEX_FORMAT,
        documentCount: 1,
        json: '{kaputt',
      })
      search = new WorkspaceSearch(store, WS)
      await search.start()
      await search.saved()
      expect(search.startedFrom).toBe('build')
      expect(hits('robust')).toEqual([page.id])

      await db.searchIndexes.update(WS, { format: SEARCH_INDEX_FORMAT - 1 })
      await restart()
      expect(search.startedFrom).toBe('build')

      search.stop()
      for (let i = 0; i < 101; i++) await store.createDocument({ workspaceId: WS, title: `S ${i}` })
      await restart()
      expect(search.startedFrom).toBe('build')
      expect(search.index.size).toBe(102)
      await restart()
      expect(search.startedFrom).toBe('cache')
    })

    it('rebuilds once and saves when many pages change at once (#102)', async () => {
      search = new WorkspaceSearch(store, WS)
      await search.start()
      await search.saved()
      const ids: string[] = []
      for (let i = 0; i < 120; i++) {
        ids.push((await store.createDocument({ workspaceId: WS, title: `Masse ${i}` })).id)
      }
      await search.flush()
      await search.saved()
      expect(search.index.size).toBe(120)
      expect(hits('masse').length).toBe(20)
      // The rebuild was saved: no marks left, the next start loads it.
      expect((await store.searchDirtyMarks(WS)).size).toBe(0)
      await restart()
      expect(search.startedFrom).toBe('cache')
      expect(search.index.size).toBe(120)
    })

    it('marks pages written by a re-sync', async () => {
      search = new WorkspaceSearch(store, WS)
      await search.start()
      await search.saved()
      const page = {
        id: newId(),
        workspaceId: WS,
        parentId: null,
        title: 'Vom Server',
        sortKey: 'a0',
        favorite: false,
        createdAt: 'x',
        updatedAt: 'x',
        revision: 1,
        deletedAt: null,
      }
      await store.replaceWithSnapshot(WS, {
        documents: [page],
        blocks: [],
        tags: [],
        documentTags: [],
        attachments: [],
        conflicts: [],
        cursor: 1,
      })
      expect([...(await store.searchDirtyMarks(WS)).keys()]).toEqual([page.id])
      await restart()
      expect(search.startedFrom).toBe('cache')
      expect(hits('server')).toEqual([page.id])
    })
  })
})

describe('local schema upgrade to version 4 (T-MIG-02)', () => {
  it('keeps pages and queue; the first start builds and saves the index', async () => {
    const WS = '33333333-3333-4333-8333-333333333333'
    const name = `upgrade4-${newId()}`
    const v3 = new Dexie(name)
    v3.version(1).stores({
      meta: 'key',
      workspaces: 'id',
      documents: 'id, workspaceId, parentId, updatedAt',
      blocks: 'id, documentId',
      tags: 'id, workspaceId',
      documentTags: 'id, documentId, tagId, workspaceId',
      operations: '++seq, &opId, entityId, workspaceId',
      links: 'blockId, documentId, workspaceId, *targets',
    })
    v3.version(2).stores({ conflicts: 'id, workspaceId, documentId, entityId' })
    v3.version(3).stores({
      attachments: 'id, workspaceId, documentId',
      attachmentContents: 'id',
    })
    await v3.table('documents').put({
      id: 'd1',
      workspaceId: WS,
      parentId: null,
      title: 'Vor dem Upgrade',
      sortKey: 'a0',
      favorite: false,
      deletedAt: null,
    })
    await v3.table('operations').add({ opId: 'o1', entityId: 'd1', workspaceId: WS })
    v3.close()

    const upgraded = new LocalDb(name)
    const store = await LocalStore.open(upgraded)
    expect(await upgraded.operations.count()).toBe(1)
    const search = new WorkspaceSearch(store, WS)
    await search.start()
    await search.saved()
    expect(search.startedFrom).toBe('build')
    expect(search.index.search('upgrade').map((hit) => hit.id)).toEqual(['d1'])
    expect(await upgraded.searchIndexes.count()).toBe(1)
    search.stop()
    upgraded.close()
    await Dexie.delete(name)
  })
})
