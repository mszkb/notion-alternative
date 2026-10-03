import { inlineToPlainText } from '@notion-alt/shared'
import { sql } from 'kysely'
import type { Db } from '../db/database'
import { findWorkspaceForUser } from '../workspaces/repository'

/** Plain text of a page's blocks as indexed: Markdown inline normalised, code verbatim. */
export function blocksText(blocks: { type: string; content: string }[]): string {
  return blocks
    .map((b) => (b.type === 'code' ? b.content : inlineToPlainText(b.content)))
    .join('\n')
}

/**
 * Rebuilds the index row of one page from its current state; deleted pages leave the index.
 * Called in the same transaction that applies an operation.
 */
export async function reindexDocument(db: Db, documentId: string): Promise<void> {
  // Addressed by rowid: a lookup by the unindexed document_id would scan the whole index (#77).
  const entry = await sql<{ id: number }>`
    select id from search_documents where document_id = ${documentId}`.execute(db)
  const rowid = entry.rows[0]?.id
  if (rowid !== undefined) await sql`delete from search_index where rowid = ${rowid}`.execute(db)
  const document = await db
    .selectFrom('documents')
    .select(['id', 'workspace_id', 'title', 'deleted_at'])
    .where('id', '=', documentId)
    .executeTakeFirst()
  if (!document || document.deleted_at) {
    if (rowid !== undefined) {
      await sql`delete from search_documents where id = ${rowid}`.execute(db)
    }
    return
  }
  const blocks = await db
    .selectFrom('blocks')
    .select(['type', 'content'])
    .where('document_id', '=', documentId)
    .where('deleted_at', 'is', null)
    .orderBy('sort_key')
    .execute()
  const id =
    rowid ??
    (
      await sql<{ id: number }>`
        insert into search_documents (document_id) values (${documentId}) returning id`.execute(db)
    ).rows[0]!.id
  await sql`insert into search_index (rowid, document_id, workspace_id, title, body)
    values (${id}, ${document.id}, ${document.workspace_id}, ${document.title}, ${blocksText(blocks)})`.execute(
    db,
  )
}

/** Marks a page's search entry as outdated; called in the transaction that changes the page. */
export async function markForReindex(db: Db, documentId: string): Promise<void> {
  await sql`insert or ignore into search_dirty (document_id) values (${documentId})`.execute(db)
}

/**
 * Rebuilds the entries of all marked pages, once per page (#99). Runs after each push, before
 * each search (so results never lag behind applied operations) and at startup (a crash between
 * applying and reindexing leaves marks behind, never a stale index without a mark).
 */
export async function reindexMarked(db: Db): Promise<void> {
  const marked = await sql<{ document_id: string }>`select document_id from search_dirty`.execute(
    db,
  )
  if (marked.rows.length === 0) return
  await db.transaction().execute(async (trx) => {
    for (const { document_id } of marked.rows) {
      await reindexDocument(trx, document_id)
      await sql`delete from search_dirty where document_id = ${document_id}`.execute(trx)
    }
  })
}

/**
 * Turns user input into a safe FTS5 query: every word becomes a quoted prefix term, all must
 * match. FTS syntax in the input (quotes, operators, columns) is never interpreted.
 */
export function toFtsQuery(input: string): string | null {
  const terms = input
    .split(/\s+/)
    .map((term) => term.replace(/"/g, '').trim())
    .filter((term) => /[\p{L}\p{N}]/u.test(term))
    .slice(0, 10)
  return terms.length ? terms.map((term) => `"${term}"*`).join(' ') : null
}

export interface SearchHit {
  documentId: string
  title: string
  snippet: string
}

/** Full-text search in one workspace of the user; null if the workspace is not theirs. */
export async function searchWorkspace(
  db: Db,
  userId: string,
  workspaceId: string,
  input: string,
  limit = 20,
): Promise<SearchHit[] | null> {
  if (!(await findWorkspaceForUser(db, workspaceId, userId))) return null
  await reindexMarked(db)
  const query = toFtsQuery(input)
  if (!query) return []
  const { rows } = await sql<SearchHit>`
    select document_id as "documentId", title,
      snippet(search_index, 3, '', '', '…', 12) as snippet
    from search_index
    where search_index match ${query} and workspace_id = ${workspaceId}
    order by bm25(search_index, 0, 0, 10.0, 1.0)
    limit ${limit}`.execute(db)
  return rows
}
