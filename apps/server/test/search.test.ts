import { randomUUID } from 'node:crypto'
import type { Operation } from '@notion-alt/shared'
import { sql } from 'kysely'
import { Migrator } from 'kysely/migration'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase } from '../src/db/database'
import { migrateToLatest, migrations } from '../src/db/migrate'
import { reindexMarked, searchWorkspace, toFtsQuery } from '../src/search/index'
import { applyOperation } from '../src/sync/apply'
import { createTestApp, register, type TestApp } from './helpers'

let app: TestApp
let cookie: string
let workspaceId: string
let deviceId: string

async function signUp(email: string) {
  const { cookie: c } = await register(app, email)
  const ws = (await app.inject({ url: '/api/workspaces', headers: { cookie: c } })).json()
    .workspaces[0].id as string
  const device = randomUUID()
  await app.inject({
    method: 'POST',
    url: '/api/devices',
    headers: { cookie: c },
    payload: { id: device, name: 'Test' },
  })
  return { cookie: c, workspaceId: ws, deviceId: device }
}

beforeEach(async () => {
  ;({ app } = await createTestApp({ allowRegistration: true }))
  ;({ cookie, workspaceId, deviceId } = await signUp('alice@example.com'))
})
afterEach(() => app.close())

function op(
  entity: Operation['entity'],
  kind: Operation['kind'],
  entityId: string,
  payload: object,
  baseRevision: number | null = null,
  owner = { workspaceId, deviceId },
): Operation {
  return {
    opId: randomUUID(),
    ...owner,
    entity,
    entityId,
    kind,
    baseRevision,
    payload: payload as Record<string, unknown>,
    createdAt: new Date().toISOString(),
  }
}

const page = (title: string) => ({
  parentId: null,
  title,
  sortKey: 'a0',
  favorite: false,
  createdAt: 'x',
})
const block = (documentId: string, content: string, type = 'paragraph') => ({
  documentId,
  type,
  content,
  attrs: {},
  sortKey: 'a0',
})

async function push(operations: Operation[], c = cookie) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/sync/push',
    headers: { cookie: c },
    payload: { operations },
  })
  return response.json().results
}

async function search(q: string, ws = workspaceId, c = cookie) {
  const response = await app.inject({
    url: `/api/search?${new URLSearchParams({ workspaceId: ws, q })}`,
    headers: { cookie: c },
  })
  return response
}

const titles = async (q: string) =>
  (await search(q)).json().hits.map((h: { title: string }) => h.title)

describe('GET /api/search', () => {
  it('finds titles and block text (normalised Markdown, prefixes, umlauts)', async () => {
    const doc = randomUUID()
    const other = randomUUID()
    await push([
      op('document', 'create', doc, page('Reiseplanung')),
      op('block', 'create', randomUUID(), block(doc, 'Wir fahren **über** die Alpen')),
      op('document', 'create', other, page('Küche')),
      op('block', 'create', randomUUID(), block(other, 'const rezept = "Kuchen"', 'code')),
    ])
    expect(await titles('reise')).toEqual(['Reiseplanung'])
    expect(await titles('uber alpen')).toEqual(['Reiseplanung'])
    expect(await titles('kuche')).toEqual(['Küche'])
    expect(await titles('rezept')).toEqual(['Küche'])
    const [hit] = (await search('alpen')).json().hits
    expect(hit.documentId).toBe(doc)
    expect(hit.snippet).toContain('Wir fahren über die Alpen')
    expect(hit.snippet).not.toContain('**')
  })

  it('follows edits and drops deleted blocks and pages', async () => {
    const doc = randomUUID()
    const b = randomUUID()
    await push([
      op('document', 'create', doc, page('Notizen')),
      op('block', 'create', b, block(doc, 'alter Inhalt')),
    ])
    await push([op('block', 'update', b, { content: 'neuer Inhalt' }, 1)])
    expect(await titles('alter')).toEqual([])
    expect(await titles('neuer')).toEqual(['Notizen'])
    await push([op('block', 'delete', b, {}, 2)])
    expect(await titles('neuer')).toEqual([])
    await push([op('document', 'update', doc, { title: 'Umbenannt' }, 1)])
    expect(await titles('umbenannt')).toEqual(['Umbenannt'])
    await push([op('document', 'delete', doc, {}, 2)])
    expect(await titles('umbenannt')).toEqual([])
  })

  it('#99: rebuilds a page once per push, with every block of the batch', async () => {
    const doc = randomUUID()
    const ops = [op('document', 'create', doc, page('Lang'))]
    for (let i = 0; i < 300; i++) {
      ops.push(
        op('block', 'create', randomUUID(), { ...block(doc, `zeile${i}`), sortKey: `a${i}` }),
      )
    }
    await push(ops)
    const marks = await sql<{ n: number }>`select count(*) as n from search_dirty`.execute(app.db)
    expect(marks.rows[0]!.n).toBe(0)
    expect(await titles('zeile0')).toEqual(['Lang'])
    expect(await titles('zeile299')).toEqual(['Lang'])
  })

  it('#99: an operation applied without the push route (crash) is indexed before searching', async () => {
    const user = (await app.inject({ url: '/api/auth/me', headers: { cookie } })).json().user
    const doc = randomUUID()
    await push([op('document', 'create', doc, page('Absturz'))])
    // Applied and committed, but the process dies before the push route reindexes.
    await applyOperation(
      app.db,
      user.id,
      op('block', 'create', randomUUID(), block(doc, 'gerettet')),
    )
    const marks = await sql<{ n: number }>`select count(*) as n from search_dirty`.execute(app.db)
    expect(marks.rows[0]!.n).toBe(1)
    expect(
      (await searchWorkspace(app.db, user.id, workspaceId, 'gerettet'))?.map((h) => h.title),
    ).toEqual(['Absturz'])
    // Startup does the same; nothing is left to do now.
    await reindexMarked(app.db)
    expect(await titles('gerettet')).toEqual(['Absturz'])
  })

  it('never returns hits from foreign workspaces', async () => {
    await push([op('document', 'create', randomUUID(), page('Geheim'))])
    const bob = await signUp('bob@example.com')
    await push([op('document', 'create', randomUUID(), page('Bobs Seite'), null, bob)], bob.cookie)
    expect((await search('geheim', workspaceId, bob.cookie)).statusCode).toBe(404)
    const bobs = (await search('geheim', bob.workspaceId, bob.cookie)).json().hits
    expect(bobs).toEqual([])
  })

  it('treats FTS syntax in the input as plain words', async () => {
    await push([op('document', 'create', randomUUID(), page('Alpha Beta'))])
    expect((await search('"alpha" OR title:x NEAR(')).statusCode).toBe(200)
    expect(toFtsQuery('a" OR b*')).toBe('"a"* "OR"* "b*"*')
    expect(toFtsQuery('  -- ')).toBeNull()
    expect((await search('')).statusCode).toBe(400)
  })
})

describe('migration 0005_search', () => {
  it('fills the index from existing pages', async () => {
    const db = createDatabase(':memory:')
    const migrator = new Migrator({ db, provider: { getMigrations: async () => migrations } })
    await migrator.migrateTo('0004_change_log_floor')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- schema of an older version
    const old = db as any
    await old
      .insertInto('users')
      .values({ id: 'u1', email: 'a@example.com', password_hash: 'h', created_at: 'now' })
      .execute()
    await old
      .insertInto('workspaces')
      .values({ id: 'w1', name: 'P', owner_id: 'u1', created_at: 'now', compacted_seq: 0 })
      .execute()
    const doc = { workspace_id: 'w1', parent_id: null, sort_key: 'a', favorite: 0 }
    const times = { created_at: 'x', updated_at: 'x', revision: 1 }
    await old
      .insertInto('documents')
      .values([
        { id: 'd1', title: 'Bestand', deleted_at: null, ...doc, ...times },
        { id: 'd2', title: 'Gelöscht', deleted_at: 'x', ...doc, ...times },
      ])
      .execute()
    await old
      .insertInto('blocks')
      .values({
        id: 'b1',
        workspace_id: 'w1',
        document_id: 'd1',
        type: 'paragraph',
        content: '_kursiver_ Altbestand',
        attrs: '{}',
        sort_key: 'a',
        revision: 1,
        deleted_at: null,
      })
      .execute()

    await migrateToLatest(db)
    const { rows } = await sql<{
      document_id: string
      body: string
    }>`select document_id, body from search_index`.execute(db)
    expect(rows).toEqual([{ document_id: 'd1', body: 'kursiver Altbestand' }])
    await db.destroy()
  })
})
