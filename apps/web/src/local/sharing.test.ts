import 'fake-indexeddb/auto'
import {
  newId,
  type Operation,
  type SyncPushResult,
  type Workspace,
  type WorkspaceRole,
} from '@notion-alt/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ApiError } from '../api'
import { deviceStatus } from '../device'
import { connection } from '../session'
import { requestSync, stopSync, type SyncTransport, workspaceAccessChanged } from '../sync/engine'
import { pushQueue } from '../sync/push'
import { LocalDb } from './db'
import { LocalStore, ReadOnlyWorkspaceError } from './store'

/** Sharing on this device (ADR 0014): roles, read-only mode, revoked access. */

const OWN = '11111111-1111-4111-8111-111111111111'
const SHARED = '22222222-2222-4222-8222-222222222222'
const OWNER = '33333333-3333-4333-8333-333333333333'

const workspace = (
  id: string,
  role?: WorkspaceRole,
  createdAt = '2026-01-01T00:00:00.000Z',
): Workspace => ({
  id,
  name: id === OWN ? 'Privat' : 'Team',
  ownerId: OWNER,
  createdAt,
  ...(role ? { role } : {}),
})

let db: LocalDb
let store: LocalStore

beforeEach(async () => {
  db = new LocalDb(`sharing-${newId()}`)
  store = await LocalStore.open(db)
  await store.db.meta.put({ key: 'offlineMode', value: 'all' })
})
afterEach(async () => {
  stopSync()
  db.close()
  await db.delete()
})

describe('roles of cached workspaces', () => {
  it('refuses changes below editor and keeps nothing of the refused write', async () => {
    const page = await store.createDocument({ workspaceId: SHARED, title: 'Vorher' })
    await store.cacheWorkspaces([
      workspace(OWN, 'owner'),
      workspace(SHARED, 'reader', '2026-02-01T00:00:00.000Z'),
    ])
    const before = await store.pendingOperationCount()

    expect(store.isReadOnly(SHARED)).toBe(true)
    await expect(store.renameDocument(page.id, 'Nachher')).rejects.toBeInstanceOf(
      ReadOnlyWorkspaceError,
    )
    await expect(
      store.createDocument({ workspaceId: SHARED, title: 'Neu' }),
    ).rejects.toBeInstanceOf(ReadOnlyWorkspaceError)
    expect((await store.db.documents.get(page.id))!.title).toBe('Vorher')
    expect(await store.pendingOperationCount()).toBe(before)

    // The own workspace and a role raised again stay writable.
    await store.createDocument({ workspaceId: OWN, title: 'Eigenes' })
    await store.cacheWorkspaces([workspace(OWN, 'owner'), workspace(SHARED, 'editor')])
    expect(store.isReadOnly(SHARED)).toBe(false)
    await store.renameDocument(page.id, 'Nachher')
  })

  it('treats workspaces of servers without roles as the user’s own', async () => {
    await store.cacheWorkspaces([workspace(OWN)])
    expect(store.isReadOnly(OWN)).toBe(false)
  })

  it('applies the last known role after a restart (offline)', async () => {
    await store.cacheWorkspaces([workspace(SHARED, 'commenter')])
    const reopened = await LocalStore.open(db)
    await reopened.cachedWorkspaces()
    expect(reopened.isReadOnly(SHARED)).toBe(true)
  })
})

describe('revoked access', () => {
  it('keeps a workspace the server no longer lists while pages of it remain, read-only', async () => {
    const page = await store.createDocument({ workspaceId: SHARED, title: 'Geteilt' })
    await store.cacheWorkspaces([workspace(OWN, 'owner'), workspace(SHARED, 'editor')])
    await store.cacheWorkspaces([workspace(OWN, 'owner')])

    const cached = await store.cachedWorkspaces()
    expect(cached.map((w) => [w.id, !!w.revoked])).toEqual([
      [OWN, false],
      [SHARED, true],
    ])
    expect(store.isRevoked(SHARED)).toBe(true)
    await expect(store.renameDocument(page.id, 'x')).rejects.toBeInstanceOf(ReadOnlyWorkspaceError)
    // Still readable and exportable.
    expect((await store.exportData(SHARED)).documents.map((d) => d.title)).toEqual(['Geteilt'])
  })

  it('forgets workspaces without anything local, and revoked ones on request', async () => {
    await store.cacheWorkspaces([workspace(OWN, 'owner'), workspace(SHARED, 'editor')])
    await store.cacheWorkspaces([workspace(OWN, 'owner')])
    expect((await store.cachedWorkspaces()).map((w) => w.id)).toEqual([OWN])

    const page = await store.createDocument({ workspaceId: SHARED, title: 'Rest' })
    await store.createBlock(page.id, { content: 'Inhalt' })
    await store.cacheWorkspaces([workspace(OWN, 'owner'), workspace(SHARED, 'editor')])
    await store.markWorkspaceRevoked(SHARED)
    await expect(store.forgetWorkspace(OWN)).rejects.toThrow()

    await store.forgetWorkspace(SHARED)
    expect((await store.cachedWorkspaces()).map((w) => w.id)).toEqual([OWN])
    expect(await store.db.documents.where('workspaceId').equals(SHARED).count()).toBe(0)
    expect(await store.db.blocks.where('documentId').equals(page.id).count()).toBe(0)
    expect(await store.db.operations.where('workspaceId').equals(SHARED).count()).toBe(0)
    expect(store.isRevoked(SHARED)).toBe(false)
  })

  it('does not send the queue of a revoked workspace; it stays queued', async () => {
    await store.createDocument({ workspaceId: OWN, title: 'Eigenes' })
    await store.createDocument({ workspaceId: SHARED, title: 'Geteilt' })
    await store.cacheWorkspaces([workspace(OWN, 'owner'), workspace(SHARED, 'editor')])
    await store.markWorkspaceRevoked(SHARED)
    const sent: Operation[] = []
    await pushQueue(store, async ({ operations }) => {
      sent.push(...operations)
      return {
        results: operations.map((op, i): SyncPushResult => ({
          opId: op.opId,
          status: 'applied',
          revision: 1,
          seq: i + 1,
        })),
      }
    })
    expect(new Set(sent.map((op) => op.workspaceId))).toEqual(new Set([OWN]))
    expect(new Set((await store.pendingOperations()).map((op) => op.workspaceId))).toEqual(
      new Set([SHARED]),
    )
  })

  it('a 404 during sync marks the workspace revoked; the others sync on', async () => {
    connection.value = 'online'
    deviceStatus.value = 'registered'
    await store.cacheWorkspaces([
      workspace(OWN, 'owner'),
      workspace(SHARED, 'reader', '2026-02-01T00:00:00.000Z'),
    ])
    const pulled: string[] = []
    const before = workspaceAccessChanged.value
    const transport: SyncTransport = {
      push: async () => ({ results: [] }),
      pull: async ({ workspaceId, cursor }) => {
        pulled.push(workspaceId)
        if (workspaceId === SHARED) throw new ApiError(404, 'not_found', 'Workspace not found')
        return { changes: [], cursor, hasMore: false }
      },
      snapshot: async (workspaceId) => {
        pulled.push(workspaceId)
        if (workspaceId === SHARED) throw new ApiError(404, 'not_found', 'Workspace not found')
        return {
          documents: [],
          blocks: [],
          tags: [],
          documentTags: [],
          attachments: [],
          conflicts: [],
          cursor: 0,
        }
      },
    }
    await requestSync(store, {}, transport)

    expect(store.isRevoked(SHARED)).toBe(true)
    expect(workspaceAccessChanged.value).toBe(before + 1)
    expect(pulled).toContain(OWN)
    // The next run leaves the revoked workspace out.
    pulled.length = 0
    await requestSync(store, {}, transport)
    expect(pulled).not.toContain(SHARED)
  })
})
