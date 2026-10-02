import { createHash, randomBytes } from 'node:crypto'
import type { Db } from '../db/database'

export const SESSION_COOKIE = 'session'

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createSession(db: Db, userId: string, ttlDays: number) {
  const token = randomBytes(32).toString('base64url')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000)
  await db
    .insertInto('sessions')
    .values({
      id: hashToken(token),
      user_id: userId,
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    })
    .execute()
  return { token, expiresAt }
}

/** Returns the user for a valid, unexpired session token. */
export async function findSessionUser(db: Db, token: string) {
  return db
    .selectFrom('sessions')
    .innerJoin('users', 'users.id', 'sessions.user_id')
    .select(['users.id', 'users.email', 'users.created_at'])
    .where('sessions.id', '=', hashToken(token))
    .where('sessions.expires_at', '>', new Date().toISOString())
    .executeTakeFirst()
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.deleteFrom('sessions').where('id', '=', hashToken(token)).execute()
}

export async function deleteExpiredSessions(db: Db): Promise<void> {
  await db.deleteFrom('sessions').where('expires_at', '<=', new Date().toISOString()).execute()
}
