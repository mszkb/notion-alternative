import type { Kysely } from 'kysely'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- migrations must not depend on the current schema
export async function up(db: Kysely<any>): Promise<void> {
  // Highest change `seq` removed by log compaction; pulls from an older cursor need a re-sync.
  await db.schema
    .alterTable('workspaces')
    .addColumn('compacted_seq', 'integer', (col) => col.notNull().defaultTo(0))
    .execute()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see up()
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('workspaces').dropColumn('compacted_seq').execute()
}
