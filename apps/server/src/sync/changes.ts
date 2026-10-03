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

/** Highest `seq` handed out in the workspace, including compacted ones. */
export async function latestSeq(db: Db, workspaceId: string, compactedSeq: number) {
  const row = await db
    .selectFrom('changes')
    .select((eb) => eb.fn.max('seq').as('max'))
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst()
  return Math.max(Number(row?.max ?? 0), compactedSeq)
}

/**
 * Removes change-log entries up to `throughSeq` (log compaction). Not scheduled in the MVP
 * (ADR 0002); used to test the re-sync path (T-MD-05). Pulls from an older cursor get 410.
 */
export async function compactChangeLog(db: Db, workspaceId: string, throughSeq: number) {
  await db.transaction().execute(async (trx) => {
    await trx
      .deleteFrom('changes')
      .where('workspace_id', '=', workspaceId)
      .where('seq', '<=', throughSeq)
      .execute()
    await trx
      .updateTable('workspaces')
      .set((eb) => ({
        compacted_seq: eb.fn('max', [eb.ref('compacted_seq'), eb.val(throughSeq)]),
      }))
      .where('id', '=', workspaceId)
      .execute()
  })
}
