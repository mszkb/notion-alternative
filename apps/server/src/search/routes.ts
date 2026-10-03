import type { FastifyInstance } from 'fastify'
import { searchQuerySchema, type ServerSearchHit } from '@notion-alt/shared'
import { currentUser, requireAuth } from '../auth/plugin'
import { HttpError } from '../errors'
import { parseInput } from '../validation'
import { searchWorkspace } from './index'

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth)

  /** Server-side full-text search (FTS5) in one of the user's workspaces. */
  app.get('/search', async (request): Promise<{ hits: ServerSearchHit[] }> => {
    const { workspaceId, q } = parseInput(searchQuerySchema, request.query)
    const hits = await searchWorkspace(app.db, currentUser(request).id, workspaceId, q)
    if (!hits) throw new HttpError(404, 'not_found', 'Workspace not found')
    return { hits }
  })
}
