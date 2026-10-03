import type { Kysely } from 'kysely'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- migrations must not depend on the current schema
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('devices')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('user_id', 'text', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('created_at', 'text', (col) => col.notNull())
    .addColumn('last_seen_at', 'text', (col) => col.notNull())
    // Removed devices stay as a row so their sessions and operations are rejected for good.
    .addColumn('revoked_at', 'text')
    .execute()
  await db.schema.createIndex('devices_user_id_idx').on('devices').column('user_id').execute()

  // The device a session belongs to (set on registration); removing the device ends it.
  await db.schema.alterTable('sessions').addColumn('device_id', 'text').execute()
  await db.schema.createIndex('sessions_device_id_idx').on('sessions').column('device_id').execute()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see up()
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('sessions_device_id_idx').execute()
  await db.schema.alterTable('sessions').dropColumn('device_id').execute()
  await db.schema.dropTable('devices').execute()
}
