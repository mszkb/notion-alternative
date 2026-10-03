import { newId, type Block, type Document, type SyncSnapshotResponse } from '@notion-alt/shared'
import { LocalDb } from './db'
import { WorkspaceSearch } from './search'
import { LocalStore } from './store'

// Client load scenario (#77): a large workspace arrives as a snapshot (new device / re-sync),
// then the sidebar list, the search index build and searches are timed. Runs in Node with
// fake-indexeddb (`pnpm --filter @notion-alt/web loadtest`) and in Chromium
// (`pnpm --filter @notion-alt/web loadtest:browser`); see docs/testing/load-tests.md.

export interface ClientLoadOptions {
  pages: number
  blocksPerPage: number
  /** Used heap in MB, measured by the caller's runtime (null if unavailable). */
  heapMb: () => number | null
}

const WORDS = (
  'projekt plan notiz aufgabe idee besprechung entwurf kunde rechnung server backup sync ' +
  'garten reise rezept buch film musik code fehler test release woche monat jahr team ' +
  'offline lokal export import seite block liste frage antwort termin budget ziel'
).split(' ')

let seed = 42
function random(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}
const sentence = (n: number) =>
  Array.from({ length: n }, () => WORDS[Math.floor(random() * WORDS.length)]).join(' ')

function snapshot(workspaceId: string, pages: number, blocksPerPage: number): SyncSnapshotResponse {
  const now = new Date().toISOString()
  const documents: Document[] = []
  const blocks: Block[] = []
  for (let p = 0; p < pages; p++) {
    const id = newId()
    documents.push({
      id,
      workspaceId,
      parentId: p % 10 === 0 ? null : documents[p - (p % 10)]!.id,
      title: `Seite ${p} ${sentence(3)}`,
      sortKey: `a${String(p).padStart(6, '0')}`,
      favorite: false,
      createdAt: now,
      updatedAt: now,
      revision: 1,
      deletedAt: null,
    })
    for (let b = 0; b < blocksPerPage; b++) {
      blocks.push({
        id: newId(),
        documentId: id,
        type: 'paragraph',
        content: sentence(12 + Math.floor(random() * 20)),
        attrs: {},
        sortKey: `a${String(b).padStart(4, '0')}`,
        revision: 1,
        deletedAt: null,
      })
    }
  }
  return {
    documents,
    blocks,
    tags: [],
    documentTags: [],
    attachments: [],
    conflicts: [],
    cursor: documents.length + blocks.length,
  }
}

async function time<T>(fn: () => Promise<T> | T): Promise<[T, number]> {
  const started = performance.now()
  const value = await fn()
  return [value, Math.round(performance.now() - started)]
}

export async function runClientLoad({ pages, blocksPerPage, heapMb }: ClientLoadOptions) {
  seed = 42
  const workspaceId = newId()
  const data = snapshot(workspaceId, pages, blocksPerPage)
  const heapBefore = heapMb()
  const store = await LocalStore.open(new LocalDb(`load-${workspaceId}`))

  const [, snapshotMs] = await time(() => store.replaceWithSnapshot(workspaceId, data))
  const [documents, listMs] = await time(() => store.listDocuments(workspaceId))
  const [, pageMs] = await time(() => store.listBlocks(documents[pages - 1]!.id))

  const [, contentReadMs] = await time(() => store.documentsWithContent(workspaceId))
  const search = new WorkspaceSearch(store, workspaceId)
  const [, indexMs] = await time(() => search.start())
  const heapAfterIndex = heapMb()

  const queries: number[] = []
  for (let i = 0; i < 50; i++) {
    const q = i % 2 ? WORDS[i % WORDS.length]! : `${WORDS[i % WORDS.length]} seite`
    queries.push((await time(() => search.index.search(q)))[1])
  }
  queries.sort((a, b) => a - b)
  search.stop()

  return {
    config: { pages, blocksPerPage },
    documents: documents.length,
    indexed: search.index.size,
    replaceWithSnapshotMs: snapshotMs,
    listDocumentsMs: listMs,
    listBlocksOnePageMs: pageMs,
    /** Bulk read of all pages, blocks and tags (part of the index build). */
    contentReadMs,
    searchIndexBuildMs: indexMs,
    searchQueryMs: { p50: queries[25], p95: queries[47], max: queries.at(-1) },
    heapMb: { before: heapBefore, afterIndex: heapAfterIndex },
  }
}
