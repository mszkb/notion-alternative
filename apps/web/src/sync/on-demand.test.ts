import 'fake-indexeddb/auto'
import {
  type Change,
  newId,
  type Operation,
  type SyncDocumentResponse,
  type SyncPullQuery,
  type SyncPushResult,
  type SyncSnapshotResponse,
} from '@notion-alt/shared'
import { Dexie } from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ApiError } from '../api'
import { LocalDb } from '../local/db'
import { LocalStore } from '../local/store'
import { connection } from '../session'
import { ensureDocumentLoaded, loadAllDocuments } from './offline'
import { pushQueue } from './push'
import { syncWorkspace } from './resync'

// ADR 0017: page content on demand.

const WS = '11111111-1111-4111-8111-111111111111'

let dbs: LocalDb[] = []
async function device(mode?: 'all'): Promise<LocalStore> {
  const db = new LocalDb(`on-demand-${newId()}`)
  dbs.push(db)
  const store = await LocalStore.open(db)
  if (mode) await store.db.meta.put({ key: 'offlineMode', value: mode })
  return store
}
afterEach(async () => {
  for (const db of dbs) {
    db.close()
    await db.delete()
  }
  dbs = []
})

/**
 * Fake server: change log plus snapshots and single pages taken from the reference device
 * `origin`, whose local state equals the server state after it synced.
 */
function fakeServer(origin: () => LocalStore) {
  const log: Change[] = []
  const revisions = new Map<string, number>()
  const calls = { snapshot: [] as boolean[], document: [] as string[] }
  return {
    calls,
    push: async ({ operations }: { operations: Operation[] }) => ({
      results: operations.map((op): SyncPushResult => {
        const revision = (revisions.get(op.entityId) ?? 0) + 1
        revisions.set(op.entityId, revision)
        log.push({
          seq: log.length + 1,
          opId: op.opId,
          deviceId: op.deviceId,
          entity: op.entity,
          entityId: op.entityId,
          kind: op.kind,
          revision,
          payload: op.payload,
          appliedAt: new Date().toISOString(),
        })
        return { opId: op.opId, status: 'applied', revision, seq: log.length }
      }),
    }),
    pull: async ({ cursor, limit }: SyncPullQuery) => {
      const rest = log.filter((c) => c.seq > cursor)
      const page = rest.slice(0, limit)
      return { changes: page, cursor: page.at(-1)?.seq ?? cursor, hasMore: rest.length > limit }
    },
    snapshot: async (
      _ws: string,
      _after?: string,
      content = true,
    ): Promise<SyncSnapshotResponse> => {
      calls.snapshot.push(content)
      const store = origin()
      const documents = await store.db.documents.where('workspaceId').equals(WS).toArray()
      return {
        documents,
        blocks: content
          ? await store.db.blocks
              .where('documentId')
              .anyOf(documents.map((d) => d.id))
              .toArray()
          : [],
        tags: await store.db.tags.toArray(),
        documentTags: await store.db.documentTags.toArray(),
        attachments: [],
        conflicts: [],
        cursor: log.length,
      }
    },
    document: async (_ws: string, id: string): Promise<SyncDocumentResponse> => {
      calls.document.push(id)
      const store = origin()
      const document = await store.db.documents.get(id)
      if (!document) throw new ApiError(404, 'not_found', 'Page not found')
      return {
        document,
        blocks: await store.db.blocks.where('documentId').equals(id).toArray(),
        seq: log.length,
      }
    },
  }
}

let a: LocalStore
let b: LocalStore
let server: ReturnType<typeof fakeServer>

beforeEach(async () => {
  connection.value = 'online'
  a = await device('all')
  b = await device()
  server = fakeServer(() => a)
})

async function syncA() {
  await pushQueue(a, server.push)
  await syncWorkspace(a, WS, server)
}

async function pageWithText(title: string, text: string) {
  const doc = await a.createDocument({ workspaceId: WS, title })
  const [block] = await a.listBlocks(doc.id)
  await a.updateBlock(block!.id, { content: text })
  return { doc, block: block! }
}

describe('content on demand', () => {
  it('a new device starts on demand and gets the page tree without content', async () => {
    const { doc } = await pageWithText('Notizen', 'Inhalt')
    await a.addTag(doc.id, 'Projekt')
    await syncA()
    server.calls.snapshot = []

    expect(await b.offlineMode()).toBe('onDemand')
    expect(await syncWorkspace(b, WS, server)).toBe('resync')
    expect(server.calls.snapshot).toEqual([false])
    expect((await b.getDocument(doc.id))!.title).toBe('Notizen')
    expect((await b.tagsForDocument(doc.id)).map((t) => t.name)).toEqual(['Projekt'])
    expect(await b.listBlocks(doc.id)).toEqual([])
    expect(await b.isDocumentLoaded(doc.id)).toBe(false)
    expect(await b.syncCursor(WS)).toBe(await a.syncCursor(WS))
    expect(await b.pendingOperationCount()).toBe(0)
  })

  it('loads a page when it is opened and keeps it current afterwards', async () => {
    const { doc, block } = await pageWithText('Notizen', 'eins')
    await syncA()
    await syncWorkspace(b, WS, server)

    // Edited elsewhere while not loaded here: the pull skips the content, not the title.
    await a.updateBlock(block.id, { content: 'zwei' })
    await a.renameDocument(doc.id, 'Neu')
    await syncA()
    await syncWorkspace(b, WS, server)
    expect((await b.getDocument(doc.id))!.title).toBe('Neu')
    expect(await b.listBlocks(doc.id)).toEqual([])

    // A change the device has not pulled yet is contained in the loaded page; replaying it
    // later must not go back to an older state.
    await a.updateBlock(block.id, { content: 'drei' })
    await syncA()
    expect(await ensureDocumentLoaded(b, WS, doc.id, server.document)).toBe('loaded')
    expect((await b.listBlocks(doc.id)).map((x) => x.content)).toEqual(['drei'])
    await syncWorkspace(b, WS, server)
    expect((await b.listBlocks(doc.id)).map((x) => x.content)).toEqual(['drei'])

    await a.updateBlock(block.id, { content: 'vier' })
    await syncA()
    await syncWorkspace(b, WS, server)
    expect((await b.listBlocks(doc.id)).map((x) => x.content)).toEqual(['vier'])
    expect(await b.pendingOperationCount()).toBe(0)
  })

  it('pages created elsewhere stay unloaded, own pages are loaded', async () => {
    await syncA()
    await syncWorkspace(b, WS, server)
    const { doc: remote } = await pageWithText('Fremd', 'x')
    await syncA()
    const own = await b.createDocument({ workspaceId: WS, title: 'Eigen' })
    await pushQueue(b, server.push)
    await syncWorkspace(b, WS, server)

    expect(await b.isDocumentLoaded(remote.id)).toBe(false)
    expect(await b.listBlocks(remote.id)).toEqual([])
    expect(await b.isDocumentLoaded(own.id)).toBe(true)
    expect(await b.listBlocks(own.id)).toHaveLength(1)
  })

  it('offline, an unloaded page reports offline instead of looking empty', async () => {
    const { doc } = await pageWithText('Notizen', 'x')
    await syncA()
    await syncWorkspace(b, WS, server)
    connection.value = 'offline'
    expect(await ensureDocumentLoaded(b, WS, doc.id, server.document)).toBe('offline')
    expect(server.calls.document).toEqual([])
    const unreachable = async (): Promise<SyncDocumentResponse> => {
      throw new TypeError('Failed to fetch')
    }
    connection.value = 'online'
    expect(await ensureDocumentLoaded(b, WS, doc.id, unreachable)).toBe('offline')
    expect(await b.isDocumentLoaded(doc.id)).toBe(false)
  })

  it('a full re-sync refreshes loaded pages one by one and leaves the others unloaded', async () => {
    const { doc: loaded, block } = await pageWithText('Geladen', 'alt')
    const { doc: other } = await pageWithText('Andere', 'x')
    await syncA()
    await syncWorkspace(b, WS, server)
    await ensureDocumentLoaded(b, WS, loaded.id, server.document)

    await a.updateBlock(block.id, { content: 'neu' })
    await syncA()
    server.calls.document = []
    expect(await syncWorkspace(b, WS, server, true)).toBe('resync')
    expect(server.calls.snapshot.at(-1)).toBe(false)
    expect(server.calls.document).toEqual([loaded.id])
    expect((await b.listBlocks(loaded.id)).map((x) => x.content)).toEqual(['neu'])
    expect(await b.isDocumentLoaded(other.id)).toBe(false)
    expect(await b.pendingOperationCount()).toBe(0)
  })

  it('a loaded block the server lost (restored backup, #75) is sent again, not dropped', async () => {
    const { doc, block } = await pageWithText('Notizen', 'wichtig')
    await syncA()
    await syncWorkspace(b, WS, server)
    await ensureDocumentLoaded(b, WS, doc.id, server.document)

    const restored = async (ws: string, id: string) => {
      const content = await server.document(ws, id)
      return { ...content, blocks: content.blocks.filter((x) => x.id !== block.id) }
    }
    await syncWorkspace(b, WS, { ...server, document: restored }, true)
    expect((await b.listBlocks(doc.id)).map((x) => x.content)).toEqual(['wichtig'])
    const queued = await b.pendingOperations(WS)
    expect(queued.map((op) => [op.entity, op.kind, op.entityId])).toEqual([
      ['block', 'create', block.id],
    ])
  })

  it('loading everything can be cancelled and resumed, then switches to "all"', async () => {
    const pages = []
    for (const title of ['A', 'B', 'C', 'D', 'E'])
      pages.push((await pageWithText(title, title)).doc)
    await syncA()
    await syncWorkspace(b, WS, server)

    const controller = new AbortController()
    const progress: number[] = []
    const first = await loadAllDocuments(b, {
      fetchDocument: async (ws, id) => {
        if (progress.length === 2) controller.abort()
        return server.document(ws, id)
      },
      onProgress: (p) => progress.push(p.done),
      signal: controller.signal,
      concurrency: 1,
    })
    expect(first.stopped).toBe('cancelled')
    expect(first.loaded).toBeGreaterThan(0)
    expect(first.loaded).toBeLessThan(5)
    expect(await b.offlineMode()).toBe('onDemand')
    expect((await b.unloadedDocuments()).length).toBe(5 - first.loaded)

    const totals: number[] = []
    const second = await loadAllDocuments(b, {
      fetchDocument: server.document,
      onProgress: (p) => totals.push(p.total),
    })
    expect(second).toEqual({ loaded: 5 - first.loaded, stopped: null })
    expect(totals[0]).toBe(5 - first.loaded)
    expect(await b.offlineMode()).toBe('all')
    for (const page of pages) {
      expect((await b.listBlocks(page.id)).map((x) => x.content)).toEqual([page.title])
    }

    // From now on new pages from elsewhere arrive with content.
    const { doc } = await pageWithText('Später', 'mit Inhalt')
    await syncA()
    await syncWorkspace(b, WS, server)
    expect((await b.listBlocks(doc.id)).map((x) => x.content)).toEqual(['mit Inhalt'])

    // Back to "on demand": what is loaded stays.
    await b.setOfflineModeOnDemand()
    expect(await b.isDocumentLoaded(doc.id)).toBe(true)
  })

  it('stops when the connection is lost and keeps what was loaded', async () => {
    for (const title of ['A', 'B', 'C']) await pageWithText(title, title)
    await syncA()
    await syncWorkspace(b, WS, server)
    let calls = 0
    const result = await loadAllDocuments(b, {
      fetchDocument: async (ws, id) => {
        if (++calls === 2) throw new TypeError('Failed to fetch')
        return server.document(ws, id)
      },
      concurrency: 1,
    })
    expect(result).toEqual({ loaded: 1, stopped: 'offline' })
    expect((await b.unloadedDocuments()).length).toBe(2)
    expect(await b.offlineMode()).toBe('onDemand')
  })
})

describe('upgrade of the local database (T-MIG-02)', () => {
  it('keeps devices that already hold content on "all", new ones start on demand', async () => {
    const name = `on-demand-upgrade-${newId()}`
    const old = new Dexie(name)
    old.version(1).stores({
      meta: 'key',
      workspaces: 'id',
      documents: 'id, workspaceId, parentId, updatedAt',
      blocks: 'id, documentId',
      tags: 'id, workspaceId',
      documentTags: 'id, documentId, tagId, workspaceId',
      operations: '++seq, &opId, entityId, workspaceId',
      links: 'blockId, documentId, workspaceId, *targets',
    })
    old.version(2).stores({ conflicts: 'id, workspaceId, documentId, entityId' })
    old.version(3).stores({ attachments: 'id, workspaceId, documentId', attachmentContents: 'id' })
    old.version(4).stores({ searchIndexes: 'workspaceId', searchDirty: 'documentId, workspaceId' })
    await old.open()
    await old.table('meta').put({ key: `syncCursor:${WS}`, value: 7 })
    old.close()

    const db = new LocalDb(name)
    dbs.push(db)
    const store = await LocalStore.open(db)
    expect(await store.offlineMode()).toBe('all')
    expect(await store.syncCursor(WS)).toBe(7)
  })
})
