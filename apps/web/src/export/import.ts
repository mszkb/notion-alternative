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

/**
 * Import without an account (ADR 0023): the active pages go into a workspace on this device, as
 * copies with new ids under a new page `title`, through the same path as the takeover. Nothing is
 * sent until an account exists. Returns the id of the new page.
 */
export async function importIntoWorkspace(
  store: LocalStore,
  source: ImportSource,
  options: { workspaceId: string; title: string },
): Promise<string> {
  const { data, idMap } = remapExportIds(source.data, () => crypto.randomUUID())
  const contents = new Map(
    [...source.attachments].map(([id, content]) => [idMap.get(id.toLowerCase()) ?? id, content]),
  )
  const holder = await store.createDocument({
    workspaceId: options.workspaceId,
    title: options.title,
  })
  const active = data.documents.filter((document) => !document.deletedAt)
  const byId = new Map(active.map((document) => [document.id, document]))
  const depth = (id: string | null): number => {
    let level = 0
    for (let parent = id; parent && byId.has(parent); parent = byId.get(parent)!.parentId) level++
    return level
  }
  // Parents first: a page keeps its parent only if that one is already there.
  active.sort((a, b) => depth(a.parentId) - depth(b.parentId))
  for (const document of active) {
    const documentTags = data.document_tags.filter(
      (assignment) => assignment.documentId === document.id && !assignment.deletedAt,
    )
    await store.takeOverPage(
      {
        document,
        blocks: data.blocks.filter((b) => b.documentId === document.id && !b.deletedAt),
        tags: data.tags.filter((tag) => documentTags.some((a) => a.tagId === tag.id)),
        documentTags,
        attachments: data.attachments
          .filter((a) => a.documentId === document.id && !a.deletedAt)
          .map((attachment) => ({
            attachment,
            data: contents.get(attachment.id)?.slice().buffer ?? null,
          })),
      },
      options.workspaceId,
      holder.id,
    )
  }
  return holder.id
}
