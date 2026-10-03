import { z } from 'zod'

export const workspaceNameSchema = z.string().trim().min(1).max(100)

export const workspaceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  ownerId: z.uuid(),
  createdAt: z.string(),
})
export type Workspace = z.infer<typeof workspaceSchema>

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
