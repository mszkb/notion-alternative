import { z } from 'zod'
import {
  type Attachment,
  attachmentSchema,
  type Block,
  blockAttrsSchema,
  type Conflict,
  conflictResolutionSchema,
  conflictSchema,
  blockTypeSchema,
  BLOCK_CONTENT_MAX_LENGTH,
  type Document,
  type DocumentTag,
  documentTitleSchema,
  type OperationEntity,
  type OperationKind,
  operationEntitySchema,
  operationSchema,
  type Tag,
  tagNameSchema,
} from './content'

/**
 * Payload of each operation (entity × kind) as written by the client's LocalStore and applied
 * by the server (ADR 0002). Shared so both sides validate the same shape.
 */

const sortKeySchema = z.string().min(1).max(200)
const empty = z.object({}).strict()

const documentCreate = z
  .object({
    parentId: z.uuid().nullable(),
    title: documentTitleSchema,
    sortKey: sortKeySchema,
    favorite: z.boolean(),
    createdAt: z.string().max(40),
  })
  .strict()
const documentUpdate = z
  .object({ title: documentTitleSchema, favorite: z.boolean() })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'empty update')
const documentMove = z.object({ parentId: z.uuid().nullable(), sortKey: sortKeySchema }).strict()

const blockContent = z.string().max(BLOCK_CONTENT_MAX_LENGTH)
const blockCreate = z
  .object({
    documentId: z.uuid(),
    type: blockTypeSchema,
    content: blockContent,
    attrs: blockAttrsSchema,
    sortKey: sortKeySchema,
  })
  .strict()
const blockUpdate = z
  .object({ type: blockTypeSchema, content: blockContent, attrs: blockAttrsSchema })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'empty update')
const blockMove = z.object({ sortKey: sortKeySchema }).strict()

const tagCreate = z.object({ name: tagNameSchema }).strict()
const documentTagCreate = z.object({ documentId: z.uuid(), tagId: z.uuid() }).strict()

const attachmentCreate = attachmentSchema
  .pick({ documentId: true, name: true, mimeType: true, size: true, sha256: true, createdAt: true })
  .strict()

/** Written by the server only; a client sending it is rejected. */
const conflictCreate = conflictSchema
  .omit({ id: true, workspaceId: true, revision: true, deletedAt: true })
  .strict()
const conflictUpdate = z.object({ resolution: conflictResolutionSchema }).strict()

export const operationPayloadSchemas = {
  document: { create: documentCreate, update: documentUpdate, move: documentMove, delete: empty },
  block: { create: blockCreate, update: blockUpdate, move: blockMove, delete: empty },
  tag: { create: tagCreate, update: tagCreate, move: null, delete: empty },
  document_tag: { create: documentTagCreate, update: null, move: null, delete: empty },
  attachment: { create: attachmentCreate, update: null, move: null, delete: empty },
  conflict: { create: conflictCreate, update: conflictUpdate, move: null, delete: null },
} as const satisfies Record<OperationEntity, Record<OperationKind, z.ZodType | null>>

export type DocumentCreatePayload = z.infer<typeof documentCreate>
export type DocumentUpdatePayload = z.infer<typeof documentUpdate>
export type DocumentMovePayload = z.infer<typeof documentMove>
export type BlockCreatePayload = z.infer<typeof blockCreate>
export type BlockUpdatePayload = z.infer<typeof blockUpdate>
export type BlockMovePayload = z.infer<typeof blockMove>
export type TagCreatePayload = z.infer<typeof tagCreate>
export type DocumentTagCreatePayload = z.infer<typeof documentTagCreate>
export type AttachmentCreatePayload = z.infer<typeof attachmentCreate>
export type ConflictCreatePayload = z.infer<typeof conflictCreate>
export type ConflictUpdatePayload = z.infer<typeof conflictUpdate>

/** Validates an operation's payload; returns an error message, or null if it is valid. */
export function validateOperationPayload(
  entity: OperationEntity,
  kind: OperationKind,
  payload: unknown,
): string | null {
  const schema: z.ZodType | null = operationPayloadSchemas[entity][kind]
  if (!schema) return `${kind} is not supported for ${entity}`
  const result = schema.safeParse(payload)
  if (result.success) return null
  return result.error.issues
    .map((issue) => `${issue.path.join('.') || 'payload'}: ${issue.message}`)
    .join('; ')
}

/** Entry of the server's change log as clients will pull it (ADR 0002). */
export const changeSchema = z.object({
  /** Gap-free and monotonic per workspace: the sync cursor. */
  seq: z.number().int().positive(),
  opId: z.uuid(),
  deviceId: z.uuid(),
  entity: operationEntitySchema,
  entityId: z.uuid(),
  kind: z.enum(['create', 'update', 'move', 'delete']),
  /** Revision of the entity after this change. */
  revision: z.number().int().positive(),
  payload: z.record(z.string(), z.unknown()),
  appliedAt: z.string(),
})
export type Change = z.infer<typeof changeSchema>

export const SYNC_PUSH_MAX_OPERATIONS = 500

/** `POST /api/sync/push`: operations in the order they were created (ADR 0002). */
export const syncPushInputSchema = z.object({
  operations: z.array(operationSchema).min(1).max(SYNC_PUSH_MAX_OPERATIONS),
})
export type SyncPushInput = z.infer<typeof syncPushInputSchema>

/**
 * Result per operation. `applied`/`duplicate` carry the entity's new revision; `conflict` means
 * another device changed or deleted the entity (or its document) first, nothing was written;
 * `rejected` is permanent for this op.
 */
const confirmed = {
  opId: z.uuid(),
  revision: z.number().int().positive(),
  seq: z.number().int().positive(),
}
export const syncPushResultSchema = z.discriminatedUnion('status', [
  z.object({ ...confirmed, status: z.literal('applied') }),
  z.object({ ...confirmed, status: z.literal('duplicate') }),
  /** Applied; another device changed other fields of the same entity in the meantime. */
  z.object({ ...confirmed, status: z.literal('merged') }),
  z.object({
    opId: z.uuid(),
    status: z.literal('conflict'),
    currentRevision: z.number().int().positive(),
    reason: z.enum(['changed', 'deleted', 'parent_deleted']),
    /** Conflict object keeping both versions; replicated like other entities. */
    conflictId: z.uuid(),
  }),
  z.object({
    opId: z.uuid(),
    status: z.literal('rejected'),
    code: z.string(),
    message: z.string(),
  }),
])
export type SyncPushResult = z.infer<typeof syncPushResultSchema>

export const SYNC_PULL_MAX_LIMIT = 1000

/** `GET /api/sync/pull`: changes of one workspace after `cursor` (ADR 0002). */
export const syncPullQuerySchema = z.object({
  workspaceId: z.uuid(),
  cursor: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(SYNC_PULL_MAX_LIMIT).default(SYNC_PULL_MAX_LIMIT),
})
export type SyncPullQuery = z.infer<typeof syncPullQuerySchema>

export interface SyncPullResponse {
  changes: Change[]
  /** Highest `seq` delivered (or the given cursor if none); the next request starts here. */
  cursor: number
  hasMore: boolean
}

/** `GET /api/sync/snapshot`: the complete workspace including tombstones (re-sync). */
export const syncSnapshotQuerySchema = z.object({ workspaceId: z.uuid() })

export interface SyncSnapshotResponse {
  documents: Document[]
  blocks: Block[]
  tags: Tag[]
  documentTags: DocumentTag[]
  attachments: Attachment[]
  conflicts: Conflict[]
  /** Change-log position the snapshot reflects; pulling continues from here. */
  cursor: number
}
