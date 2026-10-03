import {
  buildExportArchive,
  type ExportManifest,
  type SyncLogQuery,
  type SyncLogResponse,
} from '@notion-alt/shared'
import type { LocalStore } from '../local/store'
import { fetchHistory } from './json'
import { exportFileName, loadAttachmentContents } from './markdown'

export interface ArchiveExportResult {
  fileName: string
  blob: Blob
  manifest: ExportManifest
}

/**
 * Complete export as ZIP (ADR 0004): Markdown, JSON, attachments and manifest. The state comes
 * from the local database; history (optional) and attachments missing on this device from
 * the server when reachable.
 */
export async function buildArchiveExport(
  store: LocalStore,
  workspace: { id: string; name: string },
  options: {
    download?: (attachmentId: string) => Promise<ArrayBuffer | null>
    syncLog?: (query: SyncLogQuery) => Promise<SyncLogResponse>
    onProgress?: (message: string) => void
    now?: Date
  } = {},
): Promise<ArchiveExportResult> {
  const now = options.now ?? new Date()
  const progress = options.onProgress ?? (() => {})
  progress('Daten lesen…')
  const input = await store.exportData(workspace.id)
  const active = new Set(input.documents.filter((d) => !d.deletedAt).map((d) => d.id))
  const ids = input.attachments
    .filter((a) => !a.deletedAt && active.has(a.documentId))
    .map((a) => a.id)
  const contents = await loadAttachmentContents(store, ids, options.download, (done, total) =>
    progress(`Anhänge laden (${done + 1}/${total})…`),
  )
  let history = null
  if (options.syncLog) {
    progress('Verlauf laden…')
    history = await fetchHistory(workspace.id, options.syncLog)
  }
  progress('ZIP erstellen…')
  const { parts, manifest } = await buildExportArchive(
    input,
    { workspace, exportedAt: now, history },
    contents,
  )
  return {
    fileName: exportFileName(workspace.name, 'export', now),
    blob: new Blob(parts as BlobPart[], { type: 'application/zip' }),
    manifest,
  }
}
