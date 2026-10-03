import {
  type BlockCreatePayload,
  type BlockMovePayload,
  type BlockUpdatePayload,
  type DocumentCreatePayload,
  type DocumentMovePayload,
  type DocumentTagCreatePayload,
  type DocumentUpdatePayload,
  type Operation,
  type TagCreatePayload,
  validateOperationPayload,
} from '@notion-alt/shared'
import type { Db } from '../db/database'
import { findActiveDevice } from '../devices/repository'
import { reindexDocument } from '../search/index'
import { findWorkspaceForUser } from '../workspaces/repository'

export type RejectCode =
  | 'workspace_not_found'
  | 'device_not_active'
  | 'op_id_reused'
  | 'invalid_payload'
  | 'not_found'
  | 'already_exists'
  | 'deleted'

/** `changed`/`deleted`: the entity itself; `parent_deleted`: the document it belongs to. */
export type ConflictReason = 'changed' | 'deleted' | 'parent_deleted'

export type ApplyResult =
  | { status: 'applied'; revision: number; seq: number }
  /** Already applied earlier (same `opId`): the original result, nothing written. */
  | { status: 'duplicate'; revision: number; seq: number }
  /**
   * Another device changed the entity after `baseRevision`: nothing is written. Never
   * overwritten silently (principle 6); block merge and conflict objects (ADR 0003) build on this.
   */
  | { status: 'conflict'; currentRevision: number; reason: ConflictReason }
  | { status: 'rejected'; code: RejectCode; message: string }

class Stop extends Error {
  constructor(readonly result: ApplyResult) {
    super(result.status)
  }
}

function reject(code: RejectCode, message: string): never {
  throw new Stop({ status: 'rejected', code, message })
}

interface Versioned {
  workspace_id: string
  revision: number
  deleted_at: string | null
}

function conflict(currentRevision: number, reason: ConflictReason): never {
  throw new Stop({ status: 'conflict', currentRevision, reason })
}

/** Change-log entry that deleted the entity, if any. */
async function deletion(db: Db, op: Operation) {
  return db
    .selectFrom('changes')
    .select(['seq', 'device_id', 'revision'])
    .where('workspace_id', '=', op.workspaceId)
    .where('entity', '=', op.entity)
    .where('entity_id', '=', op.entityId)
    .where('kind', '=', 'delete')
    .orderBy('seq', 'desc')
    .limit(1)
    .executeTakeFirst()
}

/**
 * Whether another device changed the entity after `baseRevision`. Changes of the operation's own
 * device do not count: its queued operations build on each other (e.g. create, then update with
 * the same, still unsynced base) and were made with those changes in view.
 */
async function changedByOthers(db: Db, op: Operation, baseRevision: number): Promise<boolean> {
  const other = await db
    .selectFrom('changes')
    .select('seq')
    .where('workspace_id', '=', op.workspaceId)
    .where('entity', '=', op.entity)
    .where('entity_id', '=', op.entityId)
    .where('revision', '>', baseRevision)
    .where('device_id', '!=', op.deviceId)
    .limit(1)
    .executeTakeFirst()
  return !!other
}

/**
 * Checks an operation against the stored entity and returns the revision it will get.
 * Entities of other workspaces are reported as missing, never revealed.
 */
async function nextRevision(
  db: Db,
  op: Operation,
  existing: Versioned | undefined,
): Promise<number> {
  if (existing && existing.workspace_id !== op.workspaceId) reject('not_found', 'Entity not found')
  if (op.kind === 'create') {
    if (existing) reject('already_exists', 'Entity already exists')
    if (op.baseRevision !== null) reject('invalid_payload', 'create has no base revision')
    return 1
  }
  if (!existing) reject('not_found', 'Entity not found')
  if (existing.deleted_at) {
    const deleted = await deletion(db, op)
    // Deleting again has the same effect: answer like the original deletion.
    if (op.kind === 'delete' && deleted) {
      throw new Stop({ status: 'duplicate', revision: existing.revision, seq: deleted.seq })
    }
    // Edited on this device while another one deleted it (T-DEL-02): visible, never lost.
    if (deleted && deleted.device_id !== op.deviceId) conflict(existing.revision, 'deleted')
    reject('deleted', 'Entity is deleted')
  }
  const base = op.baseRevision ?? 0
  if (base > existing.revision) reject('invalid_payload', 'Base revision is ahead of the server')
  if (base < existing.revision && (await changedByOthers(db, op, base))) {
    conflict(existing.revision, 'changed')
  }
  return existing.revision + 1
}

async function requireDocumentIn(db: Db, workspaceId: string, id: string, what: string) {
  const document = await db
    .selectFrom('documents')
    .select(['id', 'parent_id', 'revision', 'deleted_at'])
    .where('id', '=', id)
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst()
  if (!document) reject('not_found', `${what} not found`)
  return document
}

/** A page must not become its own ancestor. */
async function assertNoCycle(db: Db, workspaceId: string, id: string, parentId: string | null) {
  let current = parentId
  while (current) {
    if (current === id) reject('invalid_payload', 'A page cannot be moved below itself')
    current = (await requireDocumentIn(db, workspaceId, current, 'Parent')).parent_id
  }
}

async function applyDocument(db: Db, op: Operation, now: string): Promise<number> {
  const existing = await db
    .selectFrom('documents')
    .selectAll()
    .where('id', '=', op.entityId)
    .executeTakeFirst()
  const revision = await nextRevision(db, op, existing)
  switch (op.kind) {
    case 'create': {
      const p = op.payload as DocumentCreatePayload
      await assertNoCycle(db, op.workspaceId, op.entityId, p.parentId)
      await db
        .insertInto('documents')
        .values({
          id: op.entityId,
          workspace_id: op.workspaceId,
          parent_id: p.parentId,
          title: p.title,
          sort_key: p.sortKey,
          favorite: p.favorite ? 1 : 0,
          created_at: p.createdAt,
          updated_at: now,
          revision,
          deleted_at: null,
        })
        .execute()
      return revision
    }
    case 'update': {
      const p = op.payload as DocumentUpdatePayload
      await db
        .updateTable('documents')
        .set({
          ...(p.title !== undefined && { title: p.title }),
          ...(p.favorite !== undefined && { favorite: p.favorite ? 1 : 0 }),
          updated_at: now,
          revision,
        })
        .where('id', '=', op.entityId)
        .execute()
      return revision
    }
    case 'move': {
      const p = op.payload as DocumentMovePayload
      await assertNoCycle(db, op.workspaceId, op.entityId, p.parentId)
      await db
        .updateTable('documents')
        .set({ parent_id: p.parentId, sort_key: p.sortKey, updated_at: now, revision })
        .where('id', '=', op.entityId)
        .execute()
      return revision
    }
    case 'delete':
      await db
        .updateTable('documents')
        .set({ deleted_at: now, updated_at: now, revision })
        .where('id', '=', op.entityId)
        .execute()
      return revision
  }
}

/**
 * Content of a page that another device deleted must not vanish into the tombstone: changes to
 * its blocks or tags become a conflict (T-DEL-02). Deleting them along is fine.
 */
async function assertDocumentAlive(db: Db, op: Operation, documentId: string) {
  if (op.kind === 'delete') return
  const document = await requireDocumentIn(db, op.workspaceId, documentId, 'Document')
  if (document.deleted_at) conflict(document.revision, 'parent_deleted')
}

async function applyBlock(db: Db, op: Operation, now: string): Promise<number> {
  const existing = await db
    .selectFrom('blocks')
    .selectAll()
    .where('id', '=', op.entityId)
    .executeTakeFirst()
  if (existing && existing.workspace_id === op.workspaceId) {
    await assertDocumentAlive(db, op, existing.document_id)
  }
  const revision = await nextRevision(db, op, existing)
  switch (op.kind) {
    case 'create': {
      const p = op.payload as BlockCreatePayload
      await assertDocumentAlive(db, op, p.documentId)
      await db
        .insertInto('blocks')
        .values({
          id: op.entityId,
          workspace_id: op.workspaceId,
          document_id: p.documentId,
          type: p.type,
          content: p.content,
          attrs: JSON.stringify(p.attrs),
          sort_key: p.sortKey,
          revision,
          deleted_at: null,
        })
        .execute()
      return revision
    }
    case 'update': {
      const p = op.payload as BlockUpdatePayload
      await db
        .updateTable('blocks')
        .set({
          ...(p.type !== undefined && { type: p.type }),
          ...(p.content !== undefined && { content: p.content }),
          ...(p.attrs !== undefined && { attrs: JSON.stringify(p.attrs) }),
          revision,
        })
        .where('id', '=', op.entityId)
        .execute()
      return revision
    }
    case 'move': {
      const p = op.payload as BlockMovePayload
      await db
        .updateTable('blocks')
        .set({ sort_key: p.sortKey, revision })
        .where('id', '=', op.entityId)
        .execute()
      return revision
    }
    case 'delete':
      await db
        .updateTable('blocks')
        .set({ deleted_at: now, revision })
        .where('id', '=', op.entityId)
        .execute()
      return revision
  }
}

async function applyTag(db: Db, op: Operation, now: string): Promise<number> {
  const existing = await db
    .selectFrom('tags')
    .selectAll()
    .where('id', '=', op.entityId)
    .executeTakeFirst()
  const revision = await nextRevision(db, op, existing)
  if (op.kind === 'create') {
    const p = op.payload as TagCreatePayload
    await db
      .insertInto('tags')
      .values({
        id: op.entityId,
        workspace_id: op.workspaceId,
        name: p.name,
        revision,
        deleted_at: null,
      })
      .execute()
  } else if (op.kind === 'update') {
    const p = op.payload as TagCreatePayload
    await db
      .updateTable('tags')
      .set({ name: p.name, revision })
      .where('id', '=', op.entityId)
      .execute()
  } else {
    await db
      .updateTable('tags')
      .set({ deleted_at: now, revision })
      .where('id', '=', op.entityId)
      .execute()
  }
  return revision
}

async function applyDocumentTag(db: Db, op: Operation, now: string): Promise<number> {
  const existing = await db
    .selectFrom('document_tags')
    .selectAll()
    .where('id', '=', op.entityId)
    .executeTakeFirst()
  const revision = await nextRevision(db, op, existing)
  if (op.kind === 'create') {
    const p = op.payload as DocumentTagCreatePayload
    await assertDocumentAlive(db, op, p.documentId)
    const tag = await db
      .selectFrom('tags')
      .select('id')
      .where('id', '=', p.tagId)
      .where('workspace_id', '=', op.workspaceId)
      .executeTakeFirst()
    if (!tag) reject('not_found', 'Tag not found')
    await db
      .insertInto('document_tags')
      .values({
        id: op.entityId,
        workspace_id: op.workspaceId,
        document_id: p.documentId,
        tag_id: p.tagId,
        revision,
        deleted_at: null,
      })
      .execute()
  } else {
    await db
      .updateTable('document_tags')
      .set({ deleted_at: now, revision })
      .where('id', '=', op.entityId)
      .execute()
  }
  return revision
}

const appliers = {
  document: applyDocument,
  block: applyBlock,
  tag: applyTag,
  document_tag: applyDocumentTag,
}

/** Page whose search entry the operation changes (documents and their blocks). */
async function indexedDocument(db: Db, op: Operation): Promise<string | null> {
  if (op.entity === 'document') return op.entityId
  if (op.entity !== 'block') return null
  const block = await db
    .selectFrom('blocks')
    .select('document_id')
    .where('id', '=', op.entityId)
    .executeTakeFirst()
  return block?.document_id ?? null
}

async function nextSeq(db: Db, workspaceId: string): Promise<number> {
  const row = await db
    .selectFrom('changes')
    .select((eb) => eb.fn.max('seq').as('max'))
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst()
  const floor = await db
    .selectFrom('workspaces')
    .select('compacted_seq')
    .where('id', '=', workspaceId)
    .executeTakeFirstOrThrow()
  // After compaction the log may be empty; numbering continues above the removed part.
  return Math.max(Number(row?.max ?? 0), floor.compacted_seq) + 1
}

/**
 * Applies one client operation: entity change and change-log entry in one SQLite transaction,
 * idempotent by `opId` (ADR 0002). Scoped to the user's workspaces and active devices.
 */
export async function applyOperation(
  db: Db,
  userId: string,
  op: Operation,
  now: string = new Date().toISOString(),
): Promise<ApplyResult> {
  try {
    return await db.transaction().execute(async (trx) => {
      if (!(await findWorkspaceForUser(trx, op.workspaceId, userId))) {
        reject('workspace_not_found', 'Workspace not found')
      }
      if (!(await findActiveDevice(trx, userId, op.deviceId))) {
        reject('device_not_active', 'Device is not registered or was removed')
      }
      const previous = await trx
        .selectFrom('changes')
        .select(['workspace_id', 'entity', 'entity_id', 'seq', 'revision'])
        .where('op_id', '=', op.opId)
        .executeTakeFirst()
      if (previous) {
        const same =
          previous.workspace_id === op.workspaceId &&
          previous.entity === op.entity &&
          previous.entity_id === op.entityId
        if (!same) reject('op_id_reused', 'Operation id was used for another change')
        return { status: 'duplicate', revision: previous.revision, seq: previous.seq }
      }
      const invalid = validateOperationPayload(op.entity, op.kind, op.payload)
      if (invalid) reject('invalid_payload', invalid)

      const revision = await appliers[op.entity](trx, op, now)
      const indexed = await indexedDocument(trx, op)
      if (indexed) await reindexDocument(trx, indexed)
      const seq = await nextSeq(trx, op.workspaceId)
      await trx
        .insertInto('changes')
        .values({
          workspace_id: op.workspaceId,
          seq,
          op_id: op.opId,
          device_id: op.deviceId,
          entity: op.entity,
          entity_id: op.entityId,
          kind: op.kind,
          revision,
          payload: JSON.stringify(op.payload),
          applied_at: now,
        })
        .execute()
      return { status: 'applied', revision, seq }
    })
  } catch (error) {
    if (error instanceof Stop) return error.result
    throw error
  }
}
