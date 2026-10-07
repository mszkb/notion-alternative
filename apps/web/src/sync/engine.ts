import { ref } from 'vue'
import { api, uploadAttachment } from '../api'
import { deviceStatus, registerDevice } from '../device'
import type { LocalStore } from '../local/store'
import { connection } from '../session'
import type { PullFetch } from './pull'
import { pushQueue, type PushSend } from './push'
import {
  type DocumentFetch,
  type ResyncProgress,
  type SnapshotFetch,
  syncWorkspace,
} from './resync'

export interface SyncState {
  running: boolean
  lastSyncAt: string | null
  /** Last failure (network, server); cleared by the next successful run. */
  lastError: string | null
  /** Progress of a running full re-sync (#97), null otherwise. */
  resync: ResyncProgress | null
}

export const syncState = ref<SyncState>({
  running: false,
  lastSyncAt: null,
  lastError: null,
  resync: null,
})

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
  /** Required when the device loads content on demand (ADR 0017). */
  document?: DocumentFetch
  upload?: (id: string, data: ArrayBuffer) => Promise<'stored' | 'gone'>
  register?: typeof api.registerDevice
}

const defaultTransport: SyncTransport = {
  push: api.syncPush,
  pull: api.syncPull,
  snapshot: api.syncSnapshot,
  document: api.syncDocument,
  upload: (id, data) => uploadAttachment(id, data),
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
          // Another tab may have moved this device to a new id after it signed in again (#46).
          // Registering takes that id over and the next run sends the queue under it; otherwise
          // the device stays removed.
          if ((await registerDevice(store, transport.register)) === 'registered') {
            again = { full: !!(again?.full || options.full) }
          }
        } else {
          if (transport.upload) await uploadPendingAttachments(store, transport.upload)
          for (const workspace of await store.cachedWorkspaces()) {
            await syncWorkspace(store, workspace.id, transport, options.full, (progress) => {
              syncState.value = { ...syncState.value, resync: progress }
            })
            syncState.value = { ...syncState.value, resync: null }
          }
        }
      })
      failures = 0
      syncState.value = {
        running: false,
        lastSyncAt: new Date().toISOString(),
        lastError: null,
        resync: null,
      }
      // The push badge ("changes waiting") is settled now.
      void (globalThis.navigator as Navigator & { clearAppBadge?: () => Promise<void> })
        ?.clearAppBadge?.()
        .catch(() => undefined)
    } catch (error) {
      failures += 1
      syncState.value = {
        ...syncState.value,
        running: false,
        resync: null,
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

/** Uploads attachment contents whose metadata the server has confirmed (ADR 0012). */
export async function uploadPendingAttachments(
  store: LocalStore,
  upload: NonNullable<SyncTransport['upload']>,
): Promise<number> {
  let uploaded = 0
  for (const attachment of await store.pendingUploads()) {
    const content = await store.attachmentContent(attachment.id)
    if (!content) continue
    await upload(attachment.id, content.data)
    await store.markUploaded(attachment.id)
    uploaded++
  }
  return uploaded
}

/**
 * One sync run at a time across all tabs of this browser profile and account (Web Locks); a tab
 * waits for the other tab's run and then sends what is still queued. Without Web Locks runs may
 * overlap between tabs, which idempotent operations tolerate.
 */
export async function exclusive<T>(store: LocalStore, run: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks
  if (!locks) return run()
  // Per local database, not per device id: that changes when a removed device signs in again.
  return locks.request(`notion-alt-sync:${store.db.name}`, run) as Promise<T>
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
  syncState.value = { running: false, lastSyncAt: null, lastError: null, resync: null }
}
