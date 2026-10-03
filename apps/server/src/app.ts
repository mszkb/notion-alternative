import cookie from '@fastify/cookie'
import Fastify, { type FastifyServerOptions } from 'fastify'
import { authRoutes } from './auth/routes'
import type { Config } from './config'
import type { Db } from './db/database'
import { deviceRoutes } from './devices/routes'
import { HttpError } from './errors'
import { healthRoutes } from './health/routes'
import { metricsRoutes, setupMetrics } from './metrics/plugin'
import { pushRoutes } from './push/routes'
import { PushNotifier, type PushNotifierOptions } from './push/service'
import { searchRoutes } from './search/routes'
import type { Registry } from './metrics/registry'
import { syncRoutes } from './sync/routes'
import { workspaceRoutes } from './workspaces/routes'

declare module 'fastify' {
  interface FastifyInstance {
    db: Db
    config: Config
    metrics: Registry
    pushNotifier: PushNotifier
  }
}

export interface AppOptions {
  db: Db
  config: Config
  logger?: FastifyServerOptions['logger']
  /** Web Push sending (tests inject a fake push service). */
  push?: PushNotifierOptions
}

export async function buildApp({ db, config, logger = false, push }: AppOptions) {
  const app = Fastify({
    logger,
    bodyLimit: 1024 * 1024,
    // Trust exactly one hop: the frontend container (nginx) in front of the backend.
    trustProxy: (_address, hop) => hop === 0,
  })

  app.decorate('db', db)
  app.decorate('config', config)
  app.decorate('pushNotifier', new PushNotifier(db, config.push, push))
  app.decorateRequest('user', null)
  app.decorateRequest('deviceId', null)
  await app.register(cookie)
  setupMetrics(app, config.databasePath)

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
      if (config.metricsEnabled) await api.register(metricsRoutes)
      await api.register(authRoutes)
      await api.register(workspaceRoutes)
      await api.register(deviceRoutes)
      await api.register(syncRoutes)
      await api.register(searchRoutes)
      await api.register(pushRoutes)
    },
    { prefix: '/api' },
  )

  app.addHook('onClose', async () => {
    app.pushNotifier.close()
    await db.destroy()
  })

  return app
}
