import { ApiError, api } from '../api'
import type { LocalStore } from '../local/store'
import { connection } from '../session'
import { exclusive } from './engine'
import { SYNC_DOCUMENTS_MAX } from '@notion-alt/shared'
import {
  batchOf,
  type DocumentFetch,
  type DocumentsFetch,
  loadDocumentContent,
  loadDocumentsContent,
} from './resync'

export type OpenOutcome = 'loaded' | 'offline' | 'missing'

/** Network gone (fetch rejects with a TypeError) or server down behind the proxy (5xx). */
function unreachable(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof ApiError && error.status >= 500)
}

/**
 * Makes sure a page's content is on this device before it is shown (ADR 0017): loads it from
 * the server if it is not. `offline` when the server cannot be reached; the page then shows a
 * notice instead of an empty, editable page.
 */
export async function ensureDocumentLoaded(
  store: LocalStore,
  workspaceId: string,
  documentId: string,
  fetchDocument: DocumentFetch = api.syncDocument,
): Promise<OpenOutcome> {
  if (await store.isDocumentLoaded(documentId)) return 'loaded'
  if (connection.value !== 'online') return 'offline'
  try {
    // Under the sync lock: a pull never runs between loading and writing the page.
    const loaded = await exclusive(store, async () =>
      (await store.isDocumentLoaded(documentId))
        ? true
        : loadDocumentContent(store, workspaceId, documentId, fetchDocument),
    )
    return loaded ? 'loaded' : 'missing'
  } catch (error) {
    if (unreachable(error)) return 'offline'
    throw error
  }
}

export interface MakeOfflineProgress {
  /** Pages loaded so far and in total (the total grows if pages arrive meanwhile). */
  done: number
  total: number
}

export interface MakeOfflineResult {
  loaded: number
  /** Pages the server does not have (yet); they stay unloaded and are tried again next time. */
  unavailable: number
  /** Stopped early: cancelled or connection lost. What was loaded stays loaded. */
  stopped: 'cancelled' | 'offline' | null
}

/**
 * "Alles offline verfügbar machen" (ADR 0017), pages part: loads every page this device has not
 * loaded, up to SYNC_DOCUMENTS_MAX per request, each batch under the sync lock (a pull never runs
 * between fetching and writing), so normal syncs keep running in between. Cancelling or losing
 * the connection stops it; a new run continues with what is still missing. Only a complete run
 * switches the device to "all"; pages the server does not know keep it "on demand".
 */
export async function loadAllDocuments(
  store: LocalStore,
  options: {
    fetchDocuments?: DocumentsFetch
    /** Single-page fetch instead of the batch (tests). */
    fetchDocument?: DocumentFetch
    onProgress?: (progress: MakeOfflineProgress) => void
    signal?: AbortSignal
    /** Pages per request; smaller only in tests. */
    batchSize?: number
  } = {},
): Promise<MakeOfflineResult> {
  const batchSize = options.batchSize ?? SYNC_DOCUMENTS_MAX
  const fetchDocuments =
    options.fetchDocuments ??
    (options.fetchDocument ? batchOf(options.fetchDocument) : api.syncDocuments)
  const result: MakeOfflineResult = { loaded: 0, unavailable: 0, stopped: null }
  const unavailable = new Set<string>()
  let done = 0
  for (;;) {
    const missing = (await store.unloadedDocuments()).filter((d) => !unavailable.has(d.id))
    const total = done + missing.length
    options.onProgress?.({ done, total })
    if (missing.length === 0) {
      if (unavailable.size === 0) await store.completeOfflineMode()
      // Pages may have arrived meanwhile: completeOfflineMode refuses then, go round again.
      if (unavailable.size > 0 || (await store.offlineMode()) === 'all') return result
      continue
    }
    const byWorkspace = new Map<string, string[]>()
    for (const page of missing) {
      byWorkspace.set(page.workspaceId, [...(byWorkspace.get(page.workspaceId) ?? []), page.id])
    }
    for (const [workspaceId, ids] of byWorkspace) {
      for (let i = 0; i < ids.length; i += batchSize) {
        if (options.signal?.aborted) return { ...result, stopped: 'cancelled' }
        const batch = ids.slice(i, i + batchSize)
        try {
          const absent = await exclusive(store, () =>
            loadDocumentsContent(store, workspaceId, batch, fetchDocuments),
          )
          for (const id of absent) unavailable.add(id)
          result.unavailable += absent.length
          result.loaded += batch.length - absent.length
        } catch (error) {
          if (unreachable(error)) return { ...result, stopped: 'offline' }
          throw error
        }
        done += batch.length
        options.onProgress?.({ done, total })
      }
    }
  }
}
