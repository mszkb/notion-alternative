import type { Kysely } from 'kysely'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- migrations must not depend on the current schema
export async function up(db: Kysely<any>): Promise<void> {
  // Pending push hints of the PHP server (ADR 0018), which keeps no timers between requests:
  // one row per subscription bundles the hints of a burst. The Node server bundles in memory
  // and does not use this table.
  await db.schema
    .createTable('push_hints')
    .addColumn('endpoint', 'text', (col) =>
      col.primaryKey().references('push_subscriptions.endpoint').onDelete('cascade'),
    )
    .addColumn('workspace_id', 'text', (col) =>
      col.notNull().references('workspaces.id').onDelete('cascade'),
    )
    // When the pending hint may be sent (epoch milliseconds); null: nothing pending.
    .addColumn('due_at', 'integer')
    // Last hint sent to this subscription (epoch milliseconds).
    .addColumn('sent_at', 'integer')
    .execute()
  await db.schema.createIndex('push_hints_due_at_idx').on('push_hints').column('due_at').execute()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see up()
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('push_hints').execute()
}
