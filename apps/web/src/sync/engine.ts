import { ref } from 'vue'
import { api } from '../api'
import { deviceStatus } from '../device'
import type { LocalStore } from '../local/store'
import { connection } from '../session'
import type { PullFetch } from './pull'
import { pushQueue, type PushSend } from './push'
import { type SnapshotFetch, syncWorkspace } from './resync'

export interface SyncState {
  running: boolean
  lastSyncAt: string | null
  /** Last failure (network, server); cleared by the next successful run. */
  lastError: string | null
}

export const syncState = ref<SyncState>({ running: false, lastSyncAt: null, lastError: null })

const MAX_BACKOFF_MS = 5 * 60_000

let current: Promise<void> | null = null
let again: SyncOptions | null = null
let failures = 0
let retryTimer: ReturnType<typeof setTimeout> | null = null

export function backoffDelay(failureCount: number): number {
  return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.max(0, failureCount - 1))
}

export interface SyncTransport {
  push: PushSend
  pull: PullFetch
  snapshot: SnapshotFetch
}

const defaultTransport: SyncTransport = {
  push: api.syncPush,
  pull: api.syncPull,
  snapshot: api.syncSnapshot,
}

export interface SyncOptions {
  /** Full re-sync of every workspace from a snapshot (manual "Neu synchronisieren"). */
  full?: boolean
}

/**
 * Runs a sync now (push, then pull for every workspace), or once more right after the running
 * one. Only with a valid session and a registered device; otherwise local work simply continues
 * and the queue grows (T-OFF-04).
 */
export function requestSync(
  store: LocalStore,
  options: SyncOptions = {},
  transport: SyncTransport = defaultTransport,
): Promise<void> {
  if (current) {
    again = { full: !!(again?.full || options.full) }
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
      await exclusive(store, async () => {
        const outcome = await pushQueue(store, transport.push)
        if (outcome.deviceRevoked) {
          deviceStatus.value = 'revoked'
        } else {
          for (const workspace of await store.cachedWorkspaces()) {
            await syncWorkspace(store, workspace.id, transport, options.full)
          }
        }
      })
      failures = 0
      syncState.value = { running: false, lastSyncAt: new Date().toISOString(), lastError: null }
      // The push badge ("changes waiting") is settled now.
      void (globalThis.navigator as Navigator & { clearAppBadge?: () => Promise<void> })
        ?.clearAppBadge?.()
        .catch(() => undefined)
    } catch (error) {
      failures += 1
      syncState.value = {
        ...syncState.value,
        running: false,
        lastError: error instanceof Error ? error.message : String(error),
      }
      // Retry with exponential backoff; triggers (focus, online, timer) may run it earlier.
      retryTimer = setTimeout(
        () => void requestSync(store, options, transport),
        backoffDelay(failures),
      )
    } finally {
      current = null
    }
    if (again) {
      const next = again
      again = null
      await requestSync(store, next, transport)
    }
  })()
  return current
}

/**
 * One sync run at a time across all tabs of this browser profile and account (Web Locks); a tab
 * waits for the other tab's run and then sends what is still queued. Without Web Locks runs may
 * overlap between tabs, which idempotent operations tolerate.
 */
async function exclusive(store: LocalStore, run: () => Promise<void>): Promise<void> {
  const locks = globalThis.navigator?.locks
  if (!locks) return run()
  await locks.request(`notion-alt-sync:${store.deviceId}`, run)
}

/**
 * Entry point for a Web Push hint (Phase 4, ADR 0005): only triggers a normal sync run; the
 * payload carries no content and data integrity never depends on it (principle 4).
 */
export function onSyncHint(store: LocalStore): Promise<void> {
  return requestSync(store)
}

/** Stops pending retries (sign-out, user switch). */
export function stopSync(): void {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  again = null
  failures = 0
  syncState.value = { running: false, lastSyncAt: null, lastError: null }
}
