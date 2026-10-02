import type { Block, Document, DocumentTag, Operation, Tag, Workspace } from '@notion-alt/shared'
import { Dexie, type EntityTable } from 'dexie'

export interface MetaEntry {
  key: string
  value: unknown
}

/** Queued operation; `seq` orders the queue (ADR 0002: push in order of creation). */
export interface QueuedOperation extends Operation {
  seq?: number
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
  }
}

export function localDbName(userId: string): string {
  return `notion-alt-${userId}`
}
