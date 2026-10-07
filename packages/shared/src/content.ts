import { z } from 'zod'

/** Sync metadata carried by every synchronised entity (see docs/architecture/sync.md). */
const syncFields = {
  /** Server-assigned revision; `null` until the entity has been synced for the first time. */
  revision: z.number().int().nonnegative().nullable(),
  /** Tombstone timestamp; `null` = active. */
  deletedAt: z.string().nullable(),
}

export const DOCUMENT_TITLE_MAX_LENGTH = 500
export const BLOCK_CONTENT_MAX_LENGTH = 100_000
export const TAG_NAME_MAX_LENGTH = 50
export const MAX_LIST_INDENT = 5

export const documentTitleSchema = z.string().max(DOCUMENT_TITLE_MAX_LENGTH)

export const documentSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  /** Parent page in the page tree; `null` = root level. */
  parentId: z.uuid().nullable(),
  title: documentTitleSchema,
  sortKey: z.string().min(1),
  favorite: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  ...syncFields,
})
export type Document = z.infer<typeof documentSchema>

export const blockTypeSchema = z.enum([
  'paragraph',
  'heading',
  'list_item',
  'quote',
  'code',
  // Attachment blocks (ADR 0012): `attrs.attachmentId`, `content` is the caption.
  'image',
  'file',
  // ADR 0019: `todo` (`attrs.checked`), `toggle` (the following blocks with a larger `indent`
  // are its children), `callout` (`attrs.icon`), `divider` (no content).
  'todo',
  'toggle',
  'callout',
  'divider',
])
export type BlockType = z.infer<typeof blockTypeSchema>

export const blockAttrsSchema = z
  .object({
    /** Heading level (`heading`). */
    level: z.number().int().min(1).max(3).optional(),
    /** List style (`list_item`). */
    list: z.enum(['bullet', 'ordered']).optional(),
    /** Nesting depth (`list_item`, `todo`, children of a `toggle`). */
    indent: z.number().int().min(0).max(MAX_LIST_INDENT).optional(),
    /** Done (`todo`). */
    checked: z.boolean().optional(),
    /** Emoji shown before the text (`callout`). */
    icon: z.string().min(1).max(16).optional(),
    /** Language hint (`code`). */
    language: z.string().max(40).optional(),
    /** Attachment shown by an `image` or `file` block. */
    attachmentId: z.uuid().optional(),
  })
  .strict()
export type BlockAttrs = z.infer<typeof blockAttrsSchema>

export const blockSchema = z.object({
  id: z.uuid(),
  documentId: z.uuid(),
  type: blockTypeSchema,
  /** Markdown inline text (ADR 0008); raw text for `code` blocks. */
  content: z.string().max(BLOCK_CONTENT_MAX_LENGTH),
  attrs: blockAttrsSchema,
  sortKey: z.string().min(1),
  ...syncFields,
})
export type Block = z.infer<typeof blockSchema>

export const tagNameSchema = z.string().trim().min(1).max(TAG_NAME_MAX_LENGTH)

export const tagSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  name: tagNameSchema,
  ...syncFields,
})
export type Tag = z.infer<typeof tagSchema>

/** Assignment of a tag to a document; its own entity so add/remove merge independently (ADR 0009). */
export const documentTagSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  documentId: z.uuid(),
  tagId: z.uuid(),
  ...syncFields,
})
export type DocumentTag = z.infer<typeof documentTagSchema>

/** Content entities clients change directly. */
export const contentEntitySchema = z.enum([
  'document',
  'block',
  'tag',
  'document_tag',
  'attachment',
])
export type ContentEntity = z.infer<typeof contentEntitySchema>

/** `conflict` is created by the server; clients only resolve it (ADR 0003). */
export const operationEntitySchema = z.enum([
  'document',
  'block',
  'tag',
  'document_tag',
  'attachment',
  'conflict',
])
export type OperationEntity = z.infer<typeof operationEntitySchema>

/** `restore` lifts a page's tombstone (trash, #66); only pages can be restored. */
export const operationKindSchema = z.enum(['create', 'update', 'move', 'delete', 'restore'])
export type OperationKind = z.infer<typeof operationKindSchema>

/** One local change, transferred idempotently by `opId` (ADR 0002). */
export const operationSchema = z.object({
  opId: z.uuid(),
  deviceId: z.uuid(),
  workspaceId: z.uuid(),
  entity: operationEntitySchema,
  entityId: z.uuid(),
  kind: operationKindSchema,
  /** Revision the change is based on; `null` for entities that were never synced. */
  baseRevision: z.number().int().nonnegative().nullable(),
  /** Changed fields (`update`), new position (`move`), full entity (`create`), empty (`delete`). */
  payload: z.record(z.string(), z.unknown()),
  /** Device clock; informational only, never used for conflict decisions. */
  createdAt: z.string(),
})
export type Operation = z.infer<typeof operationSchema>

export const conflictReasonSchema = z.enum(['changed', 'deleted', 'parent_deleted'])
export type ConflictReason = z.infer<typeof conflictReasonSchema>

export const conflictResolutionSchema = z.enum(['local', 'remote', 'manual'])
export type ConflictResolution = z.infer<typeof conflictResolutionSchema>

/**
 * A change the server could not apply because another device changed (or deleted) the same
 * entity or field first (ADR 0003). Both versions are kept until a user decides.
 */
export const conflictSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  entity: contentEntitySchema,
  entityId: z.uuid(),
  /** Page the conflict belongs to, for display. */
  documentId: z.uuid().nullable(),
  reason: conflictReasonSchema,
  /** Revision the rejected change was based on. */
  baseRevision: z.number().int().nonnegative().nullable(),
  /** The change that was not applied ("this device" for its author). */
  local: z.object({
    kind: z.enum(['create', 'update', 'move', 'delete', 'restore']),
    payload: z.record(z.string(), z.unknown()),
    deviceId: z.uuid(),
    opId: z.uuid(),
  }),
  /** Server state of the entity when the conflict arose (null if it did not exist). */
  remote: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
  resolution: conflictResolutionSchema.nullable(),
  ...syncFields,
})
export type Conflict = z.infer<typeof conflictSchema>

export const ATTACHMENT_NAME_MAX_LENGTH = 255

/** File attached to a page (ADR 0012). The content never changes for a given id. */
export const attachmentSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  documentId: z.uuid(),
  name: z.string().trim().min(1).max(ATTACHMENT_NAME_MAX_LENGTH),
  mimeType: z
    .string()
    .max(100)
    .regex(/^[\w.+-]+\/[\w.+-]+$/),
  size: z.number().int().nonnegative(),
  /** Hex SHA-256 of the content; the upload must match. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.string(),
  ...syncFields,
})
export type Attachment = z.infer<typeof attachmentSchema>

/** Raster images that may be shown inline; everything else is only offered as download. */
export const INLINE_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
]

/** `GET /api/attachments/usage`: storage of a workspace and the limits set by the operator. */
export interface AttachmentUsage {
  usedBytes: number
  /** null: no workspace limit configured. */
  quotaBytes: number | null
  maxFileBytes: number
  count: number
}
