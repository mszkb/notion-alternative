import type { Kysely } from 'kysely'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- migrations must not depend on the current schema
export async function up(db: Kysely<any>): Promise<void> {
  // Conflict objects (ADR 0003): both versions are kept until a user resolves them.
  await db.schema
    .createTable('conflicts')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('workspace_id', 'text', (col) =>
      col.notNull().references('workspaces.id').onDelete('cascade'),
    )
    // The operation that could not be applied; resending it returns the same conflict.
    .addColumn('op_id', 'text', (col) => col.notNull().unique())
    .addColumn('entity', 'text', (col) => col.notNull())
    .addColumn('entity_id', 'text', (col) => col.notNull())
    .addColumn('document_id', 'text')
    .addColumn('reason', 'text', (col) => col.notNull())
    .addColumn('base_revision', 'integer')
    .addColumn('local', 'text', (col) => col.notNull()) // JSON
    .addColumn('remote', 'text') // JSON
    .addColumn('created_at', 'text', (col) => col.notNull())
    .addColumn('resolved_at', 'text')
    .addColumn('resolution', 'text')
    .addColumn('revision', 'integer', (col) => col.notNull())
    .addColumn('deleted_at', 'text')
    .execute()
  await db.schema
    .createIndex('conflicts_workspace_id_idx')
    .on('conflicts')
    .column('workspace_id')
    .execute()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see up()
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('conflicts').execute()
}
