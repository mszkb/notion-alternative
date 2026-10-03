import type {
  Attachment,
  Block,
  Conflict,
  Document,
  DocumentTag,
  Operation,
  Tag,
  Workspace,
} from '@notion-alt/shared'
import { Dexie, type EntityTable } from 'dexie'

export interface MetaEntry {
  key: string
  value: unknown
}

/** Why a queued operation was not accepted by the server yet; it stays queued (no data loss). */
export interface QueuedOperationIssue {
  status: 'rejected'
  code: string
  message: string
  at: string
}

/** Queued operation; `seq` orders the queue (ADR 0002: push in order of creation). */
export interface QueuedOperation extends Operation {
  seq?: number
  /** Set by the last push if the server rejected it. Not indexed. */
  issue?: QueuedOperationIssue
}

/** Content of an attachment on this device (own uploads and downloaded copies, ADR 0012). */
export interface AttachmentContent {
  id: string
  /** ArrayBuffer rather than Blob: reliably storable in every browser's IndexedDB. */
  data: ArrayBuffer
  /** Uploaded to (or downloaded from) the server. */
  uploaded: boolean
}

/** Derived index of page links per block, used for backlinks. Not synchronised. */
export interface LinkEntry {
  blockId: string
  documentId: string
  workspaceId: string
  targets: string[]
}

/** Local database of one user account (ADR 0009). */
export class LocalDb extends Dexie {
  meta!: EntityTable<MetaEntry, 'key'>
  workspaces!: EntityTable<Workspace, 'id'>
  documents!: EntityTable<Document, 'id'>
  blocks!: EntityTable<Block, 'id'>
  tags!: EntityTable<Tag, 'id'>
  documentTags!: EntityTable<DocumentTag, 'id'>
  operations!: EntityTable<QueuedOperation, 'seq'>
  links!: EntityTable<LinkEntry, 'blockId'>
  conflicts!: EntityTable<Conflict, 'id'>
  attachments!: EntityTable<Attachment, 'id'>
  attachmentContents!: EntityTable<AttachmentContent, 'id'>

  constructor(name: string) {
    super(name)
    // Never edit a released version; add `this.version(n + 1)` with an upgrade instead (T-MIG-02).
    this.version(1).stores({
      meta: 'key',
      workspaces: 'id',
      documents: 'id, workspaceId, parentId, updatedAt',
      blocks: 'id, documentId',
      tags: 'id, workspaceId',
      documentTags: 'id, documentId, tagId, workspaceId',
      operations: '++seq, &opId, entityId, workspaceId',
      links: 'blockId, documentId, workspaceId, *targets',
    })
    // Phase 3: conflict objects replicated from the server (ADR 0003). New table, no data to move.
    this.version(2).stores({
      conflicts: 'id, workspaceId, documentId, entityId',
    })
    // Phase 5: attachments (ADR 0012). New tables, no data to move.
    this.version(3).stores({
      attachments: 'id, workspaceId, documentId',
      attachmentContents: 'id',
    })
  }
}

export function localDbName(userId: string): string {
  return `notion-alt-${userId}`
}
