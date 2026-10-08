import type { LocalStore } from '../local/store'
import { connection } from '../session'
import { exclusive } from '../sync/engine'
import { type DocumentFetch, loadDocumentContent } from '../sync/resync'

/**
 * Before an export (ADR 0017, principle 3): loads the content of every page of the workspace that
 * is not on this device, while the server is reachable. Returns the pages still without content
 * (offline, connection lost), which the export then names instead of leaving them out silently.
 */
export async function loadContentForExport(
  store: LocalStore,
  workspaceId: string,
  fetchDocument: DocumentFetch | undefined,
  onProgress?: (done: number, total: number) => void,
): Promise<{ id: string; title: string }[]> {
  const unloaded = fetchDocument
    ? (await store.unloadedDocuments(workspaceId)).map((d) => d.id)
    : []
  for (let i = 0; i < unloaded.length && connection.value === 'online'; i++) {
    onProgress?.(i, unloaded.length)
    try {
      await exclusive(store, () =>
        loadDocumentContent(store, workspaceId, unloaded[i]!, fetchDocument!),
      )
    } catch {
      // Server unreachable or failing: export what is there and name the rest.
      break
    }
  }
  const missing = []
  for (const { id } of await store.unloadedDocuments(workspaceId)) {
    const document = await store.getDocument(id)
    if (document && !document.deletedAt) missing.push({ id, title: document.title })
  }
  return missing
}
