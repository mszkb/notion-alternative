import { type Kysely, sql } from 'kysely'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- migrations must not depend on the current schema
export async function up(db: Kysely<any>): Promise<void> {
  // Pages whose search entry is outdated (#99). An applied operation only marks its page, in
  // the same transaction; the entry is rebuilt once per page after a push, before a search and
  // at startup, instead of once per block operation.
  await sql`create table search_dirty (document_id text primary key)`.execute(db)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see up()
export async function down(db: Kysely<any>): Promise<void> {
  await sql`drop table search_dirty`.execute(db)
}
