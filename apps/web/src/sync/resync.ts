import type { SyncDocumentResponse, SyncSnapshotResponse } from '@notion-alt/shared'
import { ApiError } from '../api'
import type { LocalStore } from '../local/store'
import { type PullFetch, pullWorkspace } from './pull'

/**
 * One snapshot page; `after` is the previous page's `next` (#97). `content: false` leaves out the
 * blocks (ADR 0017).
 */
export type SnapshotFetch = (
  workspaceId: string,
  after?: string,
  content?: boolean,
) => Promise<SyncSnapshotResponse>

/** One page with its blocks (ADR 0017). */
export type DocumentFetch = (
  workspaceId: string,
  documentId: string,
) => Promise<SyncDocumentResponse>

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
  transport: { pull: PullFetch; snapshot: SnapshotFetch; document?: DocumentFetch },
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
  // On demand (ADR 0017) the snapshot leaves out the blocks: pages new to this device stay
  // unloaded, pages it had loaded are refreshed one by one.
  const content = (await store.offlineMode()) === 'all'
  await resyncWorkspace(store, workspaceId, transport.snapshot, content, onProgress)
  if (!content) {
    const fetchDocument = transport.document
    if (!fetchDocument) throw new Error('Loading content on demand needs a document fetch')
    for (const documentId of await store.loadedDocumentIds(workspaceId)) {
      await loadDocumentContent(store, workspaceId, documentId, fetchDocument)
    }
  }
  // Anything that happened after the snapshot was taken, including what later pages missed.
  await pullWorkspace(store, workspaceId, transport.pull)
  return 'resync'
}

/**
 * Full re-sync page by page (#97): every page is written in its own transaction, the cursor of
 * the first page is stored only after the last one. An interrupted re-sync leaves no cursor, so
 * the next sync starts it again.
 */
async function resyncWorkspace(
  store: LocalStore,
  workspaceId: string,
  fetchPage: SnapshotFetch,
  content: boolean,
  onProgress?: (progress: ResyncProgress) => void,
): Promise<void> {
  let page = await fetchPage(workspaceId, undefined, content)
  const cursor = page.cursor
  const total = page.total ?? count(page)
  const progress = await store.beginResync(workspaceId)
  let done = 0
  onProgress?.({ workspaceId, done, total })
  try {
    for (;;) {
      await store.applySnapshotPage(workspaceId, page, progress, content)
      done += count(page)
      onProgress?.({ workspaceId, done: Math.min(done, total), total })
      if (!page.next) break
      page = await fetchPage(workspaceId, page.next, content)
    }
    await store.finishResync(workspaceId, cursor, progress, content)
  } catch (error) {
    store.reportResync(progress)
    throw error
  }
}

/**
 * Loads (or refreshes) one page's content from the server (ADR 0017). A page the server does not
 * know (404) is left as it is: it was created here and not pushed yet, or its creation is queued
 * again after a restore. The caller holds the sync lock.
 */
export async function loadDocumentContent(
  store: LocalStore,
  workspaceId: string,
  documentId: string,
  fetchDocument: DocumentFetch,
): Promise<boolean> {
  let content: SyncDocumentResponse
  try {
    content = await fetchDocument(workspaceId, documentId)
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return false
    throw error
  }
  await store.applyDocumentContent(workspaceId, content)
  return true
}
