import type { FastifyInstance } from 'fastify'
import {
  type SyncPullResponse,
  type SyncPushResult,
  syncPullQuerySchema,
  syncPushInputSchema,
  syncSnapshotQuerySchema,
} from '@notion-alt/shared'
import { currentUser, requireAuth } from '../auth/plugin'
import { touchDevice } from '../devices/repository'
import { HttpError } from '../errors'
import { parseInput } from '../validation'
import { applyOperation } from './apply'
import { listChangesSince } from './changes'
import { toChange } from './mapping'
import { loadSnapshot } from './snapshot'
import { findWorkspaceForUser } from '../workspaces/repository'

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app
  app.addHook('preHandler', requireAuth)

  const pushed = app.metrics.counter(
    'sync_push_operations_total',
    'Operations received via sync push, by result status.',
  )

  /**
   * Applies operations strictly in the given order, each in its own transaction, so a failure
   * in the middle keeps what was applied; resending is safe (`duplicate`, T-OFF-05).
   */
  app.post('/sync/push', async (request) => {
    const { operations } = parseInput(syncPushInputSchema, request.body)
    const user = currentUser(request)
    const now = new Date().toISOString()
    const results: SyncPushResult[] = []
    for (const op of operations) {
      const result = await applyOperation(db, user.id, op, undefined, app.config.attachments)
      pushed.inc({ status: result.status })
      results.push({ opId: op.opId, ...result } as SyncPushResult)
    }
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
    // One extra row tells whether another page follows.
    const rows = (await listChangesSince(db, userId, workspaceId, cursor, limit + 1)) ?? []
    const page = rows.slice(0, limit)
    return {
      changes: page.map(toChange),
      cursor: page.at(-1)?.seq ?? cursor,
      hasMore: rows.length > limit,
    }
  })

  /** Full re-sync: complete workspace including tombstones and the matching cursor. */
  app.get('/sync/snapshot', async (request) => {
    const { workspaceId } = parseInput(syncSnapshotQuerySchema, request.query)
    const snapshot = await loadSnapshot(db, currentUser(request).id, workspaceId)
    if (!snapshot) throw new HttpError(404, 'not_found', 'Workspace not found')
    return snapshot
  })
}
