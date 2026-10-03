import type { Kysely } from 'kysely'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- migrations must not depend on the current schema
export async function up(db: Kysely<any>): Promise<void> {
  // Attachment metadata (ADR 0012); the content lives in DATA_DIR/attachments.
  await db.schema
    .createTable('attachments')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('workspace_id', 'text', (col) =>
      col.notNull().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('document_id', 'text', (col) => col.notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('mime_type', 'text', (col) => col.notNull())
    .addColumn('size', 'integer', (col) => col.notNull())
    .addColumn('sha256', 'text', (col) => col.notNull())
    .addColumn('created_at', 'text', (col) => col.notNull())
    // Set once the content was uploaded and verified.
    .addColumn('stored_at', 'text')
    .addColumn('revision', 'integer', (col) => col.notNull())
    .addColumn('deleted_at', 'text')
    .execute()
  await db.schema
    .createIndex('attachments_workspace_id_idx')
    .on('attachments')
    .column('workspace_id')
    .execute()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see up()
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('attachments').execute()
}
