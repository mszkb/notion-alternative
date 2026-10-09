import { createJsonExport, type ImportInput, type Workspace } from '@notion-alt/shared'
import type { LocalStore } from '../local/store'
import type { DocumentFetch } from '../sync/resync'
import { loadContentForExport } from './content'
import { importWorkspace } from './import'
import { loadAttachmentContents } from './markdown'

/**
 * Copies a workspace as it is on this device, including the changes the server refused, into a
 * new workspace of the user (ADR 0014). Same path as importing a copy: new ids, attachments
 * uploaded by the next sync. Needs the server; nothing local is changed.
 */
export async function copyToOwnWorkspace(
  store: LocalStore,
  workspace: { id: string; name: string },
  options: {
    name: string
    send: (input: ImportInput) => Promise<{ workspace: Workspace }>
    download?: (attachmentId: string) => Promise<ArrayBuffer | null>
    fetchDocument?: DocumentFetch
    now?: Date
  },
): Promise<Workspace> {
  const missing = await loadContentForExport(store, workspace.id, options.fetchDocument)
  if (missing.length > 0) {
    throw new Error(
      `${missing.length} Seiten sind nicht auf diesem Gerät. Bitte mit Serververbindung erneut versuchen.`,
    )
  }
  const input = await store.exportData(workspace.id)
  const active = new Set(input.documents.filter((d) => !d.deletedAt).map((d) => d.id))
  const ids = input.attachments
    .filter((a) => !a.deletedAt && active.has(a.documentId))
    .map((a) => a.id)
  const attachments = await loadAttachmentContents(store, ids, options.download)
  const data = createJsonExport(input, {
    workspace,
    exportedAt: (options.now ?? new Date()).toISOString(),
    history: null,
  })
  return importWorkspace(
    store,
    { data, attachments, manifest: null },
    { name: options.name, newIds: true, send: options.send },
  )
}
