import type { Kysely } from 'kysely'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- migrations must not depend on the current schema
export async function up(db: Kysely<any>): Promise<void> {
  // Rate-limit counters of the PHP server (ADR 0018), which keeps no state between requests.
  // The Node server counts in memory and does not use this table.
  await db.schema
    .createTable('auth_attempts')
    // Limiter and key, e.g. "login_ip:10.0.0.1".
    .addColumn('key', 'text', (col) => col.primaryKey())
    .addColumn('count', 'integer', (col) => col.notNull())
    // End of the fixed window in epoch milliseconds.
    .addColumn('reset_at', 'integer', (col) => col.notNull())
    .execute()
  await db.schema
    .createIndex('auth_attempts_reset_at_idx')
    .on('auth_attempts')
    .column('reset_at')
    .execute()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see up()
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('auth_attempts').execute()
}
