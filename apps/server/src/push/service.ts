import { randomUUID } from 'node:crypto'
import type { PushHint } from '@notion-alt/shared'
import type { Config } from '../config'
import type { Db } from '../db/database'
import type { PushSubscriptionsTable } from '../db/schema'
import { encryptPushMessage, generateVapidKeys, type VapidKeys, vapidAuthorization } from './crypto'

/** Reads a server setting, creating it once (concurrent first starts agree on one value). */
async function setting(db: Db, key: string, create: () => string): Promise<string> {
  await db
    .insertInto('settings')
    .values({ key, value: create() })
    .onConflict((oc) => oc.column('key').doNothing())
    .execute()
  return (
    await db.selectFrom('settings').select('value').where('key', '=', key).executeTakeFirstOrThrow()
  ).value
}

/** VAPID key pair of this installation, created on first use (stored in the database backup). */
export async function vapidKeys(db: Db): Promise<VapidKeys> {
  return JSON.parse(await setting(db, 'vapid', () => JSON.stringify(generateVapidKeys())))
}

export async function installationId(db: Db): Promise<string> {
  return setting(db, 'installation_id', () => randomUUID())
}

/** Only https endpoints of known push services (the URL comes from the client). */
export function isAllowedEndpoint(endpoint: string, allowedHosts: string[]): boolean {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false
  const host = url.hostname.toLowerCase()
  return allowedHosts.some((allowed) =>
    allowed.startsWith('*.') ? host.endsWith(allowed.slice(1)) : host === allowed,
  )
}

export type SendResult = 'ok' | 'gone' | 'failed'

/** Sends one encrypted, content-free hint (RFC 8030/8291/8292). */
export async function sendPush(
  subscription: Pick<PushSubscriptionsTable, 'endpoint' | 'p256dh' | 'auth'>,
  hint: PushHint,
  keys: VapidKeys,
  subject: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  try {
    // Inside the try: keys that are not a valid curve point must not crash the process.
    const body = encryptPushMessage(Buffer.from(JSON.stringify(hint)), subscription)
    const response = await fetchImpl(subscription.endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidAuthorization(subscription.endpoint, keys, subject),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(24 * 60 * 60),
        Urgency: 'normal',
        // One pending hint per workspace is enough; newer ones replace older ones.
        Topic: hint.workspace.replace(/-/g, '').slice(0, 32),
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    if (response.status === 404 || response.status === 410) return 'gone'
    return response.ok ? 'ok' : 'failed'
  } catch {
    return 'failed'
  }
}

/** Subscriptions that keep failing are dropped; the device can subscribe again. */
const MAX_FAILURES = 5

export interface PushNotifierOptions {
  /** Bundles changes arriving in quick succession into one hint per device. */
  delayMs?: number
  fetchImpl?: typeof fetch
}

/**
 * Sends "changes waiting" hints to the other devices of a workspace's owner after operations
 * were applied. Data integrity never depends on it (principle 4): sync runs anyway.
 */
export class PushNotifier {
  /** endpoint → workspace with pending hint */
  private readonly pending = new Map<string, string>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private flushing: Promise<void> = Promise.resolve()

  constructor(
    private readonly db: Db,
    private readonly config: Config['push'],
    private readonly options: PushNotifierOptions = {},
  ) {}

  /** Changes in `workspaceId` from `originDeviceId`: hint every other device of the owner. */
  async notify(workspaceId: string, originDeviceId: string): Promise<void> {
    const subscriptions = await this.db
      .selectFrom('push_subscriptions')
      .innerJoin('workspaces', 'workspaces.owner_id', 'push_subscriptions.user_id')
      .select('push_subscriptions.endpoint')
      .where('workspaces.id', '=', workspaceId)
      .where('push_subscriptions.device_id', '!=', originDeviceId)
      .execute()
    for (const { endpoint } of subscriptions) this.pending.set(endpoint, workspaceId)
    if (this.pending.size > 0 && !this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null
        this.flushing = this.flush().catch(() => {
          // Hints are best effort (principle 4); a failure must never take the server down.
        })
      }, this.options.delayMs ?? 2000)
    }
  }

  /** Waits for scheduled hints (tests, shutdown). */
  async settle(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
      this.flushing = this.flush()
    }
    await this.flushing
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pending.clear()
  }

  private async flush(): Promise<void> {
    const batch = [...this.pending]
    this.pending.clear()
    if (batch.length === 0) return
    const keys = await vapidKeys(this.db)
    const installation = await installationId(this.db)
    for (const [endpoint, workspace] of batch) {
      const subscription = await this.db
        .selectFrom('push_subscriptions')
        .selectAll()
        .where('endpoint', '=', endpoint)
        .executeTakeFirst()
      if (!subscription || !isAllowedEndpoint(endpoint, this.config.allowedHosts)) continue
      const hint: PushHint = { type: 'sync_available', installation, workspace }
      const result = await sendPush(
        subscription,
        hint,
        keys,
        this.config.subject,
        this.options.fetchImpl,
      )
      const query = this.db.updateTable('push_subscriptions').where('endpoint', '=', endpoint)
      if (result === 'ok') {
        await query.set({ last_success_at: new Date().toISOString(), failures: 0 }).execute()
      } else if (result === 'gone' || subscription.failures + 1 >= MAX_FAILURES) {
        await this.db.deleteFrom('push_subscriptions').where('endpoint', '=', endpoint).execute()
      } else {
        await query.set({ failures: subscription.failures + 1 }).execute()
      }
    }
  }
}
