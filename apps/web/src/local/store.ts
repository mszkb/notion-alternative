import {
  type Attachment,
  type AttachmentCreatePayload,
  type Block,
  type BlockAttrs,
  type BlockCreatePayload,
  type BlockType,
  blockSchema,
  type Change,
  type Conflict,
  type ConflictCreatePayload,
  type ConflictResolution,
  type ConflictUpdatePayload,
  compareBySortKey,
  type Document,
  type DocumentCreatePayload,
  type DocumentTag,
  type DocumentTagCreatePayload,
  documentSchema,
  documentTitleSchema,
  extractPageLinks,
  newId,
  type Operation,
  type OperationEntity,
  type OperationKind,
  sortKeyBetween,
  type SyncPushResult,
  type SyncSnapshotResponse,
  type Tag,
  type TagCreatePayload,
  tagNameSchema,
  tagSchema,
  INLINE_IMAGE_TYPES,
  attachmentSchema,
  validateOperationPayload,
  type Workspace,
} from '@notion-alt/shared'
import type { AttachmentContent, LocalDb, QueuedOperation } from './db'

export class LocalStoreError extends Error {
  override name = 'LocalStoreError'
}

/** Emitted after a write transaction has committed. */
export interface StoreChange {
  workspaceId: string
  documentIds: string[]
}

export type ChangeListener = (change: StoreChange) => void

/** Position among siblings: after a given sibling (`null` = first) or, if omitted, at the end. */
export interface Position {
  afterId?: string | null
}

export interface NewBlock {
  /** Client-chosen id, e.g. so the editor can show the block before the write commits. */
  id?: string
  type?: BlockType
  content?: string
  attrs?: BlockAttrs
}

export type BlockPatch = Partial<Pick<Block, 'type' | 'content' | 'attrs'>>

/** A block as seen by undo/redo: everything the user can change, in document order. */
export type BlockState = Pick<Block, 'id' | 'type' | 'content' | 'attrs'>

interface WriteContext {
  touched: Map<string, Set<string>>
}

const CONTENT_TABLES = [
  'documents',
  'blocks',
  'tags',
  'documentTags',
  'operations',
  'links',
  'conflicts',
  'attachments',
  'attachmentContents',
]

/**
 * The only write path for local content (ADR 0009). Every mutation writes the content change and
 * its operation(s) to the offline queue in one Dexie transaction: either both persist or neither.
 */
export class LocalStore {
  private readonly listeners = new Set<ChangeListener>()

  constructor(
    readonly db: LocalDb,
    readonly deviceId: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** Opens the store and creates the stable device id on first use. */
  static async open(db: LocalDb, now?: () => string): Promise<LocalStore> {
    const deviceId = await db.transaction('rw', db.meta, async () => {
      const existing = await db.meta.get('deviceId')
      if (typeof existing?.value === 'string') return existing.value
      const id = newId()
      await db.meta.put({ key: 'deviceId', value: id })
      return id
    })
    return new LocalStore(db, deviceId, now)
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // ---------------------------------------------------------------- write plumbing

  private async write<T>(fn: (ctx: WriteContext) => Promise<T>): Promise<T> {
    const ctx: WriteContext = { touched: new Map() }
    // The scope must be an `async` function: Dexie only then tracks native awaits and keeps the
    // transaction alive across them (otherwise it may commit early).
    const result = await this.db.transaction('rw', CONTENT_TABLES, async () => fn(ctx))
    this.notify(ctx)
    return result
  }

  private notify(ctx: WriteContext) {
    for (const [workspaceId, ids] of ctx.touched) {
      const change = { workspaceId, documentIds: [...ids] }
      for (const listener of this.listeners) listener(change)
    }
  }

  /** Local table of each synchronised entity. */
  private get entityTables() {
    return {
      document: this.db.documents,
      block: this.db.blocks,
      tag: this.db.tags,
      document_tag: this.db.documentTags,
      attachment: this.db.attachments,
      conflict: this.db.conflicts,
    } as const
  }

  private mark(ctx: WriteContext, workspaceId: string, documentId: string) {
    const set = ctx.touched.get(workspaceId) ?? new Set<string>()
    set.add(documentId)
    ctx.touched.set(workspaceId, set)
  }

  private async enqueue(
    workspaceId: string,
    entity: OperationEntity,
    entityId: string,
    kind: OperationKind,
    baseRevision: number | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const operation: Operation = {
      opId: newId(),
      deviceId: this.deviceId,
      workspaceId,
      entity,
      entityId,
      kind,
      baseRevision,
      payload,
      createdAt: this.now(),
    }
    await this.db.operations.add(operation)
  }

  /** Bumps `updatedAt` for "recently edited"; derived locally, no operation (ADR 0009). */
  private async touch(ctx: WriteContext, document: Document) {
    await this.db.documents.update(document.id, { updatedAt: this.now() })
    this.mark(ctx, document.workspaceId, document.id)
  }

  private async requireDocument(id: string): Promise<Document> {
    const document = await this.db.documents.get(id)
    if (!document || document.deletedAt) throw new LocalStoreError(`Document ${id} not found`)
    return document
  }

  private async requireBlock(id: string): Promise<{ block: Block; document: Document }> {
    const block = await this.db.blocks.get(id)
    if (!block || block.deletedAt) throw new LocalStoreError(`Block ${id} not found`)
    return { block, document: await this.requireDocument(block.documentId) }
  }

  private static sortKeyAt<T extends { id: string; sortKey: string }>(
    siblings: T[],
    position: Position,
    excludeId?: string,
  ): string {
    const list = siblings.filter((item) => item.id !== excludeId).sort(compareBySortKey)
    if (position.afterId === undefined) {
      return sortKeyBetween(list[list.length - 1]?.sortKey ?? null, null)
    }
    if (position.afterId === null) return sortKeyBetween(null, list[0]?.sortKey ?? null)
    const index = list.findIndex((item) => item.id === position.afterId)
    if (index === -1) throw new LocalStoreError(`Sibling ${position.afterId} not found`)
    const before = list[index]!.sortKey
    // Siblings with an equal key (concurrent inserts) are skipped: bound by the next distinct key.
    const next = list.slice(index + 1).find((item) => item.sortKey > before)
    return sortKeyBetween(before, next?.sortKey ?? null)
  }

  // ---------------------------------------------------------------- documents

  async listDocuments(workspaceId: string): Promise<Document[]> {
    const documents = await this.db.documents.where('workspaceId').equals(workspaceId).toArray()
    return documents.filter((document) => !document.deletedAt).sort(compareBySortKey)
  }

  async getDocument(id: string): Promise<Document | undefined> {
    const document = await this.db.documents.get(id)
    return document && !document.deletedAt ? document : undefined
  }

  /** Title of a page, also of a deleted one (conflicts may refer to it). */
  async documentTitle(id: string): Promise<string | null> {
    return (await this.db.documents.get(id))?.title ?? null
  }

  private async children(workspaceId: string, parentId: string | null): Promise<Document[]> {
    const documents = await this.db.documents.where('workspaceId').equals(workspaceId).toArray()
    return documents.filter((document) => !document.deletedAt && document.parentId === parentId)
  }

  /** Creates a page with one empty paragraph so the editor always has a block to type into. */
  async createDocument(input: {
    workspaceId: string
    parentId?: string | null
    title?: string
    position?: Position
  }): Promise<Document> {
    return this.write(async (ctx) => {
      const parentId = input.parentId ?? null
      if (parentId) {
        const parent = await this.requireDocument(parentId)
        if (parent.workspaceId !== input.workspaceId) {
          throw new LocalStoreError('Parent belongs to another workspace')
        }
      }
      const now = this.now()
      const document = documentSchema.parse({
        id: newId(),
        workspaceId: input.workspaceId,
        parentId,
        title: input.title ?? '',
        sortKey: LocalStore.sortKeyAt(
          await this.children(input.workspaceId, parentId),
          input.position ?? {},
        ),
        favorite: false,
        createdAt: now,
        updatedAt: now,
        revision: null,
        deletedAt: null,
      } satisfies Document)
      await this.db.documents.add(document)
      await this.enqueue(document.workspaceId, 'document', document.id, 'create', null, {
        parentId: document.parentId,
        title: document.title,
        sortKey: document.sortKey,
        favorite: document.favorite,
        createdAt: document.createdAt,
      })
      await this.insertBlock(ctx, document, {}, {})
      this.mark(ctx, document.workspaceId, document.id)
      return document
    })
  }

  async renameDocument(id: string, title: string): Promise<void> {
    const parsed = documentTitleSchema.parse(title)
    await this.write(async (ctx) => {
      const document = await this.requireDocument(id)
      if (document.title === parsed) return
      await this.db.documents.update(id, { title: parsed })
      await this.enqueue(document.workspaceId, 'document', id, 'update', document.revision, {
        title: parsed,
      })
      await this.touch(ctx, document)
    })
  }

  async setFavorite(id: string, favorite: boolean): Promise<void> {
    await this.write(async (ctx) => {
      const document = await this.requireDocument(id)
      if (document.favorite === favorite) return
      await this.db.documents.update(id, { favorite })
      await this.enqueue(document.workspaceId, 'document', id, 'update', document.revision, {
        favorite,
      })
      this.mark(ctx, document.workspaceId, id)
    })
  }

  /** Moves a page in the tree; refuses to move a page below itself. */
  async moveDocument(id: string, parentId: string | null, position: Position = {}): Promise<void> {
    await this.write(async (ctx) => {
      const document = await this.requireDocument(id)
      for (let cursor = parentId; cursor;) {
        if (cursor === id) throw new LocalStoreError('A page cannot be moved below itself')
        const ancestor = await this.requireDocument(cursor)
        if (ancestor.workspaceId !== document.workspaceId) {
          throw new LocalStoreError('Target belongs to another workspace')
        }
        cursor = ancestor.parentId
      }
      const sortKey = LocalStore.sortKeyAt(
        await this.children(document.workspaceId, parentId),
        position,
        id,
      )
      await this.db.documents.update(id, { parentId, sortKey })
      await this.enqueue(document.workspaceId, 'document', id, 'move', document.revision, {
        parentId,
        sortKey,
      })
      this.mark(ctx, document.workspaceId, id)
    })
  }

  /** Tombstones the page and its whole subtree (T-DEL-03); returns the deleted ids. */
  async deleteDocument(id: string): Promise<string[]> {
    return this.write(async (ctx) => {
      const root = await this.requireDocument(id)
      const all = await this.listDocuments(root.workspaceId)
      const subtree: Document[] = []
      const visit = (document: Document) => {
        subtree.push(document)
        for (const child of all) if (child.parentId === document.id) visit(child)
      }
      visit(root)
      const deletedAt = this.now()
      for (const document of subtree) {
        await this.db.documents.update(document.id, { deletedAt })
        await this.enqueue(
          document.workspaceId,
          'document',
          document.id,
          'delete',
          document.revision,
          {},
        )
        this.mark(ctx, document.workspaceId, document.id)
      }
      return subtree.map((document) => document.id)
    })
  }

  async recentDocuments(workspaceId: string, limit = 10): Promise<Document[]> {
    const documents = await this.listDocuments(workspaceId)
    return documents
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
      .slice(0, limit)
  }

  async favoriteDocuments(workspaceId: string): Promise<Document[]> {
    const documents = await this.listDocuments(workspaceId)
    return documents.filter((document) => document.favorite).sort(byTitle)
  }

  /** Active documents that link to the given page (derived from page links in block content). */
  async backlinks(documentId: string): Promise<Document[]> {
    const entries = await this.db.links.where('targets').equals(documentId).toArray()
    const sourceIds = [...new Set(entries.map((entry) => entry.documentId))].filter(
      (id) => id !== documentId,
    )
    const sources = await this.db.documents.bulkGet(sourceIds)
    return sources
      .filter((document): document is Document => !!document && !document.deletedAt)
      .sort(byTitle)
  }

  // ---------------------------------------------------------------- blocks

  async listBlocks(documentId: string): Promise<Block[]> {
    const blocks = await this.db.blocks.where('documentId').equals(documentId).toArray()
    return blocks.filter((block) => !block.deletedAt).sort(compareBySortKey)
  }

  private async insertBlock(
    ctx: WriteContext,
    document: Document,
    input: NewBlock,
    position: Position,
  ): Promise<Block> {
    const block = blockSchema.parse({
      id: input.id ?? newId(),
      documentId: document.id,
      type: input.type ?? 'paragraph',
      content: input.content ?? '',
      attrs: input.attrs ?? {},
      sortKey: LocalStore.sortKeyAt(await this.listBlocks(document.id), position),
      revision: null,
      deletedAt: null,
    } satisfies Block)
    await this.db.blocks.add(block)
    await this.enqueue(document.workspaceId, 'block', block.id, 'create', null, {
      documentId: block.documentId,
      type: block.type,
      content: block.content,
      attrs: block.attrs,
      sortKey: block.sortKey,
    })
    await this.updateLinks(block, document)
    await this.touch(ctx, document)
    return block
  }

  private async patchBlock(ctx: WriteContext, id: string, patch: BlockPatch): Promise<Block> {
    const { block, document } = await this.requireBlock(id)
    const changed: BlockPatch = {}
    if (patch.type !== undefined && patch.type !== block.type) changed.type = patch.type
    if (patch.content !== undefined && patch.content !== block.content) {
      changed.content = patch.content
    }
    if (patch.attrs !== undefined && !sameAttrs(patch.attrs, block.attrs)) {
      changed.attrs = patch.attrs
    }
    if (Object.keys(changed).length === 0) return block
    const next = blockSchema.parse({ ...block, ...changed })
    await this.db.blocks.put(next)
    await this.enqueue(document.workspaceId, 'block', id, 'update', block.revision, changed)
    await this.updateLinks(next, document)
    await this.touch(ctx, document)
    return next
  }

  private async removeBlock(ctx: WriteContext, id: string): Promise<void> {
    const { block, document } = await this.requireBlock(id)
    await this.db.blocks.update(id, { deletedAt: this.now() })
    await this.db.links.delete(id)
    await this.enqueue(document.workspaceId, 'block', id, 'delete', block.revision, {})
    await this.touch(ctx, document)
  }

  private async updateLinks(block: Block, document: Document) {
    const targets = block.type === 'code' ? [] : extractPageLinks(block.content)
    if (targets.length === 0) {
      await this.db.links.delete(block.id)
    } else {
      await this.db.links.put({
        blockId: block.id,
        documentId: document.id,
        workspaceId: document.workspaceId,
        targets,
      })
    }
  }

  async createBlock(documentId: string, input: NewBlock, position: Position = {}): Promise<Block> {
    return this.write(async (ctx) =>
      this.insertBlock(ctx, await this.requireDocument(documentId), input, position),
    )
  }

  /** Saves changed fields only; an unchanged save creates no operation. */
  async updateBlock(id: string, patch: BlockPatch): Promise<Block> {
    return this.write(async (ctx) => this.patchBlock(ctx, id, patch))
  }

  private async relocateBlock(ctx: WriteContext, id: string, position: Position): Promise<void> {
    const { block, document } = await this.requireBlock(id)
    const sortKey = LocalStore.sortKeyAt(await this.listBlocks(document.id), position, id)
    if (sortKey === block.sortKey) return
    await this.db.blocks.update(id, { sortKey })
    await this.enqueue(document.workspaceId, 'block', id, 'move', block.revision, { sortKey })
    await this.touch(ctx, document)
  }

  async moveBlock(id: string, position: Position): Promise<void> {
    await this.write((ctx) => this.relocateBlock(ctx, id, position))
  }

  /**
   * Brings a document's blocks to `target` (undo/redo, deleting a selection) with ordinary
   * operations in one transaction. Blocks that no longer exist are recreated under a new id,
   * because tombstones stay final (sync invariant). Returns the old → new ids of recreated blocks.
   */
  async applyBlockState(documentId: string, target: BlockState[]): Promise<Map<string, string>> {
    return this.write(async (ctx) => {
      const document = await this.requireDocument(documentId)
      const current = await this.listBlocks(documentId)
      const wanted = new Set(target.map((state) => state.id))
      for (const block of current) {
        if (!wanted.has(block.id)) await this.removeBlock(ctx, block.id)
      }
      const existing = new Set(current.map((block) => block.id))
      const recreated = new Map<string, string>()
      // Invariant: after each step, the processed target blocks lead the list in target order.
      let previousId: string | null = null
      for (const state of target) {
        const fields = { type: state.type, content: state.content, attrs: state.attrs }
        let id = state.id
        if (existing.has(id)) {
          await this.patchBlock(ctx, id, fields)
          const list = await this.listBlocks(documentId)
          const index = list.findIndex((block) => block.id === id)
          if ((index > 0 ? list[index - 1]!.id : null) !== previousId) {
            await this.relocateBlock(ctx, id, { afterId: previousId })
          }
        } else {
          id = (await this.insertBlock(ctx, document, fields, { afterId: previousId })).id
          recreated.set(state.id, id)
        }
        previousId = id
      }
      return recreated
    })
  }

  async deleteBlock(id: string): Promise<void> {
    await this.write((ctx) => this.removeBlock(ctx, id))
  }

  /** Enter in the editor: keep the head in the block, insert the tail as a new block after it. */
  async splitBlock(id: string, head: string, tail: NewBlock): Promise<Block> {
    return this.write(async (ctx) => {
      const block = await this.patchBlock(ctx, id, { content: head })
      const document = await this.requireDocument(block.documentId)
      return this.insertBlock(ctx, document, tail, { afterId: id })
    })
  }

  /** Backspace at the start of a block: append its content to the previous block, delete it. */
  async mergeBlocks(targetId: string, sourceId: string, content: string): Promise<Block> {
    return this.write(async (ctx) => {
      const target = await this.patchBlock(ctx, targetId, { content })
      await this.removeBlock(ctx, sourceId)
      return target
    })
  }

  // ---------------------------------------------------------------- tags

  async listTags(workspaceId: string): Promise<Tag[]> {
    const tags = await this.db.tags.where('workspaceId').equals(workspaceId).toArray()
    return tags.filter((tag) => !tag.deletedAt).sort((a, b) => a.name.localeCompare(b.name))
  }

  private async activeAssignments(documentId: string): Promise<DocumentTag[]> {
    const assignments = await this.db.documentTags.where('documentId').equals(documentId).toArray()
    return assignments.filter((assignment) => !assignment.deletedAt)
  }

  async tagsForDocument(documentId: string): Promise<Tag[]> {
    const tagIds = [...new Set((await this.activeAssignments(documentId)).map((a) => a.tagId))]
    const tags = await this.db.tags.bulkGet(tagIds)
    return tags
      .filter((tag): tag is Tag => !!tag && !tag.deletedAt)
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async documentsForTag(tagId: string): Promise<Document[]> {
    const assignments = await this.db.documentTags.where('tagId').equals(tagId).toArray()
    const ids = [...new Set(assignments.filter((a) => !a.deletedAt).map((a) => a.documentId))]
    const documents = await this.db.documents.bulkGet(ids)
    return documents
      .filter((document): document is Document => !!document && !document.deletedAt)
      .sort(byTitle)
  }

  /** Adds a tag by name, reusing an existing tag with the same name (case-insensitive). */
  async addTag(documentId: string, name: string): Promise<Tag> {
    const parsedName = tagNameSchema.parse(name)
    return this.write(async (ctx) => {
      const document = await this.requireDocument(documentId)
      const existing = (await this.listTags(document.workspaceId)).find(
        (tag) => tag.name.toLocaleLowerCase() === parsedName.toLocaleLowerCase(),
      )
      let tag = existing
      if (!tag) {
        tag = tagSchema.parse({
          id: newId(),
          workspaceId: document.workspaceId,
          name: parsedName,
          revision: null,
          deletedAt: null,
        } satisfies Tag)
        await this.db.tags.add(tag)
        await this.enqueue(tag.workspaceId, 'tag', tag.id, 'create', null, { name: tag.name })
      }
      const assignments = await this.activeAssignments(documentId)
      if (!assignments.some((assignment) => assignment.tagId === tag.id)) {
        const assignment: DocumentTag = {
          id: newId(),
          workspaceId: document.workspaceId,
          documentId,
          tagId: tag.id,
          revision: null,
          deletedAt: null,
        }
        await this.db.documentTags.add(assignment)
        await this.enqueue(document.workspaceId, 'document_tag', assignment.id, 'create', null, {
          documentId,
          tagId: tag.id,
        })
        await this.touch(ctx, document)
      }
      return tag
    })
  }

  async removeTag(documentId: string, tagId: string): Promise<void> {
    await this.write(async (ctx) => {
      const document = await this.requireDocument(documentId)
      const deletedAt = this.now()
      for (const assignment of await this.activeAssignments(documentId)) {
        if (assignment.tagId !== tagId) continue
        await this.db.documentTags.update(assignment.id, { deletedAt })
        await this.enqueue(
          document.workspaceId,
          'document_tag',
          assignment.id,
          'delete',
          assignment.revision,
          {},
        )
        await this.touch(ctx, document)
      }
    })
  }

  // ---------------------------------------------------------------- queue & workspaces

  /** Pending operations in queue order (consumed by sync in Phase 3). */
  async pendingOperations(workspaceId?: string): Promise<Operation[]> {
    const all = await this.db.operations.orderBy('seq').toArray()
    return workspaceId ? all.filter((op) => op.workspaceId === workspaceId) : all
  }

  async pendingOperationCount(): Promise<number> {
    return this.db.operations.count()
  }

  /** Queued operations the server did not accept (conflict or rejected); they stay queued. */
  async operationsWithIssues(): Promise<QueuedOperation[]> {
    return (await this.db.operations.toArray()).filter((op) => op.issue)
  }

  /** Oldest queued operations after `afterSeq`, in creation order (sync push). */
  async queuedOperations(afterSeq: number, limit: number): Promise<QueuedOperation[]> {
    return this.db.operations.where('seq').above(afterSeq).limit(limit).toArray()
  }

  /**
   * Applies push results in one transaction: confirmed operations leave the queue and their
   * entity learns the server revision; conflicts and rejections stay queued and are marked.
   */
  async acknowledge(results: SyncPushResult[]): Promise<void> {
    const tables = this.entityTables
    await this.db.transaction('rw', CONTENT_TABLES, async () => {
      for (const result of results) {
        const op = await this.db.operations.where('opId').equals(result.opId).first()
        if (!op?.seq) continue
        if (result.status === 'conflict') {
          // The server keeps this change in a conflict object (both versions); it arrives with
          // the next pull, so the operation leaves the queue (ADR 0003).
          await this.db.operations.delete(op.seq)
        } else if (
          result.status === 'applied' ||
          result.status === 'duplicate' ||
          result.status === 'merged'
        ) {
          await this.db.operations.delete(op.seq)
          const table = tables[op.entity]
          const entity = await table.get(op.entityId)
          if (entity && (entity.revision ?? 0) < result.revision) {
            await table.update(op.entityId, { revision: result.revision })
          }
        } else {
          await this.db.operations.update(op.seq, {
            issue: {
              status: 'rejected',
              code: result.code,
              message: result.message,
              at: this.now(),
            },
          })
        }
      }
    })
  }

  // ---------------------------------------------------------------- pull

  private static cursorKey(workspaceId: string): string {
    return `syncCursor:${workspaceId}`
  }

  /** Last change-log `seq` of the workspace applied locally (0 = nothing yet). */
  async syncCursor(workspaceId: string): Promise<number> {
    const entry = await this.db.meta.get(LocalStore.cursorKey(workspaceId))
    return typeof entry?.value === 'number' ? entry.value : 0
  }

  /**
   * Applies pulled changes and stores the new cursor in one transaction (an interrupted pull
   * repeats the whole page), without creating operations. Own changes only confirm: their queue
   * entry leaves, the revision is stored. Entities with unsynced local operations stay as they
   * are; their push then meets the conflict path instead of being overwritten (principle 6).
   */
  async applyRemoteChanges(workspaceId: string, changes: Change[], cursor: number): Promise<void> {
    const ctx: WriteContext = { touched: new Map() }
    await this.db.transaction('rw', [...CONTENT_TABLES, 'meta'], async () => {
      for (const change of changes) await this.applyRemoteChange(ctx, workspaceId, change)
      await this.db.meta.put({ key: LocalStore.cursorKey(workspaceId), value: cursor })
    })
    this.notify(ctx)
  }

  private async applyRemoteConflict(ctx: WriteContext, workspaceId: string, change: Change) {
    if (change.kind === 'create') {
      const p = change.payload as ConflictCreatePayload
      const conflict: Conflict = {
        id: change.entityId,
        workspaceId,
        ...p,
        revision: change.revision,
        deletedAt: null,
      }
      await this.db.conflicts.put(conflict)
      if (p.local.deviceId === this.deviceId) await this.adoptRemote(conflict)
      if (conflict.documentId) this.mark(ctx, workspaceId, conflict.documentId)
    } else if (change.kind === 'update') {
      const p = change.payload as ConflictUpdatePayload
      const conflict = await this.db.conflicts.get(change.entityId)
      await this.db.conflicts.update(change.entityId, {
        resolution: p.resolution,
        resolvedAt: change.appliedAt,
        revision: change.revision,
      })
      if (conflict?.documentId) this.mark(ctx, workspaceId, conflict.documentId)
    }
  }

  /**
   * On the device whose change became a conflict: show the server state again (its own version
   * lives on in the conflict until the user decides). Newer local edits of the entity stay.
   */
  private async adoptRemote(conflict: Conflict) {
    if ((await this.db.operations.where('entityId').equals(conflict.entityId).count()) > 0) return
    if (conflict.remote) {
      await this.entityTables[conflict.entity].put(conflict.remote as never)
      if (conflict.entity === 'block') {
        const block = conflict.remote as unknown as Block
        const document = await this.db.documents.get(block.documentId)
        if (block.deletedAt) await this.db.links.delete(block.id)
        else if (document) await this.updateLinks(block, document)
      }
    }
    // The page was deleted elsewhere; its tombstone was held back while this device had edits.
    if (conflict.reason === 'parent_deleted' && conflict.documentId) {
      const document = await this.db.documents.get(conflict.documentId)
      if (document && !document.deletedAt) {
        await this.db.documents.update(conflict.documentId, { deletedAt: conflict.createdAt })
      }
    }
  }

  // ---------------------------------------------------------------- conflicts

  /** Open conflicts of a workspace, newest first. */
  async openConflicts(workspaceId: string): Promise<Conflict[]> {
    const all = await this.db.conflicts.where('workspaceId').equals(workspaceId).toArray()
    return all
      .filter((conflict) => !conflict.resolvedAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  /**
   * Resolves a conflict (ADR 0003), offline too: the chosen side becomes ordinary operations,
   * plus a `conflict` update operation that marks it resolved on every device. Changes on a page
   * that was deleted elsewhere come back as a copy (tombstones stay final). Returns the id of a
   * restored page, if one was created.
   */
  async resolveConflict(
    id: string,
    resolution: ConflictResolution,
    manualContent?: string,
  ): Promise<string | null> {
    return this.write(async (ctx) => {
      const conflict = await this.db.conflicts.get(id)
      if (!conflict || conflict.resolvedAt) {
        throw new LocalStoreError(`Conflict ${id} not found or already resolved`)
      }
      let restored: string | null = null
      if (resolution !== 'remote') {
        restored = await this.applyLocalSide(
          ctx,
          conflict,
          resolution === 'manual' ? manualContent : undefined,
        )
      }
      await this.db.conflicts.update(id, { resolution, resolvedAt: this.now() })
      await this.enqueue(conflict.workspaceId, 'conflict', id, 'update', conflict.revision, {
        resolution,
      })
      if (conflict.documentId) this.mark(ctx, conflict.workspaceId, conflict.documentId)
      return restored
    })
  }

  private async applyLocalSide(
    ctx: WriteContext,
    conflict: Conflict,
    manualContent: string | undefined,
  ): Promise<string | null> {
    const { kind, payload } = conflict.local
    if (conflict.reason !== 'changed') return this.restoreAsCopy(ctx, conflict, manualContent)
    if (conflict.entity === 'block') {
      const block = await this.db.blocks.get(conflict.entityId)
      if (!block || block.deletedAt) return this.restoreAsCopy(ctx, conflict, manualContent)
      if (manualContent !== undefined)
        await this.patchBlock(ctx, block.id, { content: manualContent })
      else if (kind === 'delete') await this.removeBlock(ctx, block.id)
      else if (kind === 'move') {
        const { document } = await this.requireBlock(block.id)
        await this.db.blocks.update(block.id, { sortKey: payload.sortKey as string })
        await this.enqueue(document.workspaceId, 'block', block.id, 'move', block.revision, {
          sortKey: payload.sortKey,
        })
        await this.touch(ctx, document)
      } else await this.patchBlock(ctx, block.id, payload as BlockPatch)
    } else if (conflict.entity === 'document') {
      const document = await this.db.documents.get(conflict.entityId)
      if (!document || document.deletedAt) return this.restoreAsCopy(ctx, conflict, manualContent)
      if (kind === 'delete') {
        await this.db.documents.update(document.id, { deletedAt: this.now() })
        await this.enqueue(
          document.workspaceId,
          'document',
          document.id,
          'delete',
          document.revision,
          {},
        )
      } else {
        const fields =
          manualContent !== undefined ? { title: manualContent } : (payload as Partial<Document>)
        await this.db.documents.update(document.id, fields)
        await this.enqueue(
          document.workspaceId,
          'document',
          document.id,
          kind === 'move' ? 'move' : 'update',
          document.revision,
          fields,
        )
      }
      this.mark(ctx, document.workspaceId, document.id)
    }
    // Tags and assignments: keeping the server state is the only sensible outcome.
    return null
  }

  /**
   * Brings back a page that was deleted elsewhere, with this device's change applied, as a new
   * page next to where it was (new ids: tombstones are final).
   */
  private async restoreAsCopy(
    ctx: WriteContext,
    conflict: Conflict,
    manualContent: string | undefined,
  ): Promise<string | null> {
    if (!conflict.documentId) return null
    const source = await this.db.documents.get(conflict.documentId)
    if (!source) return null
    const parent = source.parentId ? await this.db.documents.get(source.parentId) : undefined
    const local = conflict.local.payload as Record<string, unknown>
    const title =
      conflict.entity === 'document' && typeof local.title === 'string' ? local.title : source.title
    const copy = documentSchema.parse({
      id: newId(),
      workspaceId: source.workspaceId,
      parentId: parent && !parent.deletedAt ? parent.id : null,
      title: `${title} (wiederhergestellt)`.slice(0, 500),
      sortKey: LocalStore.sortKeyAt(
        (await this.listDocuments(source.workspaceId)).filter(
          (d) => d.parentId === (parent && !parent.deletedAt ? parent.id : null),
        ),
        {},
      ),
      favorite: false,
      createdAt: this.now(),
      updatedAt: this.now(),
      revision: null,
      deletedAt: null,
    } satisfies Document)
    await this.db.documents.add(copy)
    await this.enqueue(copy.workspaceId, 'document', copy.id, 'create', null, {
      parentId: copy.parentId,
      title: copy.title,
      sortKey: copy.sortKey,
      favorite: copy.favorite,
      createdAt: copy.createdAt,
    })
    const blocks = (await this.db.blocks.where('documentId').equals(source.id).toArray())
      .filter((block) => !block.deletedAt)
      .sort(compareBySortKey)
    for (const block of blocks) {
      let fields: NewBlock = { type: block.type, content: block.content, attrs: block.attrs }
      if (conflict.entity === 'block' && block.id === conflict.entityId) {
        fields =
          manualContent !== undefined
            ? { ...fields, content: manualContent }
            : { ...fields, ...(local as NewBlock) }
      }
      await this.insertBlock(ctx, copy, fields, {})
    }
    if (blocks.length === 0) await this.insertBlock(ctx, copy, {}, {})
    this.mark(ctx, copy.workspaceId, copy.id)
    return copy.id
  }

  /**
   * Full re-sync: replaces the workspace's local state with the server snapshot and stores its
   * cursor, in one transaction. Entities with queued operations keep their local state, so
   * nothing unsynced is lost; their push takes the normal (conflict) path.
   */
  async replaceWithSnapshot(workspaceId: string, snapshot: SyncSnapshotResponse): Promise<void> {
    const ctx: WriteContext = { touched: new Map() }
    await this.db.transaction('rw', [...CONTENT_TABLES, 'meta'], async () => {
      const pending = new Set((await this.db.operations.toArray()).map((op) => op.entityId))
      const keep = <T extends { id: string }>(items: T[]) => items.filter((i) => !pending.has(i.id))
      const drop = <T extends { id: string }>(items: T[]) =>
        items.filter((i) => !pending.has(i.id)).map((i) => i.id)

      const localDocuments = await this.db.documents
        .where('workspaceId')
        .equals(workspaceId)
        .toArray()
      const documentIds = [...new Set([...localDocuments, ...snapshot.documents].map((d) => d.id))]
      const localBlocks = await this.db.blocks.where('documentId').anyOf(documentIds).toArray()
      await this.db.documents.bulkDelete(drop(localDocuments))
      await this.db.blocks.bulkDelete(drop(localBlocks))
      await this.db.tags.bulkDelete(
        drop(await this.db.tags.where('workspaceId').equals(workspaceId).toArray()),
      )
      await this.db.documentTags.bulkDelete(
        drop(await this.db.documentTags.where('workspaceId').equals(workspaceId).toArray()),
      )
      await this.db.documents.bulkPut(keep(snapshot.documents))
      await this.db.blocks.bulkPut(keep(snapshot.blocks))
      await this.db.tags.bulkPut(keep(snapshot.tags))
      await this.db.documentTags.bulkPut(keep(snapshot.documentTags))
      await this.db.attachments.bulkDelete(
        drop(await this.db.attachments.where('workspaceId').equals(workspaceId).toArray()),
      )
      await this.db.attachments.bulkPut(keep(snapshot.attachments))
      await this.db.conflicts.bulkDelete(
        drop(await this.db.conflicts.where('workspaceId').equals(workspaceId).toArray()),
      )
      await this.db.conflicts.bulkPut(keep(snapshot.conflicts))

      // Derived link index: rebuild for the whole workspace.
      await this.db.links.where('workspaceId').equals(workspaceId).delete()
      const documents = new Map(
        (await this.db.documents.where('workspaceId').equals(workspaceId).toArray()).map((d) => [
          d.id,
          d,
        ]),
      )
      for (const block of await this.db.blocks
        .where('documentId')
        .anyOf([...documents.keys()])
        .toArray()) {
        if (!block.deletedAt) await this.updateLinks(block, documents.get(block.documentId)!)
      }
      for (const id of new Set([...documentIds, ...documents.keys()])) {
        this.mark(ctx, workspaceId, id)
      }
      await this.db.meta.put({ key: LocalStore.cursorKey(workspaceId), value: snapshot.cursor })
    })
    this.notify(ctx)
  }

  private async applyRemoteChange(ctx: WriteContext, workspaceId: string, change: Change) {
    if (change.entity === 'conflict') {
      await this.applyRemoteConflict(ctx, workspaceId, change)
      return
    }
    const table = this.entityTables[change.entity]
    const local = await table.get(change.entityId)
    const queued = await this.db.operations.where('opId').equals(change.opId).first()
    if (queued?.seq !== undefined) await this.db.operations.delete(queued.seq)
    if (queued || change.deviceId === this.deviceId) {
      if (local && (local.revision ?? 0) < change.revision) {
        await table.update(change.entityId, { revision: change.revision })
      }
      return
    }
    if ((await this.db.operations.where('entityId').equals(change.entityId).count()) > 0) return
    // A page deleted elsewhere stays while this device has unsynced edits in it (T-DEL-02):
    // their push becomes a visible conflict instead of disappearing with the page.
    if (change.entity === 'document' && change.kind === 'delete') {
      const blockIds = await this.db.blocks
        .where('documentId')
        .equals(change.entityId)
        .primaryKeys()
      if ((await this.db.operations.where('entityId').anyOf(blockIds).count()) > 0) return
    }
    const invalid = validateOperationPayload(change.entity, change.kind, change.payload)
    if (invalid) {
      console.warn('Skipping invalid change', change.seq, invalid)
      return
    }
    const revision = change.revision
    switch (change.entity) {
      case 'document': {
        if (change.kind === 'create') {
          const p = change.payload as DocumentCreatePayload
          await this.db.documents.put({
            id: change.entityId,
            workspaceId,
            parentId: p.parentId,
            title: p.title,
            sortKey: p.sortKey,
            favorite: p.favorite,
            createdAt: p.createdAt,
            updatedAt: change.appliedAt,
            revision,
            deletedAt: null,
          })
        } else if (local) {
          const fields =
            change.kind === 'delete'
              ? { deletedAt: change.appliedAt }
              : { ...(change.payload as Partial<Document>), updatedAt: change.appliedAt }
          await this.db.documents.update(change.entityId, { ...fields, revision })
        }
        this.mark(ctx, workspaceId, change.entityId)
        return
      }
      case 'block': {
        let block: Block | undefined
        if (change.kind === 'create') {
          const p = change.payload as BlockCreatePayload
          block = {
            id: change.entityId,
            documentId: p.documentId,
            type: p.type,
            content: p.content,
            attrs: p.attrs,
            sortKey: p.sortKey,
            revision,
            deletedAt: null,
          }
        } else if (local) {
          const fields = change.kind === 'delete' ? { deletedAt: change.appliedAt } : change.payload
          block = { ...(local as Block), ...fields, revision }
        }
        if (!block) return
        await this.db.blocks.put(block)
        const document = await this.db.documents.get(block.documentId)
        if (block.deletedAt) await this.db.links.delete(block.id)
        else if (document) await this.updateLinks(block, document)
        this.mark(ctx, workspaceId, block.documentId)
        return
      }
      case 'tag': {
        if (change.kind === 'create') {
          const p = change.payload as TagCreatePayload
          await this.db.tags.put({
            id: change.entityId,
            workspaceId,
            name: p.name,
            revision,
            deletedAt: null,
          })
        } else if (local) {
          const fields = change.kind === 'delete' ? { deletedAt: change.appliedAt } : change.payload
          await this.db.tags.update(change.entityId, { ...fields, revision })
        }
        return
      }
      case 'attachment': {
        if (change.kind === 'create') {
          const p = change.payload as AttachmentCreatePayload
          await this.db.attachments.put({
            id: change.entityId,
            workspaceId,
            ...p,
            revision,
            deletedAt: null,
          })
          this.mark(ctx, workspaceId, p.documentId)
        } else if (local) {
          await this.db.attachments.update(change.entityId, {
            deletedAt: change.appliedAt,
            revision,
          })
          // The content is no longer needed on this device.
          await this.db.attachmentContents.delete(change.entityId)
          this.mark(ctx, workspaceId, (local as Attachment).documentId)
        }
        return
      }
      case 'document_tag': {
        let documentId = (local as DocumentTag | undefined)?.documentId
        if (change.kind === 'create') {
          const p = change.payload as DocumentTagCreatePayload
          documentId = p.documentId
          await this.db.documentTags.put({
            id: change.entityId,
            workspaceId,
            documentId: p.documentId,
            tagId: p.tagId,
            revision,
            deletedAt: null,
          })
        } else if (local) {
          await this.db.documentTags.update(change.entityId, {
            deletedAt: change.appliedAt,
            revision,
          })
        }
        if (documentId) this.mark(ctx, workspaceId, documentId)
      }
    }
  }

  // ---------------------------------------------------------------- attachments

  /**
   * Adds a file to a page (ADR 0012), offline too: content stays on this device until it is
   * uploaded after the sync confirmed the metadata. Inserts an image block for raster images,
   * otherwise a file block. `sha256` must be computed beforehand (see `sha256Hex`): awaiting
   * crypto inside a Dexie transaction would commit it early.
   */
  async addAttachment(
    documentId: string,
    file: { name: string; type: string; data: ArrayBuffer; sha256: string },
    position: Position = {},
  ): Promise<{ attachment: Attachment; block: Block }> {
    return this.write(async (ctx) => {
      const document = await this.requireDocument(documentId)
      const attachment = attachmentSchema.parse({
        id: newId(),
        workspaceId: document.workspaceId,
        documentId,
        name: file.name.trim().slice(0, 255) || 'Datei',
        mimeType: /^[\w.+-]+\/[\w.+-]+$/.test(file.type) ? file.type : 'application/octet-stream',
        size: file.data.byteLength,
        sha256: file.sha256,
        createdAt: this.now(),
        revision: null,
        deletedAt: null,
      } satisfies Attachment)
      await this.db.attachments.add(attachment)
      await this.db.attachmentContents.put({ id: attachment.id, data: file.data, uploaded: false })
      await this.enqueue(document.workspaceId, 'attachment', attachment.id, 'create', null, {
        documentId,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
        sha256: attachment.sha256,
        createdAt: attachment.createdAt,
      })
      const image = INLINE_IMAGE_TYPES.includes(attachment.mimeType)
      const block = await this.insertBlock(
        ctx,
        document,
        {
          type: image ? 'image' : 'file',
          content: image ? '' : attachment.name,
          attrs: { attachmentId: attachment.id },
        },
        position,
      )
      return { attachment, block }
    })
  }

  /** Deletes an attachment (tombstone, replicated); its block shows it as removed. */
  async deleteAttachment(id: string): Promise<void> {
    await this.write(async (ctx) => {
      const attachment = await this.db.attachments.get(id)
      if (!attachment || attachment.deletedAt) return
      await this.db.attachments.update(id, { deletedAt: this.now() })
      await this.db.attachmentContents.delete(id)
      await this.enqueue(
        attachment.workspaceId,
        'attachment',
        id,
        'delete',
        attachment.revision,
        {},
      )
      this.mark(ctx, attachment.workspaceId, attachment.documentId)
    })
  }

  async getAttachment(id: string): Promise<Attachment | undefined> {
    return this.db.attachments.get(id)
  }

  async attachmentContent(id: string): Promise<AttachmentContent | undefined> {
    return this.db.attachmentContents.get(id)
  }

  /** Keeps downloaded content for offline use. */
  async cacheAttachmentContent(id: string, data: ArrayBuffer): Promise<void> {
    await this.db.attachmentContents.put({ id, data, uploaded: true })
  }

  /** Contents waiting for upload whose metadata the server already knows. */
  async pendingUploads(): Promise<Attachment[]> {
    const contents = await this.db.attachmentContents.toArray()
    const waiting = contents.filter((content) => !content.uploaded).map((content) => content.id)
    const attachments = await this.db.attachments.bulkGet(waiting)
    return attachments.filter((a): a is Attachment => !!a && a.revision !== null && !a.deletedAt)
  }

  async markUploaded(id: string): Promise<void> {
    await this.db.attachmentContents.update(id, { uploaded: true })
  }

  async cacheWorkspaces(workspaces: Workspace[]): Promise<void> {
    await this.db.transaction('rw', this.db.workspaces, async () => {
      await this.db.workspaces.clear()
      await this.db.workspaces.bulkPut(workspaces)
    })
  }

  async cachedWorkspaces(): Promise<Workspace[]> {
    const workspaces = await this.db.workspaces.toArray()
    return workspaces.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }
}

function byTitle(a: Document, b: Document): number {
  return a.title.localeCompare(b.title) || compareBySortKey(a, b)
}

function sameAttrs(a: BlockAttrs, b: BlockAttrs): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof BlockAttrs>
  for (const key of keys) if (a[key] !== b[key]) return false
  return true
}

/** Hex SHA-256 of a file, as the server verifies it (ADR 0012). */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
