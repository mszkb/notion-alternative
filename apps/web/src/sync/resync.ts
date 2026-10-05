import type { SyncSnapshotResponse } from '@notion-alt/shared'
import { ApiError } from '../api'
import type { LocalStore } from '../local/store'
import { type PullFetch, pullWorkspace } from './pull'

/** One snapshot page; `after` is the previous page's `next` (#97). */
export type SnapshotFetch = (workspaceId: string, after?: string) => Promise<SyncSnapshotResponse>

export interface ResyncProgress {
  workspaceId: string
  /** Entities written so far and in the whole snapshot. */
  done: number
  total: number
}

const count = (page: SyncSnapshotResponse) =>
  page.documents.length +
  page.blocks.length +
  page.tags.length +
  page.documentTags.length +
  page.attachments.length +
  page.conflicts.length

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
  onProgress?: (progress: ResyncProgress) => void,
): Promise<'pull' | 'resync'> {
  if (!full && (await store.syncCursor(workspaceId)) > 0) {
    try {
      await pullWorkspace(store, workspaceId, transport.pull)
      return 'pull'
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 410)) throw error
    }
  }
  await resyncWorkspace(store, workspaceId, transport.snapshot, onProgress)
  // Anything that happened after the snapshot was taken, including what later pages missed.
  await pullWorkspace(store, workspaceId, transport.pull)
  return 'resync'
}

/**
 * Full re-sync page by page (#97): every page is written in its own transaction, the cursor of
 * the first page is stored only after the last one. The next page is fetched during the write. An interrupted re-sync leaves no cursor, so
 * the next sync starts it again.
 */
async function resyncWorkspace(
  store: LocalStore,
  workspaceId: string,
  fetchPage: SnapshotFetch,
  onProgress?: (progress: ResyncProgress) => void,
): Promise<void> {
  let page = await fetchPage(workspaceId)
  const cursor = page.cursor
  const total = page.total ?? count(page)
  const progress = await store.beginResync(workspaceId)
  let done = 0
  onProgress?.({ workspaceId, done, total })
  try {
    for (;;) {
      // Fetch the next page while this one is written (#102): network and server time overlap
      // with IndexedDB instead of adding up over hundreds of pages.
      const next = page.next ? fetchPage(workspaceId, page.next) : null
      // A failed fetch is rethrown below; if the write fails first, it must not go unhandled.
      next?.catch(() => undefined)
      await store.applySnapshotPage(workspaceId, page, progress)
      done += count(page)
      onProgress?.({ workspaceId, done: Math.min(done, total), total })
      if (!next) break
      page = await next
    }
    await store.finishResync(workspaceId, cursor, progress)
  } catch (error) {
    store.reportResync(progress)
    throw error
  }
}
