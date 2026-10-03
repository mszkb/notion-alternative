import { z } from 'zod'
import {
  attachmentSchema,
  blockSchema,
  documentSchema,
  documentTagSchema,
  tagSchema,
} from './content'
import type { ExportInput } from './export-markdown'
import { extractPageLinks } from './inline'
import { changeSchema, SYNC_PULL_MAX_LIMIT } from './operations'

/**
 * Version of the JSON export format (ADR 0004). Every change to the format needs a new
 * version and an import migration from all earlier ones.
 */
export const EXPORT_SCHEMA_VERSION = 1

export const exportLinkSchema = z.object({
  blockId: z.uuid(),
  sourceDocumentId: z.uuid(),
  targetDocumentId: z.uuid(),
})
export type ExportLink = z.infer<typeof exportLinkSchema>

export const exportHistorySchema = z.object({
  /** Changes up to this `seq` were compacted on the server and are not included. */
  compactedSeq: z.number().int().nonnegative(),
  /** Change log of the workspace, oldest first (ADR 0013). */
  changes: z.array(changeSchema),
})
export type ExportHistory = z.infer<typeof exportHistorySchema>

/**
 * Lossless JSON export (ADR 0004): the complete workspace including tombstones, so a restore
 * keeps deleted pages in the trash. Entity fields as in the sync API (camelCase).
 */
export const jsonExportSchema = z.object({
  schema_version: z.literal(EXPORT_SCHEMA_VERSION),
  exported_at: z.string(),
  workspace: z.object({ id: z.uuid(), name: z.string() }),
  documents: z.array(documentSchema),
  blocks: z.array(blockSchema),
  tags: z.array(tagSchema),
  document_tags: z.array(documentTagSchema),
  /** Page links of active blocks; derived from block content, informational. */
  links: z.array(exportLinkSchema),
  attachments: z.array(attachmentSchema),
  /** `null` when exported without history. */
  history: exportHistorySchema.nullable(),
})
export type JsonExport = z.infer<typeof jsonExportSchema>

/** `GET /api/sync/log`: change log for exports, also after compaction (no `410`). */
export const syncLogQuerySchema = z.object({
  workspaceId: z.uuid(),
  cursor: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(SYNC_PULL_MAX_LIMIT).default(SYNC_PULL_MAX_LIMIT),
})
export type SyncLogQuery = z.infer<typeof syncLogQuerySchema>

export interface SyncLogResponse {
  changes: z.infer<typeof changeSchema>[]
  cursor: number
  hasMore: boolean
  compactedSeq: number
}

export function exportLinks(input: Pick<ExportInput, 'documents' | 'blocks'>): ExportLink[] {
  const documents = new Set(input.documents.map((d) => d.id))
  const links: ExportLink[] = []
  for (const block of input.blocks) {
    if (block.deletedAt || block.type === 'code') continue
    for (const target of extractPageLinks(block.content)) {
      if (!documents.has(target)) continue
      links.push({
        blockId: block.id,
        sourceDocumentId: block.documentId,
        targetDocumentId: target,
      })
    }
  }
  return links
}

export function createJsonExport(
  input: ExportInput,
  meta: {
    workspace: { id: string; name: string }
    exportedAt: string
    history: ExportHistory | null
  },
): JsonExport {
  const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return {
    schema_version: EXPORT_SCHEMA_VERSION,
    exported_at: meta.exportedAt,
    workspace: meta.workspace,
    documents: [...input.documents].sort(byId),
    blocks: [...input.blocks].sort(byId),
    tags: [...input.tags].sort(byId),
    document_tags: [...input.documentTags].sort(byId),
    links: exportLinks(input),
    attachments: [...input.attachments].sort(byId),
    history: meta.history,
  }
}

/**
 * Serialises the export in small pieces (one entity per line) so a large workspace never has
 * to exist as one string; pass the pieces to `new Blob(...)`. The result is valid JSON.
 */
export function* jsonExportChunks(data: JsonExport): Generator<string> {
  const { history, ...rest } = data
  const arrays = ['documents', 'blocks', 'tags', 'document_tags', 'links', 'attachments'] as const
  yield '{\n'
  yield `  "schema_version": ${JSON.stringify(rest.schema_version)},\n`
  yield `  "exported_at": ${JSON.stringify(rest.exported_at)},\n`
  yield `  "workspace": ${JSON.stringify(rest.workspace)},\n`
  for (const key of arrays) {
    yield* arrayChunks(`  "${key}": `, rest[key], '    ')
    yield ',\n'
  }
  if (!history) {
    yield '  "history": null\n}\n'
    return
  }
  yield `  "history": {\n    "compactedSeq": ${history.compactedSeq},\n`
  yield* arrayChunks('    "changes": ', history.changes, '      ')
  yield '\n  }\n}\n'
}

function* arrayChunks(prefix: string, items: unknown[], indent: string): Generator<string> {
  if (items.length === 0) {
    yield `${prefix}[]`
    return
  }
  yield `${prefix}[\n`
  for (let i = 0; i < items.length; i++) {
    yield `${indent}${JSON.stringify(items[i])}${i < items.length - 1 ? ',' : ''}\n`
  }
  yield `${indent.slice(2)}]`
}
