import { randomUUID } from 'node:crypto'
import type { User } from '@notion-alt/shared'
import type { Db } from '../db/database'
import type { UsersTable } from '../db/schema'

export function toUser(row: Pick<UsersTable, 'id' | 'email' | 'created_at'>): User {
  return { id: row.id, email: row.email, createdAt: row.created_at }
}

export async function countUsers(db: Db): Promise<number> {
  const row = await db
    .selectFrom('users')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .executeTakeFirstOrThrow()
  return Number(row.count)
}

export async function findUserByEmail(db: Db, email: string) {
  return db.selectFrom('users').selectAll().where('email', '=', email).executeTakeFirst()
}

export async function insertUser(db: Db, email: string, passwordHash: string) {
  const row: UsersTable = {
    id: randomUUID(),
    email,
    password_hash: passwordHash,
    created_at: new Date().toISOString(),
  }
  await db.insertInto('users').values(row).execute()
  return row
}

export async function findUserById(db: Db, id: string) {
  return db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst()
}

export async function updatePasswordHash(db: Db, id: string, passwordHash: string) {
  await db.updateTable('users').set({ password_hash: passwordHash }).where('id', '=', id).execute()
}
