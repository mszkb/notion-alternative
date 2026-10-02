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
