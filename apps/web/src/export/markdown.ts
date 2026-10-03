import { createZip, exportMarkdown, safeFileName, type ZipEntry } from '@notion-alt/shared'
import type { LocalStore } from '../local/store'

export interface ExportResult {
  fileName: string
  data: Uint8Array
  pages: number
  /** Attachments whose content is neither on this device nor downloadable now. */
  missingAttachments: number
}

export interface ExportOptions {
  /** Fetches content not on this device; `null` if unavailable. Omitted when offline. */
  download?: (attachmentId: string) => Promise<ArrayBuffer | null>
  now?: Date
}

/** Contents of the workspace's current attachments, from this device or downloaded (and kept). */
async function loadAttachmentContents(
  store: LocalStore,
  ids: string[],
  download: ExportOptions['download'],
): Promise<Map<string, Uint8Array>> {
  const contents = new Map<string, Uint8Array>()
  for (const id of ids) {
    let data = (await store.attachmentContent(id))?.data
    if (!data && download) {
      try {
        const downloaded = await download(id)
        if (downloaded) {
          await store.cacheAttachmentContent(id, downloaded)
          data = downloaded
        }
      } catch {
        // Counted as missing; the export still contains everything else.
      }
    }
    if (data) contents.set(id, new Uint8Array(data))
  }
  return contents
}

export function exportFileName(
  workspaceName: string,
  kind: string,
  now: Date,
  extension = 'zip',
): string {
  const date = now.toISOString().slice(0, 10)
  return `${safeFileName(workspaceName, 'Workspace')}-${kind}-${date}.${extension}`
}

/**
 * Markdown export of a workspace as ZIP (ADR 0004), built from the local database so it works
 * offline. Attachments are included when their content is available.
 */
export async function buildMarkdownExport(
  store: LocalStore,
  workspaceId: string,
  workspaceName: string,
  options: ExportOptions = {},
): Promise<ExportResult> {
  const now = options.now ?? new Date()
  const data = await store.exportData(workspaceId)
  const current = data.attachments.filter((a) => !a.deletedAt).map((a) => a.id)
  const contents = await loadAttachmentContents(store, current, options.download)
  const result = exportMarkdown(data, { availableAttachments: new Set(contents.keys()) })

  const entries: ZipEntry[] = result.files.map((file) => ({
    ...file,
    data: file.content,
    modified: now,
  }))
  for (const [id, path] of result.attachmentPaths) {
    entries.push({ path, data: contents.get(id)!, modified: now })
  }
  const activeDocuments = new Set(data.documents.filter((d) => !d.deletedAt).map((d) => d.id))
  const missingAttachments = data.attachments.filter(
    (a) => !a.deletedAt && activeDocuments.has(a.documentId) && !contents.has(a.id),
  ).length
  return {
    fileName: exportFileName(workspaceName, 'markdown', now),
    data: createZip(entries),
    pages: result.files.length,
    missingAttachments,
  }
}

/** Offers a file for download. */
export function saveFile(
  fileName: string,
  data: Uint8Array | Blob,
  type = 'application/zip',
): void {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
