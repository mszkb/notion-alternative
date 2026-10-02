import {
  type Block,
  type BlockAttrs,
  type BlockType,
  blockSchema,
  compareBySortKey,
  type Document,
  type DocumentTag,
  documentSchema,
  documentTitleSchema,
  extractPageLinks,
  newId,
  type Operation,
  type OperationEntity,
  type OperationKind,
  sortKeyBetween,
  type Tag,
  tagNameSchema,
  tagSchema,
  type Workspace,
} from '@notion-alt/shared'
import type { LocalDb } from './db'

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
  type?: BlockType
  content?: string
  attrs?: BlockAttrs
}

export type BlockPatch = Partial<Pick<Block, 'type' | 'content' | 'attrs'>>

interface WriteContext {
  touched: Map<string, Set<string>>
}

const CONTENT_TABLES = ['documents', 'blocks', 'tags', 'documentTags', 'operations', 'links']

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
    for (const [workspaceId, ids] of ctx.touched) {
      const change = { workspaceId, documentIds: [...ids] }
      for (const listener of this.listeners) listener(change)
    }
    return result
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
    return sortKeyBetween(list[index]!.sortKey, list[index + 1]?.sortKey ?? null)
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
      id: newId(),
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

  async moveBlock(id: string, position: Position): Promise<void> {
    await this.write(async (ctx) => {
      const { block, document } = await this.requireBlock(id)
      const sortKey = LocalStore.sortKeyAt(await this.listBlocks(document.id), position, id)
      if (sortKey === block.sortKey) return
      await this.db.blocks.update(id, { sortKey })
      await this.enqueue(document.workspaceId, 'block', id, 'move', block.revision, { sortKey })
      await this.touch(ctx, document)
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

  /** Replaces the cached workspace list with the server's (read-only cache, not synced). */
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
