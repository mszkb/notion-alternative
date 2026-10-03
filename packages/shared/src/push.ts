import { z } from 'zod'

/** Browser push subscription as sent by the client (PushSubscription.toJSON()). */
export const pushSubscriptionInputSchema = z.object({
  endpoint: z.url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
})
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionInputSchema>

export const pushUnsubscribeInputSchema = z.object({ endpoint: z.url().max(2000) })

/**
 * The only content a push message ever carries (ADR 0005): a hint that changes are waiting.
 * Never page content, titles or user data.
 */
export interface PushHint {
  type: 'sync_available'
  /** Identifies this server installation. */
  installation: string
  workspace: string
}
