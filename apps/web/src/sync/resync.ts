import {
  SYNC_DOCUMENTS_MAX,
  type SyncDocumentResponse,
  type SyncDocumentsResponse,
  type SyncSnapshotResponse,
} from '@notion-alt/shared'
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

/** Several pages with their blocks; unknown ids are left out (ADR 0017). */
export type DocumentsFetch = (workspaceId: string, ids: string[]) => Promise<SyncDocumentsResponse>

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
  transport: {
    pull: PullFetch
    snapshot: SnapshotFetch
    document?: DocumentFetch
    documents?: DocumentsFetch
  },
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
    const fetchDocuments = transport.documents ?? batchOf(transport.document)
    const ids: string[] = []
    for (const documentId of await store.loadedDocumentIds(workspaceId)) {
      // Never synced (created here, still queued): the server has nothing to load yet. Pages in
      // the trash are not refreshed; restoring one reloads it when it is opened.
      const page = await store.db.documents.get(documentId)
      if (page?.revision != null && !page.deletedAt) ids.push(documentId)
    }
    await loadDocumentsContent(store, workspaceId, ids, fetchDocuments)
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

/** Fetches several pages one by one where no batch fetch is available (tests, older servers). */
export function batchOf(fetchDocument: DocumentFetch | undefined): DocumentsFetch {
  if (!fetchDocument) {
    return () => Promise.reject(new Error('Loading content on demand needs a document fetch'))
  }
  return async (workspaceId, ids) => {
    const pages: SyncDocumentsResponse['pages'] = []
    let seq = 0
    for (const id of ids) {
      try {
        const page = await fetchDocument(workspaceId, id)
        pages.push({ document: page.document, blocks: page.blocks })
        seq = Math.max(seq, page.seq)
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) throw error
      }
    }
    return { pages, seq }
  }
}

/**
 * Loads (or refreshes) pages in batches of SYNC_DOCUMENTS_MAX, each written in its own
 * transaction. Returns the ids the server did not have. The caller holds the sync lock.
 */
export async function loadDocumentsContent(
  store: LocalStore,
  workspaceId: string,
  ids: string[],
  fetchDocuments: DocumentsFetch,
  onLoaded?: (count: number) => void,
): Promise<string[]> {
  const missing: string[] = []
  for (let i = 0; i < ids.length; i += SYNC_DOCUMENTS_MAX) {
    const batch = ids.slice(i, i + SYNC_DOCUMENTS_MAX)
    const { pages, seq } = await fetchDocuments(workspaceId, batch)
    const served = new Set(pages.map((page) => page.document.id))
    for (const page of pages) {
      await store.applyDocumentContent(workspaceId, { ...page, seq })
    }
    missing.push(...batch.filter((id) => !served.has(id)))
    onLoaded?.(batch.length)
  }
  return missing
}
