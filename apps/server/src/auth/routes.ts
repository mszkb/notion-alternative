import type { FastifyInstance, FastifyReply } from 'fastify'
import { loginInputSchema, registerInputSchema } from '@notion-alt/shared'
import { HttpError } from '../errors'
import { parseInput } from '../validation'
import { insertWorkspace } from '../workspaces/repository'
import { hashPassword, verifyPassword } from './password'
import { currentUser, requireAuth } from './plugin'
import { SESSION_COOKIE, createSession, deleteSession } from './sessions'
import { countUsers, findUserByEmail, insertUser, toUser } from './users'

const DEFAULT_WORKSPACE_NAME = 'Personal'

// Compared against when the user does not exist, so login timing does not reveal accounts.
const DUMMY_PASSWORD_HASH = hashPassword('dummy-password-for-timing')

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const { db, config } = app

  async function startSession(reply: FastifyReply, userId: string): Promise<void> {
    const { token, expiresAt } = await createSession(db, userId, config.sessionTtlDays)
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/api',
      httpOnly: true,
      sameSite: 'strict',
      secure: config.cookieSecure,
      expires: expiresAt,
    })
  }

  app.get('/auth/status', async () => ({
    registrationOpen: config.allowRegistration || (await countUsers(db)) === 0,
  }))

  app.post('/auth/register', async (request, reply) => {
    const input = parseInput(registerInputSchema, request.body)
    const passwordHash = await hashPassword(input.password)

    const user = await db.transaction().execute(async (trx) => {
      if (!config.allowRegistration && (await countUsers(trx)) > 0) {
        throw new HttpError(403, 'registration_closed', 'Registration is closed')
      }
      if (await findUserByEmail(trx, input.email)) {
        throw new HttpError(409, 'email_taken', 'Email address is already registered')
      }
      const row = await insertUser(trx, input.email, passwordHash)
      await insertWorkspace(trx, row.id, DEFAULT_WORKSPACE_NAME)
      return row
    })

    await startSession(reply, user.id)
    request.log.info({ userId: user.id }, 'user registered')
    return reply.code(201).send({ user: toUser(user) })
  })

  app.post('/auth/login', async (request, reply) => {
    const input = parseInput(loginInputSchema, request.body)
    const user = await findUserByEmail(db, input.email)
    const valid = await verifyPassword(
      input.password,
      user?.password_hash ?? (await DUMMY_PASSWORD_HASH),
    )
    if (!user || !valid) {
      throw new HttpError(401, 'invalid_credentials', 'Invalid email or password')
    }
    await startSession(reply, user.id)
    return { user: toUser(user) }
  })

  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE]
    if (token) await deleteSession(db, token)
    reply.clearCookie(SESSION_COOKIE, { path: '/api' })
    return reply.code(204).send()
  })

  app.get('/auth/me', { preHandler: requireAuth }, async (request) => ({
    user: currentUser(request),
  }))
}
