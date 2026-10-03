import type { SyncSnapshotResponse } from '@notion-alt/shared'
import { ApiError } from '../api'
import type { LocalStore } from '../local/store'
import { type PullFetch, pullWorkspace } from './pull'

export type SnapshotFetch = (workspaceId: string) => Promise<SyncSnapshotResponse>

/**
 * Brings one workspace up to date (after the queue was pushed): delta pull from the cursor, or a
 * full re-sync from a snapshot when this device never synced it (new device), the server's log
 * no longer reaches back to the cursor (410), or the user asked for it (ADR 0002, T-MD-05).
 */
export async function syncWorkspace(
  store: LocalStore,
  workspaceId: string,
  transport: { pull: PullFetch; snapshot: SnapshotFetch },
  full = false,
): Promise<'pull' | 'resync'> {
  if (!full && (await store.syncCursor(workspaceId)) > 0) {
    try {
      await pullWorkspace(store, workspaceId, transport.pull)
      return 'pull'
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 410)) throw error
    }
  }
  await store.replaceWithSnapshot(workspaceId, await transport.snapshot(workspaceId))
  // Anything that happened after the snapshot was taken.
  await pullWorkspace(store, workspaceId, transport.pull)
  return 'resync'
}
