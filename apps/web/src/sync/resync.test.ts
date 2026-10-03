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
