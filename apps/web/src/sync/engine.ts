import { ref } from 'vue'
import { api } from '../api'
import { deviceStatus } from '../device'
import type { LocalStore } from '../local/store'
import { connection } from '../session'
import { pushQueue, type PushSend } from './push'

export interface SyncState {
  running: boolean
  lastSyncAt: string | null
  /** Last failure (network, server); cleared by the next successful run. */
  lastError: string | null
}

export const syncState = ref<SyncState>({ running: false, lastSyncAt: null, lastError: null })

const MAX_BACKOFF_MS = 5 * 60_000

let current: Promise<void> | null = null
let again = false
let failures = 0
let retryTimer: ReturnType<typeof setTimeout> | null = null

export function backoffDelay(failureCount: number): number {
  return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.max(0, failureCount - 1))
}

/**
 * Runs a sync now, or once more right after the running one. Only with a valid session and a
 * registered device; otherwise local work simply continues and the queue grows (T-OFF-04).
 */
export function requestSync(store: LocalStore, send: PushSend = api.syncPush): Promise<void> {
  if (current) {
    again = true
    return current
  }
  if (connection.value !== 'online' || deviceStatus.value !== 'registered') {
    return Promise.resolve()
  }
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  syncState.value = { ...syncState.value, running: true }
  current = (async () => {
    try {
      const outcome = await pushQueue(store, send)
      if (outcome.deviceRevoked) deviceStatus.value = 'revoked'
      failures = 0
      syncState.value = { running: false, lastSyncAt: new Date().toISOString(), lastError: null }
    } catch (error) {
      failures += 1
      syncState.value = {
        ...syncState.value,
        running: false,
        lastError: error instanceof Error ? error.message : String(error),
      }
      // Retry with exponential backoff; triggers (focus, online, timer) may run it earlier.
      retryTimer = setTimeout(() => void requestSync(store, send), backoffDelay(failures))
    } finally {
      current = null
    }
    if (again) {
      again = false
      await requestSync(store, send)
    }
  })()
  return current
}

/** Stops pending retries (sign-out, user switch). */
export function stopSync(): void {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  again = false
  failures = 0
  syncState.value = { running: false, lastSyncAt: null, lastError: null }
}
