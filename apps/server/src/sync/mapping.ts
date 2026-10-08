import type {
  Attachment,
  Block,
  BlockAttrs,
  BlockType,
  Change,
  Conflict,
  Document,
  DocumentTag,
  OperationEntity,
  OperationKind,
  Tag,
} from '@notion-alt/shared'
import type {
  AttachmentsTable,
  BlocksTable,
  ChangesTable,
  ConflictsTable,
  DocumentsTable,
  DocumentTagsTable,
  TagsTable,
} from '../db/schema'

// The single place where DB rows (snake_case) become API objects (camelCase, ADR 0009).

export function toDocument(row: DocumentsTable): Document {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    parentId: row.parent_id,
    title: row.title,
    sortKey: row.sort_key,
    favorite: row.favorite === 1,
    // Only when set (#136): pages without them look like before export schema version 3.
    ...(row.icon ? { icon: row.icon } : {}),
    ...(row.cover ? { cover: row.cover as Document['cover'] } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: row.revision,
    deletedAt: row.deleted_at,
  }
}

export function toBlock(row: BlocksTable): Block {
  return {
    id: row.id,
    documentId: row.document_id,
    type: row.type as BlockType,
    content: row.content,
    attrs: JSON.parse(row.attrs) as BlockAttrs,
    sortKey: row.sort_key,
    revision: row.revision,
    deletedAt: row.deleted_at,
  }
}

export function toTag(row: TagsTable): Tag {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    revision: row.revision,
    deletedAt: row.deleted_at,
  }
}

export function toDocumentTag(row: DocumentTagsTable): DocumentTag {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    documentId: row.document_id,
    tagId: row.tag_id,
    revision: row.revision,
    deletedAt: row.deleted_at,
  }
}

export function toChange(row: ChangesTable): Change {
  return {
    seq: row.seq,
    opId: row.op_id,
    deviceId: row.device_id,
    entity: row.entity as OperationEntity,
    entityId: row.entity_id,
    kind: row.kind as OperationKind,
    revision: row.revision,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    appliedAt: row.applied_at,
  }
}

export function toConflict(row: ConflictsTable): Conflict {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    entity: row.entity as Conflict['entity'],
    entityId: row.entity_id,
    documentId: row.document_id,
    reason: row.reason as Conflict['reason'],
    baseRevision: row.base_revision,
    local: JSON.parse(row.local) as Conflict['local'],
    remote: row.remote === null ? null : (JSON.parse(row.remote) as Record<string, unknown>),
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolution: row.resolution as Conflict['resolution'],
    revision: row.revision,
    deletedAt: row.deleted_at,
  }
}

export function toAttachment(row: AttachmentsTable): Attachment {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    documentId: row.document_id,
    name: row.name,
    mimeType: row.mime_type,
    size: row.size,
    sha256: row.sha256,
    createdAt: row.created_at,
    revision: row.revision,
    deletedAt: row.deleted_at,
  }
}
