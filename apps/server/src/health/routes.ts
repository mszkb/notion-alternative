import type { FastifyInstance } from 'fastify'
import { sql } from 'kysely'

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  // Liveness: the process is up and serving requests.
  app.get('/health', { logLevel: 'warn' }, async () => ({ status: 'ok' }))

  // Readiness: dependencies (database) are usable.
  app.get('/ready', { logLevel: 'warn' }, async (request, reply) => {
    try {
      await sql`select 1`.execute(app.db)
      return { status: 'ok', checks: { database: 'ok' } }
    } catch (err) {
      request.log.error({ err }, 'readiness check failed')
      return reply.code(503).send({ status: 'error', checks: { database: 'error' } })
    }
  })
}
