import type { FastifyInstance } from 'fastify'
import {
  type SyncLogResponse,
  type SyncPullResponse,
  type SyncPushResult,
  syncLogQuerySchema,
  syncPullQuerySchema,
  syncPushInputSchema,
  syncSnapshotQuerySchema,
} from '@notion-alt/shared'
import { currentUser, requireAuth } from '../auth/plugin'
import { touchDevice } from '../devices/repository'
import { HttpError } from '../errors'
import { parseInput } from '../validation'
import { applyBatch } from './apply'
import { latestSeq, listChangesSince } from './changes'
import { toChange } from './mapping'
import { loadSnapshot, loadSnapshotPage } from './snapshot'
import { findWorkspaceForUser } from '../workspaces/repository'
import { reindexMarked } from '../search/index'

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app
  app.addHook('preHandler', requireAuth)

  const pushed = app.metrics.counter(
    'sync_push_operations_total',
    'Operations received via sync push, by result status.',
  )

  /**
   * Applies operations strictly in the given order, one transaction per batch with a savepoint
   * per operation (#95), so a failure in the middle keeps what was applied; resending is safe
   * (`duplicate`, T-OFF-05).
   */
  app.post('/sync/push', async (request) => {
    const { operations } = parseInput(syncPushInputSchema, request.body)
    const user = currentUser(request)
    const now = new Date().toISOString()
    const applied = await applyBatch(db, user.id, operations, now, app.config.attachments)
    const results = applied.map((result, i) => {
      pushed.inc({ status: result.status })
      return { opId: operations[i]!.opId, ...result } as SyncPushResult
    })
    // Search entries of the changed pages, once per page instead of per operation (#99).
    await reindexMarked(db)
    for (const deviceId of new Set(operations.map((op) => op.deviceId))) {
      await touchDevice(db, user.id, deviceId, now)
    }
    // Tell the owner's other devices that changes are waiting (a hint only, ADR 0005).
    const changed = new Map<string, string>()
    operations.forEach((op, i) => {
      if (['applied', 'merged', 'conflict'].includes(results[i]!.status)) {
        changed.set(op.workspaceId, op.deviceId)
      }
    })
    for (const [workspaceId, deviceId] of changed) {
      await app.pushNotifier.notify(workspaceId, deviceId)
    }
    return { results }
  })

  /** Delta sync: changes after the cursor, in `seq` order, page by page (ADR 0002). */
  app.get('/sync/pull', async (request): Promise<SyncPullResponse> => {
    const { workspaceId, cursor, limit } = parseInput(syncPullQuerySchema, request.query)
    const userId = currentUser(request).id
    const workspace = await findWorkspaceForUser(db, workspaceId, userId)
    if (!workspace) throw new HttpError(404, 'not_found', 'Workspace not found')
    if (cursor < workspace.compacted_seq) {
      // Changes after the cursor are gone: the client needs a full re-sync (snapshot).
      throw new HttpError(410, 'cursor_expired', 'Cursor is older than the change log')
    }
    if (cursor > (await latestSeq(db, workspaceId, workspace.compacted_seq))) {
      // The client saw changes this server does not have (restored from an older backup):
      // its state must be rebuilt from a snapshot, re-sending what the server lost.
      throw new HttpError(410, 'cursor_ahead', 'Cursor is ahead of the change log')
    }
    // One extra row tells whether another page follows.
    const rows = (await listChangesSince(db, userId, workspaceId, cursor, limit + 1)) ?? []
    const page = rows.slice(0, limit)
    return {
      changes: page.map(toChange),
      cursor: page.at(-1)?.seq ?? cursor,
      hasMore: rows.length > limit,
    }
  })

  /**
   * Change log for the JSON export (ADR 0004): like pull, but starts at the oldest change still
   * kept instead of answering `410` after compaction.
   */
  app.get('/sync/log', async (request): Promise<SyncLogResponse> => {
    const { workspaceId, cursor, limit } = parseInput(syncLogQuerySchema, request.query)
    const userId = currentUser(request).id
    const workspace = await findWorkspaceForUser(db, workspaceId, userId)
    if (!workspace) throw new HttpError(404, 'not_found', 'Workspace not found')
    const rows = (await listChangesSince(db, userId, workspaceId, cursor, limit + 1)) ?? []
    const page = rows.slice(0, limit)
    return {
      changes: page.map(toChange),
      cursor: page.at(-1)?.seq ?? cursor,
      hasMore: rows.length > limit,
      compactedSeq: workspace.compacted_seq,
    }
  })

  /** Full re-sync: complete workspace including tombstones and the matching cursor. */
  app.get('/sync/snapshot', async (request) => {
    const { workspaceId, limit, after } = parseInput(syncSnapshotQuerySchema, request.query)
    const userId = currentUser(request).id
    // Paged (#97) unless an older client asks for everything at once.
    const snapshot =
      limit === undefined
        ? await loadSnapshot(db, userId, workspaceId)
        : await loadSnapshotPage(db, userId, workspaceId, limit, after)
    if (!snapshot) throw new HttpError(404, 'not_found', 'Workspace not found')
    return snapshot
  })
}
