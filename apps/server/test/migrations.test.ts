import { sql } from 'kysely'
import { Migrator } from 'kysely/migration'
import { describe, expect, it } from 'vitest'
import { createDatabase } from '../src/db/database'
import { migrateToLatest, migrations } from '../src/db/migrate'
import { reindexDocument, searchWorkspace } from '../src/search/index'

describe('migrations', () => {
  it('are idempotent when run repeatedly', async () => {
    const db = createDatabase(':memory:')
    await migrateToLatest(db)
    await migrateToLatest(db)
    const tables = await db.introspection.getTables()
    // FTS5 keeps its data in shadow tables (search_index_*).
    const names = tables.map((t) => t.name).filter((name) => !name.startsWith('search_index_'))
    expect(names.sort()).toEqual([
      'attachments',
      'auth_attempts',
      'blocks',
      'changes',
      'conflicts',
      'devices',
      'document_tags',
      'documents',
      'metrics',
      'push_hints',
      'push_subscriptions',
      'search_dirty',
      'search_documents',
      'search_index',
      'sessions',
      'settings',
      'tags',
      'users',
      'workspaces',
    ])
    await db.destroy()
  })

  it('T-MIG-01: later migrations keep existing users, sessions and workspaces', async () => {
    const db = createDatabase(':memory:')
    const migrator = new Migrator({ db, provider: { getMigrations: async () => migrations } })
    await migrator.migrateTo('0001_initial')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- schema of an older version
    const old = db as any
    await old
      .insertInto('users')
      .values({ id: 'u1', email: 'a@example.com', password_hash: 'h', created_at: 'now' })
      .execute()
    await old
      .insertInto('sessions')
      .values({ id: 's1', user_id: 'u1', created_at: 'now', expires_at: '2999-01-01' })
      .execute()

    await old
      .insertInto('workspaces')
      .values({ id: 'w1', name: 'Personal', owner_id: 'u1', created_at: 'now' })
      .execute()

    await migrateToLatest(db)
    expect(await db.selectFrom('workspaces').select(['id', 'compacted_seq']).execute()).toEqual([
      { id: 'w1', compacted_seq: 0 },
    ])
    const session = await db.selectFrom('sessions').selectAll().executeTakeFirstOrThrow()
    expect(session).toMatchObject({ id: 's1', user_id: 'u1', device_id: null })
    expect(await db.selectFrom('users').select('email').execute()).toEqual([
      { email: 'a@example.com' },
    ])
    await db.destroy()
  })

  it('T-MIG-01: 0009 keeps existing search entries and addresses them by rowid', async () => {
    const db = createDatabase(':memory:')
    const migrator = new Migrator({ db, provider: { getMigrations: async () => migrations } })
    await migrator.migrateTo('0008_attachments')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- schema of an older version
    const old = db as any
    await old
      .insertInto('users')
      .values({ id: 'u1', email: 'a@example.com', password_hash: 'h', created_at: 'now' })
      .execute()
    await old
      .insertInto('workspaces')
      .values({ id: 'w1', name: 'Personal', owner_id: 'u1', created_at: 'now' })
      .execute()
    await old
      .insertInto('documents')
      .values({
        id: 'd1',
        workspace_id: 'w1',
        parent_id: null,
        title: 'Einkaufsliste',
        sort_key: 'a0',
        favorite: 0,
        created_at: 'now',
        updated_at: 'now',
        revision: 1,
        deleted_at: null,
      })
      .execute()
    await sql`insert into search_index (document_id, workspace_id, title, body)
      values ('d1', 'w1', 'Einkaufsliste', 'Milch')`.execute(db)

    await migrateToLatest(db)
    expect((await searchWorkspace(db, 'u1', 'w1', 'milch'))?.map((h) => h.documentId)).toEqual([
      'd1',
    ])
    // Reindexing replaces the migrated row instead of adding a second one.
    await db.updateTable('documents').set({ title: 'Wochenmarkt' }).where('id', '=', 'd1').execute()
    await reindexDocument(db, 'd1')
    const { rows } = await sql<{ n: number }>`select count(*) as n from search_index`.execute(db)
    expect(rows[0]!.n).toBe(1)
    expect(await searchWorkspace(db, 'u1', 'w1', 'einkauf')).toEqual([])
    expect(await searchWorkspace(db, 'u1', 'w1', 'wochenmarkt')).toHaveLength(1)
    // A deleted page leaves the index and its rowid entry.
    await db.updateTable('documents').set({ deleted_at: 'now' }).where('id', '=', 'd1').execute()
    await reindexDocument(db, 'd1')
    const left = await sql<{ n: number }>`
      select (select count(*) from search_index) + (select count(*) from search_documents) as n`.execute(
      db,
    )
    expect(left.rows[0]!.n).toBe(0)
    await db.destroy()
  })
})
