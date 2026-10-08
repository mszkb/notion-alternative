// Writes the fixtures the PHP server (apps/server-php, ADR 0018) is tested against:
//   node-schema.json      sqlite_master of a fresh database migrated by this server
//   node-0004.sqlite      a database with content, migrated up to 0004_change_log_floor
//   node-latest.sqlite    the same database migrated to the latest version by this server
//   inline-plaintext.json inlineToPlainText() results (used by the PHP port of migration 0005)
// Run: pnpm --filter @notion-alt/server exec tsx scripts/dump-php-fixtures.ts
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inlineToPlainText } from '@notion-alt/shared'
import { sql } from 'kysely'
import { Migrator } from 'kysely/migration'
import { createDatabase, type Db } from '../src/db/database'
import { migrations } from '../src/db/migrate'

const outDir = fileURLToPath(new URL('../../server-php/tests/fixtures/', import.meta.url))
fs.mkdirSync(outDir, { recursive: true })

const PAGE = '3f2b8c1e-7d4a-4b6e-9c0f-1a2b3c4d5e6f'
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'

function migrator(db: Db): Migrator {
  return new Migrator({ db, provider: { getMigrations: async () => migrations } })
}

async function migrateTo(db: Db, name: string): Promise<void> {
  const { error } = await migrator(db).migrateTo(name)
  if (error) throw error
}

async function schema(db: Db): Promise<unknown[]> {
  const { rows } = await sql`select type, name, tbl_name, sql from sqlite_master
    order by type, name`.execute(db)
  return rows
}

async function vacuumInto(db: Db, file: string): Promise<void> {
  fs.rmSync(file, { force: true })
  await sql`vacuum into ${file}`.execute(db)
}

// Schema of a fresh database.
const fresh = createDatabase(':memory:')
await migrateTo(fresh, Object.keys(migrations).at(-1)!)
fs.writeFileSync(
  path.join(outDir, 'node-schema.json'),
  JSON.stringify(await schema(fresh), null, 2) + '\n',
)
await fresh.destroy()

// A database with content at 0004, then migrated by this server.
const db = createDatabase(':memory:')
await migrateTo(db, '0004_change_log_floor')
const now = '2026-01-01T00:00:00.000Z'
await sql`insert into users (id, email, password_hash, created_at)
  values ('u1', 'a@example.com', 'scrypt$32768$8$1$c2FsdA$aGFzaA', ${now})`.execute(db)
await sql`insert into sessions (id, user_id, created_at, expires_at, device_id)
  values ('s1', 'u1', ${now}, '2999-01-01T00:00:00.000Z', 'dev1')`.execute(db)
await sql`insert into devices (id, user_id, name, created_at, last_seen_at, revoked_at)
  values ('dev1', 'u1', 'Laptop', ${now}, ${now}, null)`.execute(db)
await sql`insert into workspaces (id, name, owner_id, created_at, compacted_seq)
  values ('w1', 'Personal', 'u1', ${now}, 0)`.execute(db)
const documents: [string, string, string | null][] = [
  [PAGE, 'Einkaufsliste', null],
  [OTHER, 'Notizen über **alles**', null],
  ['d-empty', 'Leer', null],
  ['d-deleted', 'Gelöscht', now],
]
for (const [id, title, deletedAt] of documents) {
  await sql`insert into documents
    (id, workspace_id, parent_id, title, sort_key, favorite, created_at, updated_at, revision, deleted_at)
    values (${id}, 'w1', null, ${title}, 'a0', 0, ${now}, ${now}, 1, ${deletedAt})`.execute(db)
}
const blocks: [string, string, string, string, string, string | null][] = [
  ['b1', PAGE, 'paragraph', '**Milch** und _Brot_', 'a1', null],
  ['b2', PAGE, 'code', 'const x = **1**', 'a2', null],
  ['b3', PAGE, 'todo', `Siehe [Notizen](page:${OTHER}) und [Web](https://x.test/)`, 'a0', null],
  ['b4', PAGE, 'paragraph', 'gelöschter Block', 'a3', now],
  ['b5', OTHER, 'heading', '2 * 3 * 4 \\*kein\\* `code`', 'a0', null],
  ['b6', 'd-deleted', 'paragraph', 'nicht im Index', 'a0', null],
]
for (const [id, documentId, type, content, sortKey, deletedAt] of blocks) {
  await sql`insert into blocks
    (id, workspace_id, document_id, type, content, attrs, sort_key, revision, deleted_at)
    values (${id}, 'w1', ${documentId}, ${type}, ${content}, '{}', ${sortKey}, 1, ${deletedAt})`.execute(
    db,
  )
}
await sql`insert into changes
  (workspace_id, seq, op_id, device_id, entity, entity_id, kind, revision, payload, applied_at)
  values ('w1', 1, 'op1', 'dev1', 'document', ${PAGE}, 'upsert', 1, '{}', ${now})`.execute(db)
await vacuumInto(db, path.join(outDir, 'node-0004.sqlite'))
await migrateTo(db, Object.keys(migrations).at(-1)!)
await vacuumInto(db, path.join(outDir, 'node-latest.sqlite'))
await db.destroy()

// Plain text of inline markup, for the search index fill in migration 0005.
const inlineCases = [
  '',
  'plain text',
  `a **b** *c* \`d\` [e](https://x.test/) [Seite](page:${PAGE})`,
  '**a *b* c**',
  '*a **b** c*',
  '**open',
  '*open',
  '`open',
  '[text](javascript:alert(1))',
  '[text](page:not-a-uuid)',
  '[text] (https://x.test)',
  '2 * 3 * 4',
  '****',
  '`**x**`',
  '\\*not italic\\* \\[x\\]',
  'a * b',
  '**x',
  'x\\',
  '[a](b)',
  '* x *',
  '***x***',
  '**a *b***',
  '_a_b_',
  '_ü_ und **ö**',
  '[**fett** im Link](https://example.org/a_b?c=d)',
  `[Titel mit \\[Klammern\\]](page:${PAGE})`,
  '[mail](mailto:a@example.com)',
  '[leer](https://)',
  '[ftp](ftp://x.test/)',
  '``',
  ' *x*  * y* *z *',
  '[a [b](https://x.test/)',
  '**[x](https://x.test/)**',
  '[x](https://x.test/ y)',
]
fs.writeFileSync(
  path.join(outDir, 'inline-plaintext.json'),
  JSON.stringify(
    inlineCases.map((source) => ({ source, text: inlineToPlainText(source) })),
    null,
    2,
  ) + '\n',
)
console.log(`fixtures written to ${outDir}`)
