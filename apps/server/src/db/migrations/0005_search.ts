import { inlineToPlainText } from '@notion-alt/shared'
import { type Kysely, sql } from 'kysely'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- migrations must not depend on the current schema
export async function up(db: Kysely<any>): Promise<void> {
  // One row per active page: title and the plain text of its blocks (server-side search, FTS5).
  // `remove_diacritics 2` lets "uber" find "über"; prefixes are matched by the query.
  await sql`create virtual table search_index using fts5(
    document_id unindexed,
    workspace_id unindexed,
    title,
    body,
    tokenize = 'unicode61 remove_diacritics 2'
  )`.execute(db)

  // Initial fill from the existing pages (same text rules as the app at the time of writing).
  const documents = await db
    .selectFrom('documents')
    .select(['id', 'workspace_id', 'title'])
    .where('deleted_at', 'is', null)
    .execute()
  for (const document of documents) {
    const blocks = await db
      .selectFrom('blocks')
      .select(['type', 'content'])
      .where('document_id', '=', document.id)
      .where('deleted_at', 'is', null)
      .orderBy('sort_key')
      .execute()
    const body = blocks
      .map((b: { type: string; content: string }) =>
        b.type === 'code' ? b.content : inlineToPlainText(b.content),
      )
      .join('\n')
    await sql`insert into search_index (document_id, workspace_id, title, body)
      values (${document.id}, ${document.workspace_id}, ${document.title}, ${body})`.execute(db)
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see up()
export async function down(db: Kysely<any>): Promise<void> {
  await sql`drop table search_index`.execute(db)
}
