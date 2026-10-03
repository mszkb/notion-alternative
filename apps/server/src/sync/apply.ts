import { randomUUID } from 'node:crypto'
import {
  type AttachmentCreatePayload,
  type BlockCreatePayload,
  type BlockMovePayload,
  type BlockUpdatePayload,
  type ConflictCreatePayload,
  type ConflictReason,
  type ConflictUpdatePayload,
  type DocumentCreatePayload,
  type DocumentMovePayload,
  type DocumentTagCreatePayload,
  type DocumentUpdatePayload,
  type Operation,
  type TagCreatePayload,
  validateOperationPayload,
} from '@notion-alt/shared'
import type { SelectQueryBuilder } from 'kysely'
import type { Db } from '../db/database'
import type { Database } from '../db/schema'
import { findActiveDevice } from '../devices/repository'
import { markForReindex } from '../search/index'
import { findWorkspaceForUser } from '../workspaces/repository'
import { toAttachment, toBlock, toDocument, toDocumentTag, toTag } from './mapping'

export type RejectCode =
  | 'workspace_not_found'
  | 'device_not_active'
  | 'op_id_reused'
  | 'invalid_payload'
  | 'not_found'
  | 'already_exists'
  | 'deleted'
  | 'too_large'
  | 'quota_exceeded'

export type ApplyResult =
  | { status: 'applied'; revision: number; seq: number }
  /** Applied; another device changed other fields of the entity meanwhile (ADR 0003 merge). */
  | { status: 'merged'; revision: number; seq: number }
  /** Already applied earlier (same `opId`): the original result, nothing written. */
  | { status: 'duplicate'; revision: number; seq: number }
  /**
   * Another device changed the same field, or deleted the entity or its page: the change is not
   * applied but kept in a conflict object with both versions (ADR 0003, principle 6).
   */
  | { status: 'conflict'; currentRevision: number; reason: ConflictReason; conflictId: string }
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

/** Raised before anything is written; turned into a conflict object, not a rollback. */
class ConflictFound extends Error {
  constructor(
    readonly currentRevision: number,
    readonly reason: ConflictReason,
  ) {
    super('conflict')
  }
}

function conflict(currentRevision: number, reason: ConflictReason): never {
  throw new ConflictFound(currentRevision, reason)
}

interface ApplyContext {
  /** Set when the operation was merged with another device's change to other fields. */
  merged: boolean
  limits: AttachmentLimits
}

/** Operator limits for attachments (#64); no feature locks, only capacity. */
export interface AttachmentLimits {
  maxBytes: number
  workspaceQuotaBytes: number | null
}

const NO_LIMITS: AttachmentLimits = {
  maxBytes: Number.POSITIVE_INFINITY,
  workspaceQuotaBytes: null,
}

/** Bytes taken by a workspace's attachments (deleted ones no longer count). */
/**
 * Attachment storage of the account owning `workspaceId` (all its workspaces, #74): active
 * attachments plus deleted ones whose file is still kept for the retention period. Counting per
 * account and including kept files means neither more workspaces nor delete-and-upload cycles
 * get around the limit.
 */
export async function attachmentUsage(db: Db, workspaceId: string) {
  const owner = db.selectFrom('workspaces').select('owner_id').where('id', '=', workspaceId)
  return accountAttachmentUsage(db, owner)
}

export async function accountAttachmentUsage(
  db: Db,
  ownerId: string | SelectQueryBuilder<Database, 'workspaces', { owner_id: string }>,
) {
  const row = await db
    .selectFrom('attachments')
    .innerJoin('workspaces', 'workspaces.id', 'attachments.workspace_id')
    .select((eb) => [
      eb.fn.sum<number>('attachments.size').as('bytes'),
      eb.fn
        .sum<number>(eb.case().when('attachments.deleted_at', 'is', null).then(1).else(0).end())
        .as('count'),
    ])
    .where('workspaces.owner_id', '=', ownerId)
    .where((eb) =>
      eb.or([
        eb('attachments.deleted_at', 'is', null),
        eb('attachments.stored_at', 'is not', null),
      ]),
    )
    .executeTakeFirst()
  return { usedBytes: Number(row?.bytes ?? 0), count: Number(row?.count ?? 0) }
}

/** Fields an operation changes; `*` for create/delete (they touch everything). */
function touchedFields(kind: string, payload: Record<string, unknown>): string[] {
  return kind === 'update' || kind === 'move' ? Object.keys(payload) : ['*']
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
 * Fields other devices changed on the entity after `baseRevision` (empty: none). Changes of the
 * operation's own device do not count: its queued operations build on each other (e.g. create,
 * then update with the same, still unsynced base) and were made with those changes in view.
 */
async function fieldsChangedByOthers(
  db: Db,
  op: Operation,
  baseRevision: number,
): Promise<Set<string>> {
  const rows = await db
    .selectFrom('changes')
    .select(['kind', 'payload'])
    .where('workspace_id', '=', op.workspaceId)
    .where('entity', '=', op.entity)
    .where('entity_id', '=', op.entityId)
    .where('revision', '>', baseRevision)
    .where('device_id', '!=', op.deviceId)
    .execute()
  return new Set(rows.flatMap((row) => touchedFields(row.kind, JSON.parse(row.payload))))
}

/**
 * Checks an operation against the stored entity and returns the revision it will get.
 * Entities of other workspaces are reported as missing, never revealed.
 */
async function nextRevision(
  db: Db,
  op: Operation,
  existing: Versioned | undefined,
  ctx: ApplyContext,
): Promise<number> {
  if (existing && existing.workspace_id !== op.workspaceId) reject('not_found', 'Entity not found')
  if (op.kind === 'create') {
    if (existing) reject('already_exists', 'Entity already exists')
    if (op.baseRevision !== null) reject('invalid_payload', 'create has no base revision')
    return 1
  }
  if (!existing) reject('not_found', 'Entity not found')
  if (op.kind === 'restore') {
    if (existing.deleted_at) return existing.revision + 1
    // Already restored (e.g. by another device): same outcome.
    const last = await db
      .selectFrom('changes')
      .select('seq')
      .where('workspace_id', '=', op.workspaceId)
      .where('entity', '=', op.entity)
      .where('entity_id', '=', op.entityId)
      .orderBy('seq', 'desc')
      .executeTakeFirstOrThrow()
    throw new Stop({ status: 'duplicate', revision: existing.revision, seq: last.seq })
  }
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
  if (base < existing.revision) {
    const theirs = await fieldsChangedByOthers(db, op, base)
    if (theirs.size > 0) {
      // Merge rule (ADR 0003): disjoint fields of the same entity merge, e.g. a move and a text
      // edit of one block, or title and favourite of one page. The same field, or a create or
      // delete on either side, is a conflict.
      const mine = touchedFields(op.kind, op.payload)
      const overlap = theirs.has('*') || mine.some((field) => field === '*' || theirs.has(field))
      if (overlap) conflict(existing.revision, 'changed')
      ctx.merged = true
    }
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

/**
 * A page must not become its own ancestor. Also stops on a cycle that already exists among the
 * ancestors (never created by the server, but data must not make this loop forever).
 */
async function assertNoCycle(db: Db, workspaceId: string, id: string, parentId: string | null) {
  const seen = new Set<string>()
  let current = parentId
  while (current) {
    if (current === id) reject('invalid_payload', 'A page cannot be moved below itself')
    if (seen.has(current)) reject('invalid_payload', 'The page tree contains a cycle')
    seen.add(current)
    current = (await requireDocumentIn(db, workspaceId, current, 'Parent')).parent_id
  }
}

async function applyDocument(
  db: Db,
  op: Operation,
  now: string,
  ctx: ApplyContext,
): Promise<number> {
  const existing = await db
    .selectFrom('documents')
    .selectAll()
    .where('id', '=', op.entityId)
    .executeTakeFirst()
  const revision = await nextRevision(db, op, existing, ctx)
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
    case 'restore':
      // Lifts the tombstone (trash, #66). Blocks, tags and links of a deleted page were never
      // tombstoned (sync.md), so the page comes back complete under its old id.
      await db
        .updateTable('documents')
        .set({ deleted_at: null, updated_at: now, revision })
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

async function applyBlock(db: Db, op: Operation, now: string, ctx: ApplyContext): Promise<number> {
  const existing = await db
    .selectFrom('blocks')
    .selectAll()
    .where('id', '=', op.entityId)
    .executeTakeFirst()
  if (existing && existing.workspace_id === op.workspaceId) {
    await assertDocumentAlive(db, op, existing.document_id)
  }
  const revision = await nextRevision(db, op, existing, ctx)
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
    case 'restore':
      // Not allowed by the payload schemas; blocks come back with their page.
      reject('invalid_payload', 'Blocks cannot be restored')
  }
}

async function applyTag(db: Db, op: Operation, now: string, ctx: ApplyContext): Promise<number> {
  const existing = await db
    .selectFrom('tags')
    .selectAll()
    .where('id', '=', op.entityId)
    .executeTakeFirst()
  const revision = await nextRevision(db, op, existing, ctx)
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

async function applyDocumentTag(
  db: Db,
  op: Operation,
  now: string,
  ctx: ApplyContext,
): Promise<number> {
  const existing = await db
    .selectFrom('document_tags')
    .selectAll()
    .where('id', '=', op.entityId)
    .executeTakeFirst()
  const revision = await nextRevision(db, op, existing, ctx)
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

/** Attachment metadata (ADR 0012); the content is uploaded separately and never changes. */
async function applyAttachment(
  db: Db,
  op: Operation,
  now: string,
  ctx: ApplyContext,
): Promise<number> {
  const existing = await db
    .selectFrom('attachments')
    .selectAll()
    .where('id', '=', op.entityId)
    .executeTakeFirst()
  if (existing && existing.workspace_id === op.workspaceId) {
    await assertDocumentAlive(db, op, existing.document_id)
  }
  const revision = await nextRevision(db, op, existing, ctx)
  if (op.kind === 'create') {
    const p = op.payload as AttachmentCreatePayload
    await assertDocumentAlive(db, op, p.documentId)
    // Rejected, not dropped: the client keeps the file and shows why (#64).
    if (p.size > ctx.limits.maxBytes) {
      reject('too_large', `File exceeds ${ctx.limits.maxBytes} bytes`)
    }
    const quota = ctx.limits.workspaceQuotaBytes
    if (quota !== null && (await attachmentUsage(db, op.workspaceId)).usedBytes + p.size > quota) {
      reject('quota_exceeded', 'Workspace storage limit reached')
    }
    await db
      .insertInto('attachments')
      .values({
        id: op.entityId,
        workspace_id: op.workspaceId,
        document_id: p.documentId,
        name: p.name,
        mime_type: p.mimeType,
        size: p.size,
        sha256: p.sha256,
        created_at: p.createdAt,
        stored_at: null,
        revision,
        deleted_at: null,
      })
      .execute()
  } else {
    // Tombstone; the file is removed after the retention period (purgeDeletedAttachments).
    await db
      .updateTable('attachments')
      .set({ deleted_at: now, revision })
      .where('id', '=', op.entityId)
      .execute()
  }
  return revision
}

/** Resolving a conflict (the only conflict operation clients send). */
async function applyConflict(db: Db, op: Operation, now: string): Promise<number> {
  const existing = await db
    .selectFrom('conflicts')
    .selectAll()
    .where('id', '=', op.entityId)
    .where('workspace_id', '=', op.workspaceId)
    .executeTakeFirst()
  if (!existing) reject('not_found', 'Conflict not found')
  if (existing.resolved_at) {
    // Another device resolved it first: same outcome for this one (no conflict on a conflict).
    const resolved = await db
      .selectFrom('changes')
      .select('seq')
      .where('entity', '=', 'conflict')
      .where('entity_id', '=', op.entityId)
      .where('kind', '=', 'update')
      .orderBy('seq', 'desc')
      .executeTakeFirstOrThrow()
    throw new Stop({ status: 'duplicate', revision: existing.revision, seq: resolved.seq })
  }
  const { resolution } = op.payload as ConflictUpdatePayload
  const revision = existing.revision + 1
  await db
    .updateTable('conflicts')
    .set({ resolved_at: now, resolution, revision })
    .where('id', '=', op.entityId)
    .execute()
  return revision
}

const appliers = {
  document: applyDocument,
  block: applyBlock,
  tag: applyTag,
  document_tag: applyDocumentTag,
  attachment: applyAttachment,
  conflict: applyConflict,
}

/** Current server state of the entity, as the "remote" side of a conflict. */
async function remoteState(db: Db, op: Operation): Promise<Record<string, unknown> | null> {
  const id = op.entityId
  switch (op.entity) {
    case 'document': {
      const row = await db
        .selectFrom('documents')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst()
      return row ? toDocument(row) : null
    }
    case 'block': {
      const row = await db.selectFrom('blocks').selectAll().where('id', '=', id).executeTakeFirst()
      return row ? toBlock(row) : null
    }
    case 'tag': {
      const row = await db.selectFrom('tags').selectAll().where('id', '=', id).executeTakeFirst()
      return row ? toTag(row) : null
    }
    case 'document_tag': {
      const row = await db
        .selectFrom('document_tags')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst()
      return row ? toDocumentTag(row) : null
    }
    case 'attachment': {
      const row = await db
        .selectFrom('attachments')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst()
      return row ? toAttachment(row) : null
    }
    default:
      return null
  }
}

/** Page a conflicting operation belongs to (for display). */
async function conflictDocument(db: Db, op: Operation): Promise<string | null> {
  if (op.entity === 'document') return op.entityId
  if (typeof op.payload.documentId === 'string') return op.payload.documentId
  const tables = {
    block: 'blocks',
    document_tag: 'document_tags',
    attachment: 'attachments',
  } as const
  const table = op.entity in tables ? tables[op.entity as keyof typeof tables] : null
  if (!table) return null
  const row = await db
    .selectFrom(table)
    .select('document_id')
    .where('id', '=', op.entityId)
    .executeTakeFirst()
  return row?.document_id ?? null
}

/** Stores both versions as a conflict object and logs it like any other entity change. */
async function recordConflict(
  db: Db,
  op: Operation,
  found: ConflictFound,
  now: string,
): Promise<ApplyResult> {
  const id = randomUUID()
  const payload: ConflictCreatePayload = {
    entity: op.entity as ConflictCreatePayload['entity'],
    entityId: op.entityId,
    documentId: await conflictDocument(db, op),
    reason: found.reason,
    baseRevision: op.baseRevision,
    local: { kind: op.kind, payload: op.payload, deviceId: op.deviceId, opId: op.opId },
    remote: await remoteState(db, op),
    createdAt: now,
    resolvedAt: null,
    resolution: null,
  }
  await db
    .insertInto('conflicts')
    .values({
      id,
      workspace_id: op.workspaceId,
      op_id: op.opId,
      entity: payload.entity,
      entity_id: op.entityId,
      document_id: payload.documentId,
      reason: payload.reason,
      base_revision: payload.baseRevision,
      local: JSON.stringify(payload.local),
      remote: payload.remote === null ? null : JSON.stringify(payload.remote),
      created_at: now,
      resolved_at: null,
      resolution: null,
      revision: 1,
      deleted_at: null,
    })
    .execute()
  await db
    .insertInto('changes')
    .values({
      workspace_id: op.workspaceId,
      seq: await nextSeq(db, op.workspaceId),
      op_id: randomUUID(),
      device_id: op.deviceId,
      entity: 'conflict',
      entity_id: id,
      kind: 'create',
      revision: 1,
      payload: JSON.stringify(payload),
      applied_at: now,
    })
    .execute()
  return {
    status: 'conflict',
    currentRevision: found.currentRevision,
    reason: found.reason,
    conflictId: id,
  }
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
  limits: AttachmentLimits = NO_LIMITS,
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
      // Resending an operation that became a conflict returns that conflict again.
      const known = await trx
        .selectFrom('conflicts')
        .select(['id', 'reason', 'entity_id', 'workspace_id'])
        .where('op_id', '=', op.opId)
        .executeTakeFirst()
      if (known) {
        if (known.workspace_id !== op.workspaceId || known.entity_id !== op.entityId) {
          reject('op_id_reused', 'Operation id was used for another change')
        }
        const remote = await remoteState(trx, op)
        return {
          status: 'conflict',
          currentRevision: Number(remote?.revision ?? 1),
          reason: known.reason as ConflictReason,
          conflictId: known.id,
        }
      }
      if (op.entity === 'conflict' && op.kind !== 'update') {
        reject('invalid_payload', 'Conflicts are created by the server and can only be resolved')
      }
      const invalid = validateOperationPayload(op.entity, op.kind, op.payload)
      if (invalid) reject('invalid_payload', invalid)

      const ctx: ApplyContext = { merged: false, limits }
      let revision: number
      try {
        revision = await appliers[op.entity](trx, op, now, ctx)
      } catch (error) {
        if (error instanceof ConflictFound) return recordConflict(trx, op, error, now)
        throw error
      }
      const indexed = await indexedDocument(trx, op)
      if (indexed) await markForReindex(trx, indexed)
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
      return { status: ctx.merged ? 'merged' : 'applied', revision, seq }
    })
  } catch (error) {
    if (error instanceof Stop) return error.result
    throw error
  }
}
