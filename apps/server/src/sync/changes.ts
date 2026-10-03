import type { Db } from '../db/database'
import { findWorkspaceForUser } from '../workspaces/repository'

/**
 * Changes after `cursor` in `seq` order, or null if the user may not access the workspace.
 * Basis for `GET /api/sync/pull` (ADR 0002).
 */
export async function listChangesSince(
  db: Db,
  userId: string,
  workspaceId: string,
  cursor: number,
  limit: number,
) {
  if (!(await findWorkspaceForUser(db, workspaceId, userId))) return null
  return db
    .selectFrom('changes')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('seq', '>', cursor)
    .orderBy('seq')
    .limit(limit)
    .execute()
}
