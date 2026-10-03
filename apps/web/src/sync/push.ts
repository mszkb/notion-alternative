import { type Operation, SYNC_PUSH_MAX_OPERATIONS, type SyncPushResult } from '@notion-alt/shared'
import type { QueuedOperation } from '../local/db'
import type { LocalStore } from '../local/store'

/** nginx accepts 1 MiB request bodies; stay below with some headroom. */
export const PUSH_MAX_BYTES = 900_000

export type PushSend = (input: {
  operations: Operation[]
}) => Promise<{ results: SyncPushResult[] }>

export interface PushOutcome {
  confirmed: number
  conflicts: number
  rejected: number
  /** The server no longer accepts this device (removed in the device list). */
  deviceRevoked: boolean
}

const encoder = new TextEncoder()

/** The operation as sent: local bookkeeping (`seq`, `issue`) stays on the device. */
function toWire({ seq: _seq, issue: _issue, ...op }: QueuedOperation): Operation {
  return op
}

/**
 * Sends the offline queue once, oldest first, in batches limited by count and size (ADR 0002).
 * Confirmed operations leave the queue; conflicts and rejections stay queued and marked, so
 * nothing is lost. Throws on network or server errors; resending later is safe (idempotent).
 */
export async function pushQueue(
  store: LocalStore,
  send: PushSend,
  limits = { maxOperations: SYNC_PUSH_MAX_OPERATIONS, maxBytes: PUSH_MAX_BYTES },
): Promise<PushOutcome> {
  const outcome: PushOutcome = { confirmed: 0, conflicts: 0, rejected: 0, deviceRevoked: false }
  let afterSeq = 0
  for (;;) {
    const candidates = await store.queuedOperations(afterSeq, limits.maxOperations)
    if (candidates.length === 0) return outcome
    const batch: Operation[] = []
    let bytes = 0
    for (const queued of candidates) {
      const op = toWire(queued)
      const size = encoder.encode(JSON.stringify(op)).length + 1
      if (batch.length > 0 && bytes + size > limits.maxBytes) break
      batch.push(op)
      bytes += size
      afterSeq = queued.seq!
    }
    const { results } = await send({ operations: batch })
    await store.acknowledge(results)
    for (const result of results) {
      if (
        result.status === 'applied' ||
        result.status === 'duplicate' ||
        result.status === 'merged'
      ) {
        outcome.confirmed++
      } else if (result.status === 'conflict') outcome.conflicts++
      else {
        outcome.rejected++
        if (result.code === 'device_not_active') outcome.deviceRevoked = true
      }
    }
    // A removed device gets every operation rejected: stop instead of sending the rest.
    if (outcome.deviceRevoked) return outcome
  }
}
