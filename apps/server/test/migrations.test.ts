import { Migrator } from 'kysely/migration'
import { describe, expect, it } from 'vitest'
import { createDatabase } from '../src/db/database'
import { migrateToLatest, migrations } from '../src/db/migrate'

describe('migrations', () => {
  it('are idempotent when run repeatedly', async () => {
    const db = createDatabase(':memory:')
    await migrateToLatest(db)
    await migrateToLatest(db)
    const tables = await db.introspection.getTables()
    // FTS5 keeps its data in shadow tables (search_index_*).
    const names = tables.map((t) => t.name).filter((name) => !name.startsWith('search_index_'))
    expect(names.sort()).toEqual([
      'blocks',
      'changes',
      'devices',
      'document_tags',
      'documents',
      'search_index',
      'sessions',
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
})
