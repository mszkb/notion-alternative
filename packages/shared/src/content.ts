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

export const blockTypeSchema = z.enum(['paragraph', 'heading', 'list_item', 'quote', 'code'])
export type BlockType = z.infer<typeof blockTypeSchema>

export const blockAttrsSchema = z
  .object({
    /** Heading level (`heading`). */
    level: z.number().int().min(1).max(3).optional(),
    /** List style (`list_item`). */
    list: z.enum(['bullet', 'ordered']).optional(),
    /** Nesting depth (`list_item`). */
    indent: z.number().int().min(0).max(MAX_LIST_INDENT).optional(),
    /** Language hint (`code`). */
    language: z.string().max(40).optional(),
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

export const operationEntitySchema = z.enum(['document', 'block', 'tag', 'document_tag'])
export type OperationEntity = z.infer<typeof operationEntitySchema>

export const operationKindSchema = z.enum(['create', 'update', 'move', 'delete'])
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
