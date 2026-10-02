import type { FastifyReply, FastifyRequest } from 'fastify'
import type { User } from '@notion-alt/shared'
import { HttpError } from '../errors'
import { SESSION_COOKIE, findSessionUser } from './sessions'
import { toUser } from './users'

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null
  }
}

/** preHandler that rejects requests without a valid session and sets request.user. */
export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const token = request.cookies[SESSION_COOKIE]
  const row = token ? await findSessionUser(request.server.db, token) : undefined
  if (!row) throw new HttpError(401, 'unauthorized', 'Authentication required')
  request.user = toUser(row)
}

export function currentUser(request: FastifyRequest): User {
  if (!request.user) throw new HttpError(401, 'unauthorized', 'Authentication required')
  return request.user
}
