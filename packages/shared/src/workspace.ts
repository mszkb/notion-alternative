import { z } from 'zod'
import { emailSchema } from './auth'
import type { BlockAttrs, BlockType } from './content'

export const workspaceNameSchema = z.string().trim().min(1).max(100)

/** Roles by rank (ADR 0014): each one may do everything the lower ones may. */
export const WORKSPACE_ROLES = ['reader', 'commenter', 'editor', 'owner'] as const
export const workspaceRoleSchema = z.enum(WORKSPACE_ROLES)
export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>

/** Whether `role` is at least `minimum`. */
export function roleAtLeast(role: WorkspaceRole, minimum: WorkspaceRole): boolean {
  return WORKSPACE_ROLES.indexOf(role) >= WORKSPACE_ROLES.indexOf(minimum)
}

export const workspaceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** Creator: always an owner, carries the attachment quota (ADR 0014). */
  ownerId: z.uuid(),
  createdAt: z.string(),
  /** The current user's role; servers before ADR 0014 send none (the user is the owner). */
  role: workspaceRoleSchema.optional(),
})
export type Workspace = z.infer<typeof workspaceSchema>

export const workspaceMemberSchema = z.object({
  userId: z.uuid(),
  email: z.string(),
  role: workspaceRoleSchema,
  /** The creator cannot be removed or given another role. */
  creator: z.boolean(),
  addedAt: z.string(),
})
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>

export const addMemberInputSchema = z.object({
  email: emailSchema,
  role: workspaceRoleSchema,
})
export type AddMemberInput = z.infer<typeof addMemberInputSchema>

export const updateMemberInputSchema = z.object({
  role: workspaceRoleSchema,
})
export type UpdateMemberInput = z.infer<typeof updateMemberInputSchema>

/** Longest validity of a read link (ADR 0022); `expiresAt: null` means no expiry. */
export const SHARE_LINK_MAX_VALID_DAYS = 3650

/** A read link for people without an account (ADR 0022); its token is only sent on creation. */
export const shareLinkSchema = z.object({
  id: z.uuid(),
  documentId: z.uuid(),
  createdBy: z.uuid(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  expired: z.boolean(),
})
export type ShareLink = z.infer<typeof shareLinkSchema>

export const createShareLinkInputSchema = z.object({
  documentId: z.uuid(),
  /** ISO 8601 with time zone, in the future; `null` = no expiry. */
  expiresAt: z.iso.datetime({ offset: true }).max(40).nullable(),
})
export type CreateShareLinkInput = z.infer<typeof createShareLinkInputSchema>

/** What a guest sees of a shared page: no ids of blocks, the workspace or accounts. */
export interface SharedPage {
  page: { title: string; icon: string | null; cover: string | null; updatedAt: string }
  blocks: { type: BlockType; content: string; attrs: BlockAttrs }[]
}

export const createWorkspaceInputSchema = z.object({
  name: workspaceNameSchema,
})
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInputSchema>

export const searchQuerySchema = z.object({
  workspaceId: z.uuid(),
  q: z.string().trim().min(1).max(200),
})

export interface ServerSearchHit {
  documentId: string
  title: string
  snippet: string
}
