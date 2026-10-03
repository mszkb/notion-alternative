import type { FastifyInstance } from 'fastify'
import { pushSubscriptionInputSchema, pushUnsubscribeInputSchema } from '@notion-alt/shared'
import { currentUser, requireAuth } from '../auth/plugin'
import { HttpError } from '../errors'
import { parseInput } from '../validation'
import { encryptPushMessage } from './crypto'
import { isAllowedEndpoint, vapidKeys } from './service'

/** More than any person has devices; bounds the fan-out of one change. */
const MAX_SUBSCRIPTIONS_PER_USER = 20

export async function pushRoutes(app: FastifyInstance): Promise<void> {
  const { db, config } = app
  app.addHook('preHandler', requireAuth)

  /** applicationServerKey for PushManager.subscribe(). */
  app.get('/push/public-key', async () => ({ publicKey: (await vapidKeys(db)).publicKey }))

  /** Stores the subscription of the current device (after the user agreed in the app). */
  app.post('/push/subscriptions', async (request, reply) => {
    const input = parseInput(pushSubscriptionInputSchema, request.body)
    const user = currentUser(request)
    if (!request.deviceId) {
      throw new HttpError(409, 'device_not_registered', 'Register the device first')
    }
    if (!isAllowedEndpoint(input.endpoint, config.push.allowedHosts)) {
      throw new HttpError(400, 'endpoint_not_allowed', 'Push service is not allowed')
    }
    // Keys must work for encryption; checked now rather than failing on every later hint.
    try {
      encryptPushMessage(Buffer.from('{}'), input.keys)
    } catch {
      throw new HttpError(400, 'invalid_keys', 'Push subscription keys are invalid')
    }
    const existing = await db
      .selectFrom('push_subscriptions')
      .select('user_id')
      .where('endpoint', '=', input.endpoint)
      .executeTakeFirst()
    // An endpoint belongs to whoever registered it first; it is never moved to another account.
    if (existing && existing.user_id !== user.id) {
      throw new HttpError(409, 'endpoint_taken', 'Subscription belongs to another account')
    }
    if (!existing) {
      const { count } = await db
        .selectFrom('push_subscriptions')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('user_id', '=', user.id)
        .executeTakeFirstOrThrow()
      if (Number(count) >= MAX_SUBSCRIPTIONS_PER_USER) {
        throw new HttpError(409, 'too_many_subscriptions', 'Too many push subscriptions')
      }
    }
    const row = {
      endpoint: input.endpoint,
      user_id: user.id,
      device_id: request.deviceId,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      created_at: new Date().toISOString(),
      last_success_at: null,
      failures: 0,
    }
    await db
      .insertInto('push_subscriptions')
      .values(row)
      .onConflict((oc) =>
        oc.column('endpoint').doUpdateSet({
          device_id: row.device_id,
          p256dh: row.p256dh,
          auth: row.auth,
          failures: 0,
        }),
      )
      .execute()
    return reply.code(204).send()
  })

  app.delete('/push/subscriptions', async (request, reply) => {
    const { endpoint } = parseInput(pushUnsubscribeInputSchema, request.body)
    await db
      .deleteFrom('push_subscriptions')
      .where('endpoint', '=', endpoint)
      .where('user_id', '=', currentUser(request).id)
      .execute()
    return reply.code(204).send()
  })
}
