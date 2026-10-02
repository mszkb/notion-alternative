import cookie from '@fastify/cookie'
import Fastify, { type FastifyServerOptions } from 'fastify'
import { authRoutes } from './auth/routes'
import type { Config } from './config'
import type { Db } from './db/database'
import { HttpError } from './errors'
import { healthRoutes } from './health/routes'
import { workspaceRoutes } from './workspaces/routes'

declare module 'fastify' {
  interface FastifyInstance {
    db: Db
    config: Config
  }
}

export interface AppOptions {
  db: Db
  config: Config
  logger?: FastifyServerOptions['logger']
}

export async function buildApp({ db, config, logger = false }: AppOptions) {
  const app = Fastify({
    logger,
    bodyLimit: 1024 * 1024,
    // The frontend container is the only client and acts as reverse proxy.
    trustProxy: true,
  })

  app.decorate('db', db)
  app.decorate('config', config)
  app.decorateRequest('user', null)
  await app.register(cookie)

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) {
      return reply
        .code(error.statusCode)
        .send({ error: { code: error.code, message: error.message, ...error.details } })
    }
    const statusCode = (error as { statusCode?: number }).statusCode
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply
        .code(statusCode)
        .send({ error: { code: 'bad_request', message: (error as Error).message } })
    }
    request.log.error({ err: error }, 'unhandled error')
    return reply.code(500).send({ error: { code: 'internal', message: 'Internal server error' } })
  })

  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } }),
  )

  await app.register(
    async (api) => {
      await api.register(healthRoutes)
      await api.register(authRoutes)
      await api.register(workspaceRoutes)
    },
    { prefix: '/api' },
  )

  app.addHook('onClose', async () => {
    await db.destroy()
  })

  return app
}
