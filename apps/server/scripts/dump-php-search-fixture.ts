// Writes apps/server-php/tests/fixtures/search.json: pages, blocks and the hits searchWorkspace()
// returns for a set of queries. The PHP port (src/Search/SearchIndex.php, ADR 0018) must return
// the same hits in the same order.
// Run: pnpm --filter @notion-alt/server exec tsx scripts/dump-php-search-fixture.ts
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { sql } from 'kysely'
import { createDatabase } from '../src/db/database'
import { migrateToLatest } from '../src/db/migrate'
import { markForReindex, searchWorkspace, toFtsQuery } from '../src/search/index'

const out = fileURLToPath(new URL('../../server-php/tests/fixtures/search.json', import.meta.url))

const documents = [
  { id: 'd1', title: 'Reiseplanung', deleted_at: null },
  { id: 'd2', title: 'Küche', deleted_at: null },
  { id: 'd3', title: 'Garten', deleted_at: null },
  { id: 'd4', title: 'Gartenarbeit im Herbst', deleted_at: null },
  { id: 'd5', title: 'Gelöschte Gartenseite', deleted_at: '2026-01-01T00:00:00.000Z' },
  { id: 'd6', title: 'Notizen [mit] _Zeichen_', deleted_at: null },
  { id: 'd7', title: 'Lange Seite', deleted_at: null },
]
const long = Array.from({ length: 60 }, (_, i) => (i === 30 ? 'Treffer' : `wort${i}`)).join(' ')
const blocks = [
  { id: 'b1', document_id: 'd1', type: 'paragraph', content: 'Wir fahren **über** die Alpen' },
  { id: 'b2', document_id: 'd1', type: 'todo', content: 'Garten gießen lassen, [Küche](page:d2)' },
  { id: 'b3', document_id: 'd2', type: 'code', content: 'const rezept = "Kuchen" // **roh**' },
  { id: 'b4', document_id: 'd3', type: 'heading', content: 'Beete im _Frühling_' },
  { id: 'b5', document_id: 'd4', type: 'paragraph', content: 'Laub rechen, Garten winterfest' },
  { id: 'b6', document_id: 'd4', type: 'paragraph', content: 'Garten Garten Garten' },
  { id: 'b7', document_id: 'd5', type: 'paragraph', content: 'Garten im Papierkorb' },
  { id: 'b8', document_id: 'd6', type: 'paragraph', content: 'Text mit `code` und \\*Stern\\*' },
  { id: 'b9', document_id: 'd7', type: 'paragraph', content: long },
  { id: 'b10', document_id: 'd7', type: 'paragraph', content: 'Zweiter Absatz mit Treffer' },
]
const queries: { q: string; limit?: number }[] = [
  { q: 'garten' },
  { q: 'garten', limit: 2 },
  { q: 'Gart' },
  { q: 'uber alpen' },
  { q: 'kuche' },
  { q: 'rezept roh' },
  { q: 'fruhling' },
  { q: 'treffer' },
  { q: 'stern code' },
  { q: 'zeichen' },
  { q: '"alpha" OR title:x NEAR(' },
  { q: 'gießen' },
  { q: '  -- ' },
  { q: 'papierkorb' },
]

const db = createDatabase(':memory:')
await migrateToLatest(db)
await sql`insert into users (id, email, password_hash, created_at)
  values ('u1', 'a@example.com', 'h', 'now')`.execute(db)
await sql`insert into workspaces (id, name, owner_id, created_at)
  values ('w1', 'Personal', 'u1', 'now')`.execute(db)
for (const [i, d] of documents.entries()) {
  await sql`insert into documents (id, workspace_id, parent_id, title, sort_key, favorite,
      created_at, updated_at, revision, deleted_at)
    values (${d.id}, 'w1', null, ${d.title}, ${`a${i}`}, 0, 'now', 'now', 1, ${d.deleted_at})`.execute(
    db,
  )
  await markForReindex(db, d.id)
}
for (const [i, b] of blocks.entries()) {
  await sql`insert into blocks (id, workspace_id, document_id, type, content, attrs, sort_key,
      revision, deleted_at)
    values (${b.id}, 'w1', ${b.document_id}, ${b.type}, ${b.content}, '{}',
      ${`a${String(i).padStart(2, '0')}`}, 1, null)`.execute(db)
}

const results = []
for (const { q, limit } of queries) {
  results.push({
    q,
    limit: limit ?? null,
    ftsQuery: toFtsQuery(q),
    hits: await searchWorkspace(db, 'u1', 'w1', q, limit),
  })
}
await db.destroy()

fs.writeFileSync(out, JSON.stringify({ documents, blocks, queries: results }, null, 2) + '\n')
console.log(`wrote ${out}`)
