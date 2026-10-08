import type { Kysely } from 'kysely'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- migrations must not depend on the current schema
export async function up(db: Kysely<any>): Promise<void> {
  // Prometheus counters of the PHP server (ADR 0018), which keeps no state between requests;
  // only written with METRICS_ENABLED. The Node server counts in memory.
  await db.schema
    .createTable('metrics')
    // Series name, e.g. "http_requests_total" or "http_request_duration_seconds_bucket".
    .addColumn('name', 'text', (col) => col.notNull())
    // Labels as JSON object with sorted keys; never personal data or content.
    .addColumn('labels', 'text', (col) => col.notNull())
    .addColumn('value', 'real', (col) => col.notNull())
    .addPrimaryKeyConstraint('metrics_pk', ['name', 'labels'])
    .execute()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see up()
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('metrics').execute()
}
