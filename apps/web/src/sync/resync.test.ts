import 'fake-indexeddb/auto'
import {
  type Change,
  newId,
  type Operation,
  type SyncPullQuery,
  type SyncPushResult,
  type SyncSnapshotResponse,
} from '@notion-alt/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ApiError } from '../api'
import { LocalDb } from '../local/db'
import { LocalStore } from '../local/store'
import { pushQueue } from './push'
import { syncWorkspace } from './resync'

const WS = '11111111-1111-4111-8111-111111111111'

let dbs: LocalDb[] = []
async function device(): Promise<LocalStore> {
  const db = new LocalDb(`resync-${newId()}`)
  dbs.push(db)
  return LocalStore.open(db)
}
afterEach(async () => {
  for (const db of dbs) {
    db.close()
    await db.delete()
  }
  dbs = []
})

/**
 * Fake server: change log plus a snapshot taken from the reference device `origin`, whose local
 * state equals the server state after it synced. `compactedThrough` simulates log compaction.
 */
function fakeServer(origin: () => LocalStore) {
  const log: Change[] = []
  const revisions = new Map<string, number>()
  let compactedThrough = 0
  const calls = { snapshot: 0, pull: 0 }
  return {
    calls,
    compact: () => (compactedThrough = log.length),
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
      calls.pull++
      if (cursor < compactedThrough) throw new ApiError(410, 'cursor_expired', 'gone')
      const rest = log.filter((c) => c.seq > cursor)
      const page = rest.slice(0, limit)
      return { changes: page, cursor: page.at(-1)?.seq ?? cursor, hasMore: rest.length > limit }
    },
    snapshot: async (): Promise<SyncSnapshotResponse> => {
      calls.snapshot++
      const store = origin()
      const documents = await store.db.documents.where('workspaceId').equals(WS).toArray()
      return {
        documents,
        blocks: await store.db.blocks
          .where('documentId')
          .anyOf(documents.map((d) => d.id))
          .toArray(),
        tags: await store.db.tags.toArray(),
        documentTags: await store.db.documentTags.toArray(),
        attachments: [],
        conflicts: [],
        cursor: log.length,
      }
    },
  }
}

let a: LocalStore
let b: LocalStore
let server: ReturnType<typeof fakeServer>

beforeEach(async () => {
  a = await device()
  b = await device()
  server = fakeServer(() => a)
})

async function syncA() {
  await pushQueue(a, server.push)
  await syncWorkspace(a, WS, server)
}

describe('syncWorkspace', () => {
  it('a new device gets the complete workspace from a snapshot', async () => {
    const doc = await a.createDocument({ workspaceId: WS, title: 'Alles' })
    const [block] = await a.listBlocks(doc.id)
    await a.updateBlock(block!.id, { content: 'Inhalt' })
    await a.addTag(doc.id, 'Projekt')
    await syncA()

    server.calls.snapshot = 0
    expect(await syncWorkspace(b, WS, server)).toBe('resync')
    expect(server.calls.snapshot).toBe(1)
    expect((await b.getDocument(doc.id))!.title).toBe('Alles')
    expect((await b.listBlocks(doc.id))[0]!.content).toBe('Inhalt')
    expect((await b.tagsForDocument(doc.id)).map((t) => t.name)).toEqual(['Projekt'])
    expect(await b.syncCursor(WS)).toBe(await a.syncCursor(WS))
    expect(await b.pendingOperationCount()).toBe(0)

    // Afterwards the device continues with delta pulls.
    expect(await syncWorkspace(b, WS, server)).toBe('pull')
  })

  it('rebuilds the backlink index from the snapshot', async () => {
    const target = await a.createDocument({ workspaceId: WS, title: 'Ziel' })
    const source = await a.createDocument({ workspaceId: WS, title: 'Quelle' })
    const [block] = await a.listBlocks(source.id)
    await a.updateBlock(block!.id, { content: `Siehe [Ziel](page:${target.id})` })
    await syncA()

    expect(await syncWorkspace(b, WS, server)).toBe('resync')
    expect((await b.backlinks(target.id)).map((d) => d.id)).toEqual([source.id])
    expect(await b.backlinks(source.id)).toEqual([])
  })

  it('T-MD-05: after compaction the device re-syncs without losing local changes', async () => {
    const doc = await a.createDocument({ workspaceId: WS, title: 'Basis' })
    await syncA()
    await syncWorkspace(b, WS, server)

    // B works offline for a long time: edits a block and creates a page.
    const [blockOnB] = await b.listBlocks(doc.id)
    await b.updateBlock(blockOnB!.id, { content: 'lange offline' })
    const local = await b.createDocument({ workspaceId: WS, title: 'Nur auf B' })

    // Meanwhile A renames and adds a page; the server compacts its log.
    await a.renameDocument(doc.id, 'Basis (umbenannt)')
    const fromA = await a.createDocument({ workspaceId: WS, title: 'Von A' })
    await syncA()
    server.compact()

    expect(await syncWorkspace(b, WS, server)).toBe('resync')
    expect((await b.getDocument(doc.id))!.title).toBe('Basis (umbenannt)')
    expect((await b.getDocument(fromA.id))!.title).toBe('Von A')
    // Unsynced local work is still there and still queued.
    expect((await b.listBlocks(doc.id))[0]!.content).toBe('lange offline')
    expect((await b.getDocument(local.id))!.title).toBe('Nur auf B')
    const queued = (await b.pendingOperations()).map((op) => op.entityId)
    expect(queued).toContain(blockOnB!.id)
    expect(queued).toContain(local.id)
  })

  it('re-syncs on request even with a valid cursor', async () => {
    await a.createDocument({ workspaceId: WS, title: 'X' })
    await syncA()
    await syncWorkspace(b, WS, server)
    server.calls.snapshot = 0
    expect(await syncWorkspace(b, WS, server, true)).toBe('resync')
    expect(server.calls.snapshot).toBe(1)
  })
})

describe('snapshot after a server restore from an older backup', () => {
  it('keeps content the server lost and sends it again, parents first', async () => {
    const store = await device()
    const kept = await store.createDocument({ workspaceId: WS, title: 'Vor dem Backup' })
    const lostPage = await store.createDocument({ workspaceId: WS, title: 'Nach dem Backup' })
    const lostChild = await store.createDocument({
      workspaceId: WS,
      parentId: lostPage.id,
      title: 'Unterseite',
    })
    const block = await store.createBlock(lostChild.id, { content: 'Nur noch hier' })
    const tag = await store.addTag(lostPage.id, 'neu')
    // Everything was synced (revisions assigned, queue empty).
    let revision = 0
    await store.acknowledge(
      (await store.pendingOperations()).map((op) => ({
        opId: op.opId,
        status: 'applied' as const,
        revision: ++revision,
        seq: revision,
      })),
    )
    expect(await store.pendingOperationCount()).toBe(0)

    // The restored server only knows the first page.
    const document = (await store.getDocument(kept.id))!
    await store.replaceWithSnapshot(WS, {
      documents: [document],
      blocks: [],
      tags: [],
      documentTags: [],
      attachments: [],
      conflicts: [],
      cursor: 1,
    })

    expect((await store.listDocuments(WS)).map((d) => d.title).sort()).toEqual([
      'Nach dem Backup',
      'Unterseite',
      'Vor dem Backup',
    ])
    // New pages start with an empty block.
    expect((await store.listBlocks(lostChild.id)).map((b) => b.content)).toContain('Nur noch hier')
    expect((await store.tagsForDocument(lostPage.id)).map((t) => t.name)).toEqual(['neu'])
    const queued = await store.pendingOperations(WS)
    expect(queued.every((op) => op.kind === 'create')).toBe(true)
    // Parents before children, tags before their assignments, pages before blocks.
    const order = queued.map((op) => op.entityId)
    expect(order.slice(0, 2)).toEqual([lostPage.id, lostChild.id])
    expect(order[2]).toBe(tag.id)
    expect(order).toContain(block.id)
    expect(queued.at(-1)!.entity).toBe('document_tag')
    // The page kept by the server is not sent again.
    expect(order).not.toContain(kept.id)
    expect(queued.every((op) => op.baseRevision === null)).toBe(true)
    expect((await store.getDocument(lostPage.id))!.revision).toBeNull()
  })
})

/**
 * Paged snapshot like the server's (#97): every page reads the origin's current state, walking
 * the tables in a fixed order and each by id, while the cursor stays the one of the first page.
 */
function pagedSnapshot(limit: number, hooks: { beforePage?: (n: number) => Promise<void> } = {}) {
  let pages = 0
  return async (workspaceId: string, after?: string): Promise<SyncSnapshotResponse> => {
    await hooks.beforePage?.(pages)
    pages++
    const [cursorPart, offsetPart] = (after ?? '').split(':')
    const whole = await server.snapshot()
    const cursor = after ? Number(cursorPart) : whole.cursor
    const byId = <T extends { id: string }>(list: T[]) =>
      [...list].sort((x, y) => (x.id < y.id ? -1 : 1))
    const keys = [
      'documents',
      'tags',
      'documentTags',
      'attachments',
      'blocks',
      'conflicts',
    ] as const
    const flat = keys.flatMap((key) => byId(whole[key] as { id: string }[]).map((e) => [key, e]))
    // Resume after the last id of the previous page (like the server's `after`).
    let start = 0
    if (after) {
      const [key, id] = offsetPart!.split('/')
      start = flat.findIndex(
        ([k, e]) =>
          keys.indexOf(k as never) > keys.indexOf(key as never) ||
          (k === key && (e as { id: string }).id > id!),
      )
      if (start < 0) start = flat.length
    }
    const slice = flat.slice(start, start + limit)
    const page: SyncSnapshotResponse = {
      documents: [],
      blocks: [],
      tags: [],
      documentTags: [],
      attachments: [],
      conflicts: [],
      cursor,
      next: null,
      ...(after ? {} : { total: flat.length }),
    }
    for (const [key, entity] of slice)
      (page[key as (typeof keys)[number]] as unknown[]).push(entity)
    const last = slice.at(-1)
    if (start + limit < flat.length && last) {
      page.next = `${cursor}:${last[0]}/${(last[1] as { id: string }).id}`
    }
    expect(workspaceId).toBe(WS)
    return page
  }
}

describe('paged re-sync (#97)', () => {
  async function workspaceWithBlocks(pages: number, blocks: number) {
    const docs = []
    for (let i = 0; i < pages; i++) {
      const doc = await a.createDocument({ workspaceId: WS, title: `Seite ${i}` })
      for (let j = 1; j < blocks; j++) await a.createBlock(doc.id, { content: `Block ${i}.${j}` })
      docs.push(doc)
    }
    await syncA()
    return docs
  }

  async function sameState(x: LocalStore, y: LocalStore) {
    const state = async (s: LocalStore) => ({
      documents: (await s.db.documents.orderBy('id').toArray()).map(({ id, title, deletedAt }) => ({
        id,
        title,
        deleted: !!deletedAt,
      })),
      blocks: (await s.db.blocks.orderBy('id').toArray()).map(({ id, content, deletedAt }) => ({
        id,
        content,
        deleted: !!deletedAt,
      })),
    })
    expect(await state(x)).toEqual(await state(y))
  }

  it('writes the snapshot page by page, reports progress and stores the cursor at the end', async () => {
    await workspaceWithBlocks(3, 4)
    const progress: { done: number; total: number }[] = []
    const cursors: number[] = []
    const snapshot = pagedSnapshot(5)
    const transport = {
      pull: server.pull,
      snapshot: async (ws: string, after?: string) => {
        cursors.push(await b.syncCursor(WS))
        return snapshot(ws, after)
      },
    }
    expect(await syncWorkspace(b, WS, transport, false, (p) => progress.push(p))).toBe('resync')
    // 3 pages with 4 blocks each = 15 entities in pages of 5.
    expect(progress.map((p) => p.done)).toEqual([0, 5, 10, 15])
    expect(progress.every((p) => p.total === 15)).toBe(true)
    expect(cursors).toEqual([0, 0, 0])
    expect(await b.syncCursor(WS)).toBe(await a.syncCursor(WS))
    expect(await b.pendingOperationCount()).toBe(0)
    await sameState(a, b)
  })

  it('an interrupted re-sync leaves no cursor and is repeated as a whole', async () => {
    const [first] = await workspaceWithBlocks(3, 4)
    await syncWorkspace(b, WS, { pull: server.pull, snapshot: pagedSnapshot(100) })
    // Content changes on the server; b's re-sync breaks off after the first page.
    await a.renameDocument(first!.id, 'Neu')
    await syncA()
    const broken = pagedSnapshot(4, {
      beforePage: async (n) => {
        if (n === 2) throw new TypeError('Failed to fetch')
      },
    })
    await expect(
      syncWorkspace(b, WS, { pull: server.pull, snapshot: broken }, true),
    ).rejects.toThrow('Failed to fetch')
    expect(await b.syncCursor(WS)).toBe(0)

    // Next start: no cursor, so a full re-sync instead of a pull on top of a half state.
    expect(await syncWorkspace(b, WS, { pull: server.pull, snapshot: pagedSnapshot(4) })).toBe(
      'resync',
    )
    expect(await b.syncCursor(WS)).toBe(await a.syncCursor(WS))
    // Nothing from the first attempt is mistaken for content the server lost (#75).
    expect(await b.pendingOperationCount()).toBe(0)
    expect((await b.getDocument(first!.id))!.title).toBe('Neu')
    await sameState(a, b)
  })

  it('entities created or deleted between two pages arrive through the pull', async () => {
    const [first, second] = await workspaceWithBlocks(2, 3)
    let created = ''
    const snapshot = pagedSnapshot(3, {
      beforePage: async (n) => {
        if (n !== 1) return
        // Between page 1 and 2 on another device: a new page, a deleted page, a deleted block.
        created = (await a.createDocument({ workspaceId: WS, title: 'Dazwischen' })).id
        await a.deleteDocument(first!.id)
        const [block] = await a.listBlocks(second!.id)
        await a.deleteBlock(block!.id)
        await syncA()
      },
    })
    expect(await syncWorkspace(b, WS, { pull: server.pull, snapshot })).toBe('resync')
    expect((await b.getDocument(created))!.title).toBe('Dazwischen')
    expect((await b.db.documents.get(first!.id))!.deletedAt).not.toBeNull()
    expect(await b.pendingOperationCount()).toBe(0)
    expect(await b.syncCursor(WS)).toBe(await a.syncCursor(WS))
    await sameState(a, b)
  })

  it('reports the written pages once at the end, or when interrupted (#102)', async () => {
    const docs = await workspaceWithBlocks(3, 4)
    const reports: string[][] = []
    const stop = b.onChange((change) => reports.push(change.documentIds))
    await syncWorkspace(b, WS, { pull: server.pull, snapshot: pagedSnapshot(4) })
    expect(reports).toHaveLength(1)
    expect([...reports[0]!].sort()).toEqual(docs.map((d) => d.id).sort())

    reports.length = 0
    const broken = pagedSnapshot(4, {
      beforePage: async (n) => {
        if (n === 2) throw new TypeError('Failed to fetch')
      },
    })
    await expect(
      syncWorkspace(b, WS, { pull: server.pull, snapshot: broken }, true),
    ).rejects.toThrow()
    expect(reports).toHaveLength(1)
    expect(reports[0]!.length).toBeGreaterThan(0)
    stop()
  })

  it('keeps unsynced local edits across pages', async () => {
    const [doc] = await workspaceWithBlocks(2, 3)
    await syncWorkspace(b, WS, { pull: server.pull, snapshot: pagedSnapshot(100) })
    const [block] = await b.listBlocks(doc!.id)
    await b.updateBlock(block!.id, { content: 'Offline bearbeitet' })
    const local = await b.createDocument({ workspaceId: WS, title: 'Nur lokal' })
    await syncWorkspace(b, WS, { pull: server.pull, snapshot: pagedSnapshot(2) }, true)
    expect((await b.db.blocks.get(block!.id))!.content).toBe('Offline bearbeitet')
    expect((await b.getDocument(local.id))!.title).toBe('Nur lokal')
    expect(await b.pendingOperationCount()).toBeGreaterThan(0)
  })
})
