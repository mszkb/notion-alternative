import { randomUUID } from 'node:crypto'
import type { JsonExport } from '@notion-alt/shared'
import type { Db } from '../db/database'
import type { WorkspacesTable } from '../db/schema'
import { HttpError } from '../errors'
import { reindexDocument } from '../search/index'

/** SQLite allows a limited number of bound variables per statement. */
const CHUNK = 500

function chunks<T>(items: T[]): T[][] {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += CHUNK) result.push(items.slice(i, i + CHUNK))
  return result
}

/** References inside the export must point to entities of the export (no foreign ids). */
function checkReferences(data: JsonExport) {
  const documents = new Set(data.documents.map((d) => d.id))
  const tags = new Set(data.tags.map((t) => t.id))
  const attachments = new Set(data.attachments.map((a) => a.id))
  const ids = [data.documents, data.blocks, data.tags, data.document_tags, data.attachments]
    .flat()
    .map((entity) => entity.id)
  const invalid = (reason: string): never => {
    throw new HttpError(400, 'invalid_import', reason)
  }
  if (new Set(ids).size !== ids.length) invalid('Duplicate ids in the export')
  for (const d of data.documents) {
    if (d.parentId && !documents.has(d.parentId)) invalid(`Unknown parent of page ${d.id}`)
  }
  for (const b of data.blocks) {
    if (!documents.has(b.documentId)) invalid(`Unknown page of block ${b.id}`)
    if (b.attrs.attachmentId && !attachments.has(b.attrs.attachmentId)) {
      invalid(`Unknown attachment in block ${b.id}`)
    }
  }
  for (const a of data.document_tags) {
    if (!documents.has(a.documentId) || !tags.has(a.tagId)) invalid(`Unknown reference in ${a.id}`)
  }
  for (const a of data.attachments) {
    if (!documents.has(a.documentId)) invalid(`Unknown page of attachment ${a.id}`)
  }
  const opIds = (data.history?.changes ?? []).map((c) => c.opId)
  if (new Set(opIds).size !== opIds.length) invalid('Duplicate operation ids in the history')
  return { ids, opIds }
}

/** True if any of the ids already exists on this server (in any workspace). */
async function anyExists(db: Db, ids: string[], opIds: string[]): Promise<boolean> {
  const tables = ['documents', 'blocks', 'tags', 'document_tags', 'attachments'] as const
  for (const part of chunks(ids)) {
    for (const table of tables) {
      if (await db.selectFrom(table).select('id').where('id', 'in', part).executeTakeFirst()) {
        return true
      }
    }
  }
  for (const part of chunks(opIds)) {
    const found = await db
      .selectFrom('changes')
      .select('op_id')
      .where('op_id', 'in', part)
      .executeTakeFirst()
    if (found) return true
  }
  return false
}

/**
 * Creates a new workspace from an export (ADR 0004) in one transaction: entities with their
 * ids and revisions, the history as change log, search index. Existing data is never touched;
 * if an id already exists the import is refused (`409`) so the client can import a copy with
 * new ids instead. The log is marked compacted up to the imported history, so devices start
 * with a snapshot rather than replaying a history that may be incomplete.
 */
export async function importWorkspace(
  db: Db,
  ownerId: string,
  name: string,
  data: JsonExport,
  quotaBytes: number | null,
): Promise<WorkspacesTable> {
  const { ids, opIds } = checkReferences(data)
  const attachmentBytes = data.attachments
    .filter((a) => !a.deletedAt)
    .reduce((sum, a) => sum + a.size, 0)
  if (quotaBytes !== null && attachmentBytes > quotaBytes) {
    throw new HttpError(413, 'storage_limit', 'Attachments exceed the workspace storage limit')
  }

  return db.transaction().execute(async (trx) => {
    if (await anyExists(trx, ids, opIds)) {
      throw new HttpError(409, 'ids_exist', 'Some ids of the export already exist on this server')
    }
    const changes = [...(data.history?.changes ?? [])].sort((a, b) => a.seq - b.seq)
    const workspace: WorkspacesTable = {
      id: randomUUID(),
      name,
      owner_id: ownerId,
      created_at: new Date().toISOString(),
      // Never 0: a device pulling from cursor 0 must take a snapshot to see the import.
      compacted_seq: Math.max(changes.length, 1),
    }
    await trx.insertInto('workspaces').values(workspace).execute()
    const ws = workspace.id
    // Entities that were never synced in the source have no revision yet.
    const revision = (value: number | null) => value ?? 1

    for (const part of chunks(data.documents)) {
      await trx
        .insertInto('documents')
        .values(
          part.map((d) => ({
            id: d.id,
            workspace_id: ws,
            parent_id: d.parentId,
            title: d.title,
            sort_key: d.sortKey,
            favorite: d.favorite ? 1 : 0,
            created_at: d.createdAt,
            updated_at: d.updatedAt,
            revision: revision(d.revision),
            deleted_at: d.deletedAt,
          })),
        )
        .execute()
    }
    for (const part of chunks(data.blocks)) {
      await trx
        .insertInto('blocks')
        .values(
          part.map((b) => ({
            id: b.id,
            workspace_id: ws,
            document_id: b.documentId,
            type: b.type,
            content: b.content,
            attrs: JSON.stringify(b.attrs),
            sort_key: b.sortKey,
            revision: revision(b.revision),
            deleted_at: b.deletedAt,
          })),
        )
        .execute()
    }
    for (const part of chunks(data.tags)) {
      await trx
        .insertInto('tags')
        .values(
          part.map((t) => ({
            id: t.id,
            workspace_id: ws,
            name: t.name,
            revision: revision(t.revision),
            deleted_at: t.deletedAt,
          })),
        )
        .execute()
    }
    for (const part of chunks(data.document_tags)) {
      await trx
        .insertInto('document_tags')
        .values(
          part.map((a) => ({
            id: a.id,
            workspace_id: ws,
            document_id: a.documentId,
            tag_id: a.tagId,
            revision: revision(a.revision),
            deleted_at: a.deletedAt,
          })),
        )
        .execute()
    }
    for (const part of chunks(data.attachments)) {
      await trx
        .insertInto('attachments')
        .values(
          part.map((a) => ({
            id: a.id,
            workspace_id: ws,
            document_id: a.documentId,
            name: a.name,
            mime_type: a.mimeType,
            size: a.size,
            sha256: a.sha256,
            created_at: a.createdAt,
            // The client uploads the contents afterwards; the hash is checked then.
            stored_at: null,
            revision: revision(a.revision),
            deleted_at: a.deletedAt,
          })),
        )
        .execute()
    }
    for (const part of chunks(changes.map((change, index) => ({ change, seq: index + 1 })))) {
      await trx
        .insertInto('changes')
        .values(
          part.map(({ change, seq }) => ({
            workspace_id: ws,
            seq,
            op_id: change.opId,
            device_id: change.deviceId,
            entity: change.entity,
            entity_id: change.entityId,
            kind: change.kind,
            revision: change.revision,
            payload: JSON.stringify(change.payload),
            applied_at: change.appliedAt,
          })),
        )
        .execute()
    }
    for (const document of data.documents) {
      if (!document.deletedAt) await reindexDocument(trx, document.id)
    }
    return workspace
  })
}
