import type { FastifyInstance } from 'fastify'
import { createWorkspaceInputSchema } from '@notion-alt/shared'
import { z } from 'zod'
import { currentUser, requireAuth } from '../auth/plugin'
import { HttpError } from '../errors'
import { parseInput } from '../validation'
import {
  findWorkspaceForUser,
  insertWorkspace,
  listWorkspacesForUser,
  toWorkspace,
} from './repository'

const workspaceParamsSchema = z.object({ id: z.uuid() })

export async function workspaceRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app
  app.addHook('preHandler', requireAuth)

  app.get('/workspaces', async (request) => {
    const rows = await listWorkspacesForUser(db, currentUser(request).id)
    return { workspaces: rows.map(toWorkspace) }
  })

  app.post('/workspaces', async (request, reply) => {
    const input = parseInput(createWorkspaceInputSchema, request.body)
    const row = await insertWorkspace(db, currentUser(request).id, input.name)
    return reply.code(201).send({ workspace: toWorkspace(row) })
  })

  app.get('/workspaces/:id', async (request) => {
    const { id } = parseInput(workspaceParamsSchema, request.params)
    const row = await findWorkspaceForUser(db, id, currentUser(request).id)
    // 404 instead of 403: do not reveal whether a foreign workspace exists.
    if (!row) throw new HttpError(404, 'not_found', 'Workspace not found')
    return { workspace: toWorkspace(row) }
  })
}
