import 'fake-indexeddb/auto'
import {
  type Change,
  newId,
  type Operation,
  type SyncPullQuery,
  type SyncPushResult,
} from '@notion-alt/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LocalDb } from '../local/db'
import { LocalStore, type StoreChange } from '../local/store'
import { pullWorkspace } from './pull'
import { pushQueue } from './push'

const WS = '11111111-1111-4111-8111-111111111111'

/** In-memory change log with the server's numbering (no conflict detection). */
function fakeServer() {
  const log: Change[] = []
  const revisions = new Map<string, number>()
  const seen = new Map<string, SyncPushResult>()
  return {
    log,
    push: async ({ operations }: { operations: Operation[] }) => ({
      results: operations.map((op): SyncPushResult => {
        const known = seen.get(op.opId)
        if (known) return { ...known, status: 'duplicate' } as SyncPushResult
        const revision = (revisions.get(op.entityId) ?? 0) + 1
        revisions.set(op.entityId, revision)
        const change: Change = {
          seq: log.length + 1,
          opId: op.opId,
          deviceId: op.deviceId,
          entity: op.entity,
          entityId: op.entityId,
          kind: op.kind,
          revision,
          payload: op.payload,
          appliedAt: new Date(Date.UTC(2026, 1, 1, 0, 0, log.length)).toISOString(),
        }
        log.push(change)
        const result: SyncPushResult = {
          opId: op.opId,
          status: 'applied',
          revision,
          seq: change.seq,
        }
        seen.set(op.opId, result)
        return result
      }),
    }),
    pull: async ({ cursor, limit }: SyncPullQuery) => {
      const rest = log.filter((c) => c.seq > cursor)
      const page = rest.slice(0, limit)
      return { changes: page, cursor: page.at(-1)?.seq ?? cursor, hasMore: rest.length > limit }
    },
  }
}

let dbs: LocalDb[] = []
async function device(): Promise<LocalStore> {
  const db = new LocalDb(`pull-${newId()}`)
  dbs.push(db)
  return LocalStore.open(db)
}

let server: ReturnType<typeof fakeServer>
let a: LocalStore
let b: LocalStore

beforeEach(async () => {
  server = fakeServer()
  a = await device()
  b = await device()
})
afterEach(async () => {
  for (const db of dbs) {
    db.close()
    await db.delete()
  }
  dbs = []
})

const sync = async (store: LocalStore) => {
  await pushQueue(store, server.push)
  await pullWorkspace(store, WS, server.pull)
}

describe('pullWorkspace', () => {
  it('T-MD-01: B sees what A changed, without queueing anything itself', async () => {
    const doc = await a.createDocument({ workspaceId: WS, title: 'Von A' })
    const [first] = await a.listBlocks(doc.id)
    await a.updateBlock(first!.id, { content: 'Hallo **B**', type: 'heading', attrs: { level: 1 } })
    await a.createBlock(doc.id, { content: 'zweiter' })
    await a.setFavorite(doc.id, true)
    await sync(a)

    const changes: StoreChange[] = []
    b.onChange((change) => changes.push(change))
    await sync(b)

    const pulled = await b.getDocument(doc.id)
    expect(pulled).toMatchObject({ title: 'Von A', favorite: true, workspaceId: WS, revision: 2 })
    const blocks = await b.listBlocks(doc.id)
    expect(blocks.map((x) => x.content)).toEqual(['Hallo **B**', 'zweiter'])
    expect(blocks[0]).toMatchObject({ type: 'heading', attrs: { level: 1 }, revision: 2 })
    expect(await b.pendingOperationCount()).toBe(0)
    expect(await b.syncCursor(WS)).toBe(server.log.length)
    // Search and backlinks hear about the pulled documents.
    expect(changes.flatMap((c) => c.documentIds)).toContain(doc.id)
  })

  it('confirms own changes when the push response was lost', async () => {
    const doc = await a.createDocument({ workspaceId: WS, title: 'A' })
    await server.push({ operations: await a.pendingOperations() }) // answer never arrived
    expect(await a.pendingOperationCount()).toBe(2)
    await pullWorkspace(a, WS, server.pull)
    expect(await a.pendingOperationCount()).toBe(0)
    expect((await a.getDocument(doc.id))!.revision).toBe(1)
  })

  it('does not overwrite an entity with unsynced local changes', async () => {
    const doc = await a.createDocument({ workspaceId: WS, title: 'Gemeinsam' })
    await sync(a)
    await sync(b)
    const [blockOnB] = await b.listBlocks(doc.id)
    await b.updateBlock(blockOnB!.id, { content: 'B offline' })

    const [blockOnA] = await a.listBlocks(doc.id)
    await a.updateBlock(blockOnA!.id, { content: 'A online' })
    await a.renameDocument(doc.id, 'Umbenannt von A')
    await sync(a)

    await pullWorkspace(b, WS, server.pull)
    expect((await b.listBlocks(doc.id))[0]!.content).toBe('B offline')
    expect(await b.pendingOperationCount()).toBe(1)
    // Other entities still arrive.
    expect((await b.getDocument(doc.id))!.title).toBe('Umbenannt von A')
  })

  it('pages with hasMore and keeps the cursor consistent after an interruption', async () => {
    for (const title of ['1', '2', '3']) await a.createDocument({ workspaceId: WS, title })
    await sync(a)
    let calls = 0
    const flaky = async (query: SyncPullQuery) => {
      if (++calls === 3) throw new TypeError('network down')
      return server.pull(query)
    }
    await expect(pullWorkspace(b, WS, flaky, 2)).rejects.toThrow('network down')
    expect(await b.syncCursor(WS)).toBe(4)
    expect((await b.listDocuments(WS)).length).toBe(2)

    expect(await pullWorkspace(b, WS, server.pull, 2)).toBe(2)
    expect(await b.syncCursor(WS)).toBe(6)
    expect((await b.listDocuments(WS)).map((d) => d.title).sort()).toEqual(['1', '2', '3'])
  })

  it('T-DEL-01: tombstones replicate, also for a subtree, tags and backlinks', async () => {
    const parent = await a.createDocument({ workspaceId: WS, title: 'Eltern' })
    const child = await a.createDocument({ workspaceId: WS, title: 'Kind', parentId: parent.id })
    const target = await a.createDocument({ workspaceId: WS, title: 'Ziel' })
    const [block] = await a.listBlocks(child.id)
    await a.updateBlock(block!.id, { content: `[Ziel](page:${target.id})` })
    const tag = await a.addTag(parent.id, 'Projekt')
    await sync(a)
    await sync(b)
    expect((await b.backlinks(target.id)).map((d) => d.id)).toEqual([child.id])
    expect((await b.tagsForDocument(parent.id)).map((t) => t.id)).toEqual([tag.id])

    await a.removeTag(parent.id, tag.id)
    await a.deleteDocument(parent.id)
    await sync(a)
    await sync(b)
    expect((await b.listDocuments(WS)).map((d) => d.title)).toEqual(['Ziel'])
    expect((await b.getDocument(child.id))?.deletedAt ?? 'gone').not.toBeNull()
    expect(await b.backlinks(target.id)).toEqual([])
    expect(await b.tagsForDocument(parent.id)).toEqual([])
  })

  it('T-DEL-02: a page deleted elsewhere stays while it has unsynced local edits', async () => {
    const doc = await a.createDocument({ workspaceId: WS, title: 'Strittig' })
    await sync(a)
    await sync(b)
    const [blockOnB] = await b.listBlocks(doc.id)
    await b.updateBlock(blockOnB!.id, { content: 'B schreibt offline' })

    await a.deleteDocument(doc.id)
    await sync(a)
    await pullWorkspace(b, WS, server.pull)

    expect((await b.getDocument(doc.id))?.deletedAt).toBeNull()
    expect((await b.listBlocks(doc.id))[0]!.content).toBe('B schreibt offline')
    expect(await b.pendingOperationCount()).toBe(1)
  })
})
