import type { Kysely } from 'kysely'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- migrations must not depend on the current schema
export async function up(db: Kysely<any>): Promise<void> {
  // Server-wide values created on first start (VAPID keys, installation id); part of the backup.
  await db.schema
    .createTable('settings')
    .addColumn('key', 'text', (col) => col.primaryKey())
    .addColumn('value', 'text', (col) => col.notNull())
    .execute()

  // Web Push subscriptions, one per device (ADR 0005).
  await db.schema
    .createTable('push_subscriptions')
    .addColumn('endpoint', 'text', (col) => col.primaryKey())
    .addColumn('user_id', 'text', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('device_id', 'text', (col) =>
      col.notNull().references('devices.id').onDelete('cascade'),
    )
    .addColumn('p256dh', 'text', (col) => col.notNull())
    .addColumn('auth', 'text', (col) => col.notNull())
    .addColumn('created_at', 'text', (col) => col.notNull())
    .addColumn('last_success_at', 'text')
    .addColumn('failures', 'integer', (col) => col.notNull().defaultTo(0))
    .execute()
  await db.schema
    .createIndex('push_subscriptions_user_id_idx')
    .on('push_subscriptions')
    .column('user_id')
    .execute()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see up()
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('push_subscriptions').execute()
  await db.schema.dropTable('settings').execute()
}
