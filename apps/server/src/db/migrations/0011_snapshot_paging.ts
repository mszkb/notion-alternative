import { type Kysely, sql } from 'kysely'

const TABLES = ['documents', 'blocks', 'tags', 'document_tags', 'attachments', 'conflicts']

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- migrations must not depend on the current schema
export async function up(db: Kysely<any>): Promise<void> {
  // A paged snapshot (#97) walks each table by id within one workspace. The workspace index
  // alone orders by rowid, so every page would sort the whole workspace.
  for (const table of TABLES) {
    await sql`create index ${sql.raw(`${table}_workspace_id_id_idx`)} on ${sql.table(table)} (workspace_id, id)`.execute(
      db,
    )
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see up()
export async function down(db: Kysely<any>): Promise<void> {
  for (const table of TABLES) {
    await sql`drop index ${sql.raw(`${table}_workspace_id_id_idx`)}`.execute(db)
  }
}
