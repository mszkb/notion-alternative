import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { currentUser, requireAuth } from '../auth/plugin'
import { HttpError } from '../errors'
import { parseInput } from '../validation'
import { listVersions, versionState } from './history'

const paramsSchema = z.object({ id: z.uuid() })
const versionParamsSchema = z.object({ id: z.uuid(), seq: z.coerce.number().int().positive() })
const querySchema = z.object({ workspaceId: z.uuid() })

export async function historyRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app
  app.addHook('preHandler', requireAuth)

  /** Versions (editing sessions) of a page, newest first (ADR 0013). */
  app.get('/documents/:id/history', async (request) => {
    const { id } = parseInput(paramsSchema, request.params)
    const { workspaceId } = parseInput(querySchema, request.query)
    const versions = await listVersions(db, currentUser(request).id, workspaceId, id)
    if (!versions) throw new HttpError(404, 'not_found', 'Page not found')
    return { versions }
  })

  /** The page as it was after change `seq`. */
  app.get('/documents/:id/history/:seq', async (request) => {
    const { id, seq } = parseInput(versionParamsSchema, request.params)
    const { workspaceId } = parseInput(querySchema, request.query)
    const state = await versionState(db, currentUser(request).id, workspaceId, id, seq)
    if (!state) throw new HttpError(404, 'not_found', 'Version not found')
    return state
  })
}
