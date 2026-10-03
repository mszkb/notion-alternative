import type { FastifyInstance } from 'fastify'
import { importInputSchema } from '@notion-alt/shared'
import { currentUser, requireAuth } from '../auth/plugin'
import { HttpError } from '../errors'
import { parseInput } from '../validation'
import { toWorkspace } from '../workspaces/repository'
import { importWorkspace } from './import'

export async function importRoutes(app: FastifyInstance): Promise<void> {
  const { db, config } = app
  let running = false
  app.addHook('preHandler', requireAuth)

  /**
   * Imports a JSON export as a new workspace (ADR 0004). Attachment contents follow through
   * the normal upload. `409 ids_exist` if the data is already on this server.
   */
  app.post('/import', { bodyLimit: config.importMaxBytes }, async (request, reply) => {
    // One import at a time: each holds a whole workspace in memory.
    if (running) throw new HttpError(429, 'import_running', 'Another import is running')
    running = true
    let row
    try {
      const input = parseInput(importInputSchema, request.body)
      row = await importWorkspace(
        db,
        currentUser(request).id,
        input.name,
        input.data,
        config.attachments.workspaceQuotaBytes,
      )
    } finally {
      running = false
    }
    request.log.info({ workspaceId: row.id }, 'workspace imported')
    return reply.code(201).send({ workspace: toWorkspace(row) })
  })
}
