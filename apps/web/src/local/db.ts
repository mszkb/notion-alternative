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

/** Saved local search index of a workspace (#98), MiniSearch `toJSON`. Not synchronised. */
export interface SearchIndexCache {
  workspaceId: string
  /** Index options version; a cache of another format is rebuilt. */
  format: number
  documentCount: number
  json: string
}

/**
 * A page whose search entry may be outdated in the saved index (#98). Written in the same
 * transaction as the content change; `mark` changes with every write, so saving the index only
 * removes marks that did not change while it was built.
 */
export interface SearchDirtyEntry {
  documentId: string
  workspaceId: string
  mark: string
}

/**
 * A page whose content (blocks) this device has not loaded (ADR 0017). Only pages that arrived
 * from the server without content are listed; everything else is loaded. Not synchronised.
 */
export interface UnloadedDocument {
  documentId: string
  workspaceId: string
}

/** How much content a device keeps (ADR 0017); stored in `meta` under `offlineMode`. */
export type OfflineMode = 'all' | 'onDemand'

/**
 * A workspace as cached on this device (ADR 0014): the server's object with the user's role, and
 * `revoked` once the server no longer grants access while pages remain here (read-only then).
 */
export interface CachedWorkspace extends Workspace {
  revoked?: boolean
  /** The workspace of the local area without an account; unknown to any server (ADR 0023). */
  local?: boolean
}

/** Local database of one user account (ADR 0009). */
export class LocalDb extends Dexie {
  meta!: EntityTable<MetaEntry, 'key'>
  workspaces!: EntityTable<CachedWorkspace, 'id'>
  documents!: EntityTable<Document, 'id'>
  blocks!: EntityTable<Block, 'id'>
  tags!: EntityTable<Tag, 'id'>
  documentTags!: EntityTable<DocumentTag, 'id'>
  operations!: EntityTable<QueuedOperation, 'seq'>
  links!: EntityTable<LinkEntry, 'blockId'>
  conflicts!: EntityTable<Conflict, 'id'>
  attachments!: EntityTable<Attachment, 'id'>
  attachmentContents!: EntityTable<AttachmentContent, 'id'>
  searchIndexes!: EntityTable<SearchIndexCache, 'workspaceId'>
  searchDirty!: EntityTable<SearchDirtyEntry, 'documentId'>
  unloadedDocuments!: EntityTable<UnloadedDocument, 'documentId'>

  constructor(name: string) {
    // Dexie's optimistic query cache could deliver a live-query result from before a write that
    // had already finished; the editor would then render the older text (and the next keystroke
    // saved it). Disabled: results always come from IndexedDB, same speed in the load test.
    super(name, { cache: 'disabled' })
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
    // #98: saved search index per workspace and the pages changed since. New tables; without a
    // saved index the first start builds it as before.
    this.version(4).stores({
      searchIndexes: 'workspaceId',
      searchDirty: 'documentId, workspaceId',
    })
    // ADR 0017: page content on demand. Devices that already hold content keep loading
    // everything; a new, empty database starts with "on demand".
    this.version(5)
      .stores({ unloadedDocuments: 'documentId, workspaceId' })
      .upgrade(async (trx) => {
        const hasContent =
          (await trx.table('documents').count()) > 0 ||
          (await trx
            .table('meta')
            .filter((entry: MetaEntry) => entry.key.startsWith('syncCursor:'))
            .count()) > 0
        if (hasContent) await trx.table('meta').put({ key: 'offlineMode', value: 'all' })
      })
  }
}

export function localDbName(userId: string): string {
  return `notion-alt-${userId}`
}

/** Stands in for the user id of the local area without an account: `notion-alt-local` (ADR 0023). */
export const LOCAL_AREA = 'local'
