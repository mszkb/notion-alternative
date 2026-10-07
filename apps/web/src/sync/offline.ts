import { ApiError, api } from '../api'
import type { LocalStore } from '../local/store'
import { connection } from '../session'
import { exclusive } from './engine'
import { type DocumentFetch, loadDocumentContent } from './resync'

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
  /** Stopped early: cancelled or connection lost. What was loaded stays loaded. */
  stopped: 'cancelled' | 'offline' | null
}

/**
 * "Alles offline verfügbar machen" (ADR 0017), pages part: loads every page this device has not
 * loaded, a few at a time, each under the sync lock so normal syncs keep running in between.
 * Cancelling or losing the connection stops it; a new run continues with what is still missing.
 * Only a complete run switches the device to "all".
 */
export async function loadAllDocuments(
  store: LocalStore,
  options: {
    fetchDocument?: DocumentFetch
    onProgress?: (progress: MakeOfflineProgress) => void
    signal?: AbortSignal
    concurrency?: number
  } = {},
): Promise<MakeOfflineResult> {
  const fetchDocument = options.fetchDocument ?? api.syncDocument
  const concurrency = options.concurrency ?? 4
  const result: MakeOfflineResult = { loaded: 0, stopped: null }
  let done = 0
  let total = 0
  for (;;) {
    const missing = await store.unloadedDocuments()
    total = done + missing.length
    options.onProgress?.({ done, total })
    if (missing.length === 0 && (await store.completeOfflineMode())) return result
    let next = 0
    const worker = async () => {
      while (next < missing.length && !result.stopped) {
        if (options.signal?.aborted) {
          result.stopped = 'cancelled'
          return
        }
        const page = missing[next++]!
        try {
          await exclusive(store, () =>
            loadDocumentContent(store, page.workspaceId, page.id, fetchDocument),
          )
        } catch (error) {
          if (unreachable(error)) {
            result.stopped = 'offline'
            return
          }
          throw error
        }
        result.loaded++
        done++
        options.onProgress?.({ done, total })
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker))
    if (result.stopped) return result
    if (options.signal?.aborted) return { ...result, stopped: 'cancelled' }
  }
}
