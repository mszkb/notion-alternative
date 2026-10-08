import type { Kysely } from 'kysely'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- migrations must not depend on the current schema
export async function up(db: Kysely<any>): Promise<void> {
  // Page icon (emoji) and cover (`gradient:<name>` or `attachment:<uuid>`), #136.
  await db.schema.alterTable('documents').addColumn('icon', 'text').execute()
  await db.schema.alterTable('documents').addColumn('cover', 'text').execute()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see up()
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('documents').dropColumn('cover').execute()
  await db.schema.alterTable('documents').dropColumn('icon').execute()
}
