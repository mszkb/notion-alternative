import type { FastifyInstance } from 'fastify'
import { importInputSchema } from '@notion-alt/shared'
import { currentUser, requireAuth } from '../auth/plugin'
import { parseInput } from '../validation'
import { toWorkspace } from '../workspaces/repository'
import { importWorkspace } from './import'

export async function importRoutes(app: FastifyInstance): Promise<void> {
  const { db, config } = app
  app.addHook('preHandler', requireAuth)

  /**
   * Imports a JSON export as a new workspace (ADR 0004). Attachment contents follow through
   * the normal upload. `409 ids_exist` if the data is already on this server.
   */
  app.post('/import', { bodyLimit: config.importMaxBytes }, async (request, reply) => {
    const input = parseInput(importInputSchema, request.body)
    const row = await importWorkspace(
      db,
      currentUser(request).id,
      input.name,
      input.data,
      config.attachments.workspaceQuotaBytes,
    )
    request.log.info({ workspaceId: row.id }, 'workspace imported')
    return reply.code(201).send({ workspace: toWorkspace(row) })
  })
}
