import 'fake-indexeddb/auto'
import { newId } from '@notion-alt/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalDb } from './db'
import { makeSnippet, SearchIndex, WorkspaceSearch } from './search'
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
})
