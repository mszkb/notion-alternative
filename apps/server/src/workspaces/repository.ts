import { randomUUID } from 'node:crypto'
import type { Workspace } from '@notion-alt/shared'
import type { Db } from '../db/database'
import type { WorkspacesTable } from '../db/schema'

export function toWorkspace(row: WorkspacesTable): Workspace {
  return { id: row.id, name: row.name, ownerId: row.owner_id, createdAt: row.created_at }
}

export async function listWorkspacesForUser(db: Db, userId: string) {
  return db
    .selectFrom('workspaces')
    .selectAll()
    .where('owner_id', '=', userId)
    .orderBy('created_at')
    .execute()
}

/** Returns the workspace only if the user may access it (workspace boundary). */
export async function findWorkspaceForUser(db: Db, workspaceId: string, userId: string) {
  return db
    .selectFrom('workspaces')
    .selectAll()
    .where('id', '=', workspaceId)
    .where('owner_id', '=', userId)
    .executeTakeFirst()
}

export async function insertWorkspace(db: Db, ownerId: string, name: string) {
  const row: WorkspacesTable = {
    id: randomUUID(),
    name,
    owner_id: ownerId,
    created_at: new Date().toISOString(),
  }
  await db.insertInto('workspaces').values(row).execute()
  return row
}
