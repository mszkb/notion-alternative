import type { FastifyInstance, FastifyReply } from 'fastify'
import {
  changePasswordInputSchema,
  loginInputSchema,
  registerInputSchema,
} from '@notion-alt/shared'
import { HttpError } from '../errors'
import { parseInput } from '../validation'
import { insertWorkspace } from '../workspaces/repository'
import { hashPassword, verifyPassword } from './password'
import { currentUser, requireAuth } from './plugin'
import { AttemptLimiter } from './rate-limit'
import { SESSION_COOKIE, createSession, deleteOtherSessions, deleteSession } from './sessions'
import {
  countUsers,
  findUserByEmail,
  findUserById,
  insertUser,
  toUser,
  updatePasswordHash,
} from './users'

const DEFAULT_WORKSPACE_NAME = 'Personal'

// Compared against when the user does not exist, so login timing does not reveal accounts.
const DUMMY_PASSWORD_HASH = hashPassword('dummy-password-for-timing')

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const { db, config } = app

  const limits = config.authRateLimit
  const windowMs = limits.windowMinutes * 60_000
  const loginFailuresByIp = new AttemptLimiter(limits.loginMaxFailuresPerIp, windowMs)
  const loginFailuresByEmail = new AttemptLimiter(limits.loginMaxFailuresPerEmail, windowMs)
  const registerAttemptsByIp = new AttemptLimiter(limits.registerMaxAttemptsPerIp, windowMs)

  /** Rejects with 429 if any of the keys is blocked; same answer whether the account exists. */
  function enforceLimit(reply: FastifyReply, checks: [AttemptLimiter, string][]): void {
    const retryAfter = Math.max(...checks.map(([limiter, key]) => limiter.retryAfter(key)))
    if (retryAfter > 0) {
      reply.header('retry-after', String(retryAfter))
      throw new HttpError(429, 'too_many_attempts', 'Too many attempts, try again later', {
        retryAfter,
      })
    }
  }

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
    enforceLimit(reply, [[registerAttemptsByIp, request.ip]])
    registerAttemptsByIp.record(request.ip)
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
    enforceLimit(reply, [
      [loginFailuresByIp, request.ip],
      [loginFailuresByEmail, input.email],
    ])
    const user = await findUserByEmail(db, input.email)
    const valid = await verifyPassword(
      input.password,
      user?.password_hash ?? (await DUMMY_PASSWORD_HASH),
    )
    if (!user || !valid) {
      loginFailuresByIp.record(request.ip)
      loginFailuresByEmail.record(input.email)
      throw new HttpError(401, 'invalid_credentials', 'Invalid email or password')
    }
    loginFailuresByEmail.reset(input.email)
    await startSession(reply, user.id)
    return { user: toUser(user) }
  })

  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE]
    if (token) await deleteSession(db, token)
    reply.clearCookie(SESSION_COOKIE, { path: '/api' })
    return reply.code(204).send()
  })

  app.post('/auth/password', { preHandler: requireAuth }, async (request, reply) => {
    const input = parseInput(changePasswordInputSchema, request.body)
    const user = currentUser(request)
    // Guessing the current password through a stolen session counts like failed logins.
    enforceLimit(reply, [
      [loginFailuresByIp, request.ip],
      [loginFailuresByEmail, user.email],
    ])
    const row = await findUserById(db, user.id)
    if (!row || !(await verifyPassword(input.currentPassword, row.password_hash))) {
      loginFailuresByIp.record(request.ip)
      loginFailuresByEmail.record(user.email)
      throw new HttpError(400, 'invalid_current_password', 'Current password is incorrect')
    }
    const passwordHash = await hashPassword(input.newPassword)
    const token = request.cookies[SESSION_COOKIE]!
    await db.transaction().execute(async (trx) => {
      await updatePasswordHash(trx, user.id, passwordHash)
      // Other devices must sign in again; their local data and queues stay intact (local-first).
      await deleteOtherSessions(trx, user.id, token)
    })
    loginFailuresByEmail.reset(user.email)
    request.log.info({ userId: user.id }, 'password changed')
    return reply.code(204).send()
  })

  app.get('/auth/me', { preHandler: requireAuth }, async (request) => ({
    user: currentUser(request),
  }))
}
