import { z } from 'zod'

/** Browser push subscription as sent by the client (PushSubscription.toJSON()). */
export const pushSubscriptionInputSchema = z.object({
  endpoint: z.url().max(2000),
  keys: z.object({
    // Base64url (RFC 8291): an uncompressed P-256 point (65 bytes, first byte 0x04 → "B") and a
    // 16-byte auth secret. Anything else could not be encrypted for later.
    p256dh: z.string().regex(/^B[A-Za-z0-9_-]{86}=?$/, 'expected a P-256 public key'),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}(==)?$/, 'expected a 16-byte secret'),
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
