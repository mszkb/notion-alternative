import type { Kysely } from 'kysely'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- migrations must not depend on the current schema
export async function up(db: Kysely<any>): Promise<void> {
  // Synchronised entities (docs/architecture/sync.md). Ids come from the clients; `revision` is
  // assigned by the server and rises with every applied change; `deleted_at` is the tombstone.
  await db.schema
    .createTable('documents')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('workspace_id', 'text', (col) =>
      col.notNull().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('parent_id', 'text')
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('sort_key', 'text', (col) => col.notNull())
    .addColumn('favorite', 'integer', (col) => col.notNull())
    .addColumn('created_at', 'text', (col) => col.notNull())
    .addColumn('updated_at', 'text', (col) => col.notNull())
    .addColumn('revision', 'integer', (col) => col.notNull())
    .addColumn('deleted_at', 'text')
    .execute()
  await db.schema
    .createIndex('documents_workspace_id_idx')
    .on('documents')
    .column('workspace_id')
    .execute()

  await db.schema
    .createTable('blocks')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('workspace_id', 'text', (col) =>
      col.notNull().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('document_id', 'text', (col) => col.notNull())
    .addColumn('type', 'text', (col) => col.notNull())
    .addColumn('content', 'text', (col) => col.notNull())
    .addColumn('attrs', 'text', (col) => col.notNull()) // JSON
    .addColumn('sort_key', 'text', (col) => col.notNull())
    .addColumn('revision', 'integer', (col) => col.notNull())
    .addColumn('deleted_at', 'text')
    .execute()
  await db.schema.createIndex('blocks_document_id_idx').on('blocks').column('document_id').execute()
  await db.schema
    .createIndex('blocks_workspace_id_idx')
    .on('blocks')
    .column('workspace_id')
    .execute()

  await db.schema
    .createTable('tags')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('workspace_id', 'text', (col) =>
      col.notNull().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('revision', 'integer', (col) => col.notNull())
    .addColumn('deleted_at', 'text')
    .execute()
  await db.schema.createIndex('tags_workspace_id_idx').on('tags').column('workspace_id').execute()

  await db.schema
    .createTable('document_tags')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('workspace_id', 'text', (col) =>
      col.notNull().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('document_id', 'text', (col) => col.notNull())
    .addColumn('tag_id', 'text', (col) => col.notNull())
    .addColumn('revision', 'integer', (col) => col.notNull())
    .addColumn('deleted_at', 'text')
    .execute()
  await db.schema
    .createIndex('document_tags_document_id_idx')
    .on('document_tags')
    .column('document_id')
    .execute()
  await db.schema
    .createIndex('document_tags_workspace_id_idx')
    .on('document_tags')
    .column('workspace_id')
    .execute()

  // Change log: one row per applied operation; `seq` is gap-free per workspace (= sync cursor).
  await db.schema
    .createTable('changes')
    .addColumn('workspace_id', 'text', (col) =>
      col.notNull().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('seq', 'integer', (col) => col.notNull())
    .addColumn('op_id', 'text', (col) => col.notNull().unique())
    .addColumn('device_id', 'text', (col) => col.notNull())
    .addColumn('entity', 'text', (col) => col.notNull())
    .addColumn('entity_id', 'text', (col) => col.notNull())
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('revision', 'integer', (col) => col.notNull())
    .addColumn('payload', 'text', (col) => col.notNull()) // JSON
    .addColumn('applied_at', 'text', (col) => col.notNull())
    .addPrimaryKeyConstraint('changes_pk', ['workspace_id', 'seq'])
    .execute()
  await db.schema
    .createIndex('changes_entity_idx')
    .on('changes')
    .columns(['entity', 'entity_id'])
    .execute()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see up()
export async function down(db: Kysely<any>): Promise<void> {
  for (const table of ['changes', 'document_tags', 'tags', 'blocks', 'documents']) {
    await db.schema.dropTable(table).execute()
  }
}
