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
  await sql`delete from search_index where document_id = ${documentId}`.execute(db)
  const document = await db
    .selectFrom('documents')
    .select(['id', 'workspace_id', 'title', 'deleted_at'])
    .where('id', '=', documentId)
    .executeTakeFirst()
  if (!document || document.deleted_at) return
  const blocks = await db
    .selectFrom('blocks')
    .select(['type', 'content'])
    .where('document_id', '=', documentId)
    .where('deleted_at', 'is', null)
    .orderBy('sort_key')
    .execute()
  await sql`insert into search_index (document_id, workspace_id, title, body)
    values (${document.id}, ${document.workspace_id}, ${document.title}, ${blocksText(blocks)})`.execute(
    db,
  )
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
