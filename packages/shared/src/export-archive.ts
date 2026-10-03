import { z } from 'zod'
import {
  createJsonExport,
  EXPORT_SCHEMA_VERSION,
  type ExportHistory,
  jsonExportChunks,
  type JsonExport,
} from './export-json'
import { exportMarkdown, type ExportInput } from './export-markdown'
import { migrateExport } from './import'
import { createZipParts, readZip, type ZipEntry } from './zip'

/** Marks the archive as ours; checked on import. */
export const EXPORT_ARCHIVE_FORMAT = 'notion-alt-export'
export const MANIFEST_PATH = 'manifest.json'
export const JSON_EXPORT_PATH = 'workspace.json'
export const MARKDOWN_FOLDER = 'markdown'

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/)

export const exportManifestSchema = z.object({
  format: z.literal(EXPORT_ARCHIVE_FORMAT),
  schema_version: z.number().int().positive(),
  exported_at: z.string(),
  workspace: z.object({ id: z.uuid(), name: z.string() }),
  history: z.boolean(),
  /** Every file of the archive except the manifest itself. */
  files: z.array(
    z.object({ path: z.string().min(1), size: z.number().int().nonnegative(), sha256: sha256Hex }),
  ),
  /** Where the content of each included attachment lies. */
  attachments: z.array(z.object({ id: z.uuid(), path: z.string().min(1) })),
  /** Attachments whose content was not available when exporting. */
  missing_attachments: z.array(z.object({ id: z.uuid(), name: z.string(), documentId: z.uuid() })),
})
export type ExportManifest = z.infer<typeof exportManifestSchema>

export async function sha256(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export interface ExportArchive {
  /** ZIP bytes in pieces; `new Blob(parts)` is the file. */
  parts: Uint8Array[]
  manifest: ExportManifest
}

/**
 * Complete export (ADR 0004): Markdown in `markdown/` (attachments in
 * `markdown/_attachments/`), the lossless JSON as `workspace.json` and `manifest.json` with
 * SHA-256 and size of every file. `contents` holds the attachment contents that are available.
 */
export async function buildExportArchive(
  input: ExportInput,
  meta: {
    workspace: { id: string; name: string }
    exportedAt: Date
    history: ExportHistory | null
  },
  contents: Map<string, Uint8Array>,
): Promise<ExportArchive> {
  const exportedAt = meta.exportedAt.toISOString()
  const markdown = exportMarkdown(input, { availableAttachments: new Set(contents.keys()) })
  const json = createJsonExport(input, {
    workspace: meta.workspace,
    exportedAt,
    history: meta.history,
  })

  const encoder = new TextEncoder()
  const files: { path: string; data: Uint8Array }[] = [
    { path: JSON_EXPORT_PATH, data: encoder.encode([...jsonExportChunks(json)].join('')) },
    ...markdown.files.map((file) => ({
      path: `${MARKDOWN_FOLDER}/${file.path}`,
      data: encoder.encode(file.content),
    })),
  ]
  const attachments: ExportManifest['attachments'] = []
  for (const [id, path] of markdown.attachmentPaths) {
    const fullPath = `${MARKDOWN_FOLDER}/${path}`
    files.push({ path: fullPath, data: contents.get(id)! })
    attachments.push({ id, path: fullPath })
  }

  const exportedDocuments = new Set(
    input.documents.filter((d) => !d.deletedAt).map((document) => document.id),
  )
  const missing = input.attachments
    .filter(
      (a) =>
        !a.deletedAt && exportedDocuments.has(a.documentId) && !markdown.attachmentPaths.has(a.id),
    )
    .map((a) => ({ id: a.id, name: a.name, documentId: a.documentId }))

  const manifest: ExportManifest = {
    format: EXPORT_ARCHIVE_FORMAT,
    schema_version: EXPORT_SCHEMA_VERSION,
    exported_at: exportedAt,
    workspace: meta.workspace,
    history: meta.history !== null,
    files: await Promise.all(
      files.map(async (file) => ({
        path: file.path,
        size: file.data.length,
        sha256: await sha256(file.data),
      })),
    ),
    attachments,
    missing_attachments: missing,
  }
  const entries: ZipEntry[] = [
    {
      path: MANIFEST_PATH,
      data: `${JSON.stringify(manifest, null, 2)}\n`,
      modified: meta.exportedAt,
    },
    ...files.map((file) => ({ ...file, modified: meta.exportedAt })),
  ]
  return { parts: createZipParts(entries), manifest }
}

export class ExportArchiveError extends Error {}

export interface VerifiedArchive {
  manifest: ExportManifest
  data: JsonExport
  /** Attachment contents by attachment id, checked against their SHA-256. */
  attachments: Map<string, Uint8Array>
}

/**
 * Reads an archive written by `buildExportArchive` and checks it completely: manifest, size
 * and SHA-256 of every file, attachment contents against their metadata, JSON against the
 * schema (older versions migrated). Throws `ExportArchiveError` with a reason otherwise.
 */
export async function verifyExportArchive(archive: Uint8Array): Promise<VerifiedArchive> {
  let entries
  try {
    entries = readZip(archive)
  } catch (error) {
    throw new ExportArchiveError(`Keine gültige ZIP-Datei: ${(error as Error).message}`)
  }
  const files = new Map(entries.map((entry) => [entry.path, entry.data]))
  const decoder = new TextDecoder()
  const manifestBytes = files.get(MANIFEST_PATH)
  if (!manifestBytes) throw new ExportArchiveError('manifest.json fehlt')
  const parsedManifest = exportManifestSchema.safeParse(parseJson(decoder.decode(manifestBytes)))
  if (!parsedManifest.success) throw new ExportArchiveError('manifest.json ist ungültig')
  const manifest = parsedManifest.data

  for (const file of manifest.files) {
    const data = files.get(file.path)
    if (!data) throw new ExportArchiveError(`Datei fehlt: ${file.path}`)
    if (data.length !== file.size || (await sha256(data)) !== file.sha256) {
      throw new ExportArchiveError(`Prüfsumme stimmt nicht: ${file.path}`)
    }
  }

  const jsonBytes = files.get(JSON_EXPORT_PATH)
  if (!jsonBytes || !manifest.files.some((f) => f.path === JSON_EXPORT_PATH)) {
    throw new ExportArchiveError('workspace.json fehlt')
  }
  let data: JsonExport
  try {
    data = migrateExport(parseJson(decoder.decode(jsonBytes)))
  } catch (error) {
    throw new ExportArchiveError(`workspace.json: ${(error as Error).message}`)
  }

  const metadata = new Map(data.attachments.map((a) => [a.id, a]))
  const attachments = new Map<string, Uint8Array>()
  for (const { id, path } of manifest.attachments) {
    const content = files.get(path)
    const meta = metadata.get(id)
    if (!content || !meta) throw new ExportArchiveError(`Anhang fehlt: ${path}`)
    if ((await sha256(content)) !== meta.sha256) {
      throw new ExportArchiveError(`Anhang passt nicht zu seinen Metadaten: ${path}`)
    }
    attachments.set(id, content)
  }
  return { manifest, data, attachments }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
