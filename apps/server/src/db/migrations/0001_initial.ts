import type { Kysely } from 'kysely'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- migrations must not depend on the current schema
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('email', 'text', (col) => col.notNull().unique())
    .addColumn('password_hash', 'text', (col) => col.notNull())
    .addColumn('created_at', 'text', (col) => col.notNull())
    .execute()

  await db.schema
    .createTable('sessions')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('user_id', 'text', (col) =>
      col.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('created_at', 'text', (col) => col.notNull())
    .addColumn('expires_at', 'text', (col) => col.notNull())
    .execute()
  await db.schema.createIndex('sessions_user_id_idx').on('sessions').column('user_id').execute()

  await db.schema
    .createTable('workspaces')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('owner_id', 'text', (col) =>
      col.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('created_at', 'text', (col) => col.notNull())
    .execute()
  await db.schema
    .createIndex('workspaces_owner_id_idx')
    .on('workspaces')
    .column('owner_id')
    .execute()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see up()
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('workspaces').execute()
  await db.schema.dropTable('sessions').execute()
  await db.schema.dropTable('users').execute()
}
