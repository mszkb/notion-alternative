import {
  convertNotionExport,
  type ExportManifest,
  type ImportInput,
  type JsonExport,
  migrateExport,
  type NotionImportReport,
  readNotionArchive,
  remapExportIds,
  verifyExportArchive,
  type Workspace,
} from '@notion-alt/shared'
import type { LocalStore } from '../local/store'

/** A checked export, ready to import. */
export interface ImportSource {
  data: JsonExport
  /** Attachment contents by id (ZIP only). */
  attachments: Map<string, Uint8Array>
  manifest: ExportManifest | null
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]

/**
 * Reads a ZIP (complete export) or JSON export: checksums, attachment hashes and schema are
 * verified, older `schema_version`s migrated. Throws with a readable reason otherwise.
 */
export async function readImportFile(file: Blob): Promise<ImportSource> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (ZIP_MAGIC.every((byte, i) => bytes[i] === byte)) {
    const { data, attachments, manifest } = await verifyExportArchive(bytes)
    return { data, attachments, manifest }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new Error('Die Datei ist weder ein ZIP- noch ein JSON-Export.')
  }
  return { data: migrateExport(parsed), attachments: new Map(), manifest: null }
}

/**
 * Reads the ZIP of Notion's "Export → Markdown & CSV" (#137) and converts it into an import with
 * fresh ids, plus a report of what was simplified. Works offline; only importing needs the server.
 */
export async function readNotionImportFile(
  file: Blob,
  name: string,
): Promise<ImportSource & { report: NotionImportReport }> {
  const files = await readNotionArchive(new Uint8Array(await file.arrayBuffer()))
  const { data, attachments, report } = await convertNotionExport(files, {
    workspace: { id: crypto.randomUUID(), name },
    newId: () => crypto.randomUUID(),
    now: new Date(),
  })
  return { data, attachments, manifest: null, report }
}

/**
 * Imports as a new workspace on the server; with `newIds` as a copy next to existing data.
 * Attachment contents are kept locally and uploaded by the next sync.
 */
export async function importWorkspace(
  store: LocalStore,
  source: ImportSource,
  options: {
    name: string
    newIds: boolean
    send: (input: ImportInput) => Promise<{ workspace: Workspace }>
  },
): Promise<Workspace> {
  let { data, attachments } = source
  if (options.newIds) {
    const remapped = remapExportIds(data, () => crypto.randomUUID())
    data = remapped.data
    attachments = new Map(
      [...attachments].map(([id, content]) => [
        remapped.idMap.get(id.toLowerCase()) ?? id,
        content,
      ]),
    )
  }
  const { workspace } = await options.send({ name: options.name, data })
  for (const [id, content] of attachments) {
    await store.stageAttachmentContent(id, content.slice().buffer)
  }
  return workspace
}
