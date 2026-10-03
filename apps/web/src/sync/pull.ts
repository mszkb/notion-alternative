import { SYNC_PULL_MAX_LIMIT, type SyncPullQuery, type SyncPullResponse } from '@notion-alt/shared'
import type { LocalStore } from '../local/store'

export type PullFetch = (query: SyncPullQuery) => Promise<SyncPullResponse>

/**
 * Pulls the workspace's changes after the local cursor until `hasMore` is false (ADR 0002).
 * Every page is applied together with its cursor, so an interruption repeats at most one page.
 * Returns the number of changes received.
 */
export async function pullWorkspace(
  store: LocalStore,
  workspaceId: string,
  fetchPage: PullFetch,
  limit = SYNC_PULL_MAX_LIMIT,
): Promise<number> {
  let cursor = await store.syncCursor(workspaceId)
  let received = 0
  for (;;) {
    const page = await fetchPage({ workspaceId, cursor, limit })
    await store.applyRemoteChanges(workspaceId, page.changes, page.cursor)
    received += page.changes.length
    cursor = page.cursor
    if (!page.hasMore) return received
  }
}
