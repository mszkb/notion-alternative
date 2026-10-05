import type { SyncSnapshotResponse } from '@notion-alt/shared'
import type { Db } from '../db/database'
import { findWorkspaceForUser } from '../workspaces/repository'
import { latestSeq } from './changes'
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
    const [documents, blocks, tags, documentTags, attachments, conflicts, cursor] =
      await Promise.all([
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
        latestSeq(trx, workspaceId, workspace.compacted_seq),
      ])
    return {
      documents: documents.map(toDocument),
      blocks: blocks.map(toBlock),
      tags: tags.map(toTag),
      documentTags: documentTags.map(toDocumentTag),
      attachments: attachments.map(toAttachment),
      conflicts: conflicts.map(toConflict),
      cursor,
    }
  })
}

// Order in which a paged snapshot walks the tables; the index is part of the `after` token.
const TABLES = ['documents', 'tags', 'document_tags', 'attachments', 'blocks', 'conflicts'] as const

/**
 * One page of a paged snapshot (#97): at most `limit` entities, walking the tables in a fixed
 * order and each table by id. Every page is a short read of its own, so a slow client never
 * keeps a transaction open on the server's single connection. The first page (no `after`) fixes
 * the cursor and carries it in `next`. Rows on later pages may be newer than the cursor and rows
 * created behind the walk are missing; both are covered by the pull from the cursor, which
 * replays every change after it (tombstones included, ADR 0002). Null if the user may not
 * access the workspace or `after` is malformed.
 */
export async function loadSnapshotPage(
  db: Db,
  userId: string,
  workspaceId: string,
  limit: number,
  after?: string,
): Promise<SyncSnapshotResponse | null> {
  return db.transaction().execute(async (trx) => {
    const workspace = await findWorkspaceForUser(trx, workspaceId, userId)
    if (!workspace) return null
    let cursor: number
    let table = 0
    let lastId: string | null = null
    let total: number | undefined
    if (after) {
      const [seq, index, id] = after.split('.') as [string, string, string]
      cursor = Number(seq)
      table = Number(index)
      lastId = id || null
      if (table >= TABLES.length) return null
    } else {
      cursor = await latestSeq(trx, workspaceId, workspace.compacted_seq)
      total = 0
      for (const name of TABLES) {
        const row = await trx
          .selectFrom(name)
          .select((eb) => eb.fn.countAll<number>().as('n'))
          .where('workspace_id', '=', workspaceId)
          .executeTakeFirstOrThrow()
        total += Number(row.n)
      }
    }

    const page: SyncSnapshotResponse = {
      documents: [],
      blocks: [],
      tags: [],
      documentTags: [],
      attachments: [],
      conflicts: [],
      cursor,
      next: null,
      ...(total === undefined ? {} : { total }),
    }
    let room = limit
    for (; table < TABLES.length && room > 0; table++, lastId = null) {
      const name = TABLES[table]!
      let query = trx
        .selectFrom(name)
        .selectAll()
        .where('workspace_id', '=', workspaceId)
        .orderBy('id')
        .limit(room + 1)
      if (lastId !== null) query = query.where('id', '>', lastId)
      const rows = await query.execute()
      const taken = rows.slice(0, room)
      room -= taken.length
      switch (name) {
        case 'documents':
          page.documents = taken.map((r) => toDocument(r as never))
          break
        case 'tags':
          page.tags = taken.map((r) => toTag(r as never))
          break
        case 'document_tags':
          page.documentTags = taken.map((r) => toDocumentTag(r as never))
          break
        case 'attachments':
          page.attachments = taken.map((r) => toAttachment(r as never))
          break
        case 'blocks':
          page.blocks = taken.map((r) => toBlock(r as never))
          break
        case 'conflicts':
          page.conflicts = taken.map((r) => toConflict(r as never))
          break
      }
      if (rows.length > taken.length) {
        page.next = `${cursor}.${table}.${taken.at(-1)!.id}`
        return page
      }
    }
    // The page filled up exactly at the end of a table: continue with the next one.
    if (table < TABLES.length) page.next = `${cursor}.${table}.`
    return page
  })
}
