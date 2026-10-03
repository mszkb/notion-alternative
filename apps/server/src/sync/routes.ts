import type { FastifyInstance } from 'fastify'
import { type SyncPushResult, syncPushInputSchema } from '@notion-alt/shared'
import { currentUser, requireAuth } from '../auth/plugin'
import { touchDevice } from '../devices/repository'
import { parseInput } from '../validation'
import { applyOperation } from './apply'

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
      const result = await applyOperation(db, user.id, op)
      pushed.inc({ status: result.status })
      results.push({ opId: op.opId, ...result } as SyncPushResult)
    }
    for (const deviceId of new Set(operations.map((op) => op.deviceId))) {
      await touchDevice(db, user.id, deviceId, now)
    }
    return { results }
  })
}
