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
  documentCoverSchema,
  documentIconSchema,
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
    icon: documentIconSchema.nullable().optional(),
    cover: documentCoverSchema.nullable().optional(),
    createdAt: z.string().max(40),
  })
  .strict()
const documentUpdate = z
  .object({
    title: documentTitleSchema,
    favorite: z.boolean(),
    // null removes the icon or cover (#136).
    icon: documentIconSchema.nullable(),
    cover: documentCoverSchema.nullable(),
  })
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
  document: {
    create: documentCreate,
    update: documentUpdate,
    move: documentMove,
    delete: empty,
    restore: empty,
  },
  block: {
    create: blockCreate,
    update: blockUpdate,
    move: blockMove,
    delete: empty,
    restore: null,
  },
  tag: { create: tagCreate, update: tagCreate, move: null, delete: empty, restore: null },
  document_tag: {
    create: documentTagCreate,
    update: null,
    move: null,
    delete: empty,
    restore: null,
  },
  attachment: { create: attachmentCreate, update: null, move: null, delete: empty, restore: null },
  conflict: {
    create: conflictCreate,
    update: conflictUpdate,
    move: null,
    delete: null,
    restore: null,
  },
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
  kind: z.enum(['create', 'update', 'move', 'delete', 'restore']),
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

/** Largest page of a paged snapshot (#97). */
export const SNAPSHOT_PAGE_MAX = 5000
/** Page size the web app requests: small enough for a Raspberry Pi, large enough to be fast. */
export const SNAPSHOT_PAGE_SIZE = 2000

/**
 * `GET /api/sync/snapshot`: the complete workspace including tombstones (re-sync). With `limit`
 * it answers in pages of at most `limit` entities (#97, ADR 0002): the first page fixes the
 * cursor, each further page is requested with the previous page's `next` as `after`. Without
 * `limit` the whole workspace comes in one response (clients before #97).
 */
export const syncSnapshotQuerySchema = z.object({
  workspaceId: z.uuid(),
  limit: z.coerce.number().int().min(1).max(SNAPSHOT_PAGE_MAX).optional(),
  // `<cursor>.<table>.<last id>`, opaque to the client.
  after: z
    .string()
    .regex(/^\d+\.\d\.[0-9A-Fa-f-]{0,64}$/)
    .optional(),
  // `false`: everything except blocks; page contents load on demand (ADR 0017).
  content: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
})

export interface SyncSnapshotResponse {
  documents: Document[]
  blocks: Block[]
  tags: Tag[]
  documentTags: DocumentTag[]
  attachments: Attachment[]
  conflicts: Conflict[]
  /**
   * Change-log position the snapshot reflects; pulling continues from here. Paged: fixed by the
   * first page and repeated on every page. Later pages may contain newer states than the cursor;
   * the pull from the cursor replays those changes on top, which converges (ADR 0002).
   */
  cursor: number
  /** Paged only: `after` for the next page, null on the last page. */
  next?: string | null
  /** Paged, first page only: number of entities in the whole snapshot (progress). */
  total?: number
}

/** `GET /api/sync/documents/:id`: one page with its blocks, loaded on demand (ADR 0017). */
export const syncDocumentQuerySchema = z.object({ workspaceId: z.uuid() })
export const syncDocumentParamsSchema = z.object({ id: z.uuid() })

export interface SyncDocumentResponse {
  document: Document
  /** All blocks of the page, tombstones included. */
  blocks: Block[]
  /**
   * Change-log position this state reflects. Changes up to it are contained; a later pull may
   * replay some of them, which the block revisions turn into no-ops.
   */
  seq: number
}

/** Most pages per `POST /api/sync/documents`. */
export const SYNC_DOCUMENTS_MAX = 100

/** `POST /api/sync/documents`: several pages with their blocks at once (ADR 0017). */
export const syncDocumentsInputSchema = z.object({
  workspaceId: z.uuid(),
  ids: z.array(z.uuid()).min(1).max(SYNC_DOCUMENTS_MAX),
})

export interface SyncDocumentsResponse {
  /** The requested pages the server has; unknown ids are left out. */
  pages: { document: Document; blocks: Block[] }[]
  /** Change-log position all pages reflect (as for a single page). */
  seq: number
}

/** One version of a page: an editing session of one device (ADR 0013). */
export interface DocumentVersion {
  /** Last change of the session; identifies the version. */
  seq: number
  at: string
  deviceId: string
  /** Number of changes in this session. */
  changes: number
}

/** Page and blocks as they were at a version (ADR 0013). */
export interface DocumentVersionState {
  seq: number
  document: Pick<Document, 'id' | 'title' | 'parentId' | 'favorite' | 'deletedAt'>
  /** Active blocks in order. */
  blocks: Pick<Block, 'id' | 'type' | 'content' | 'attrs' | 'sortKey'>[]
}
