import type { SyncSnapshotResponse } from '@notion-alt/shared'
import type { Db } from '../db/database'
import { findWorkspaceForUser } from '../workspaces/repository'
import { toAttachment, toBlock, toConflict, toDocument, toDocumentTag, toTag } from './mapping'

/**
 * Complete state of a workspace including tombstones, read in one transaction so entities and
 * cursor match (ADR 0002 re-sync). Null if the user may not access the workspace.
 */
export async function loadSnapshot(
  db: Db,
  userId: string,
  workspaceId: string,
): Promise<SyncSnapshotResponse | null> {
  return db.transaction().execute(async (trx) => {
    const workspace = await findWorkspaceForUser(trx, workspaceId, userId)
    if (!workspace) return null
    const [documents, blocks, tags, documentTags, attachments, conflicts, last] = await Promise.all(
      [
        trx.selectFrom('documents').selectAll().where('workspace_id', '=', workspaceId).execute(),
        trx.selectFrom('blocks').selectAll().where('workspace_id', '=', workspaceId).execute(),
        trx.selectFrom('tags').selectAll().where('workspace_id', '=', workspaceId).execute(),
        trx
          .selectFrom('document_tags')
          .selectAll()
          .where('workspace_id', '=', workspaceId)
          .execute(),
        trx.selectFrom('attachments').selectAll().where('workspace_id', '=', workspaceId).execute(),
        trx.selectFrom('conflicts').selectAll().where('workspace_id', '=', workspaceId).execute(),
        trx
          .selectFrom('changes')
          .select((eb) => eb.fn.max('seq').as('max'))
          .where('workspace_id', '=', workspaceId)
          .executeTakeFirst(),
      ],
    )
    return {
      documents: documents.map(toDocument),
      blocks: blocks.map(toBlock),
      tags: tags.map(toTag),
      documentTags: documentTags.map(toDocumentTag),
      attachments: attachments.map(toAttachment),
      conflicts: conflicts.map(toConflict),
      cursor: Math.max(Number(last?.max ?? 0), workspace.compacted_seq),
    }
  })
}
