import { type Kysely, sql } from 'kysely'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- migrations must not depend on the current schema
export async function up(db: Kysely<any>): Promise<void> {
  // `search_index.document_id` is unindexed, so finding a page's row scanned the whole FTS
  // table on every applied operation (#77). The row is now addressed by its rowid, kept in a
  // table with an explicit INTEGER PRIMARY KEY (stable across VACUUM and backups).
  await sql`create table search_documents (
    id integer primary key,
    document_id text not null unique
  )`.execute(db)
  await sql`create temp table search_index_copy as
    select document_id, workspace_id, title, body from search_index`.execute(db)
  await sql`delete from search_index`.execute(db)
  await sql`insert into search_documents (document_id)
    select document_id from search_index_copy`.execute(db)
  await sql`insert into search_index (rowid, document_id, workspace_id, title, body)
    select s.id, c.document_id, c.workspace_id, c.title, c.body
    from search_index_copy c join search_documents s on s.document_id = c.document_id`.execute(db)
  await sql`drop table search_index_copy`.execute(db)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see up()
export async function down(db: Kysely<any>): Promise<void> {
  await sql`drop table search_documents`.execute(db)
}
