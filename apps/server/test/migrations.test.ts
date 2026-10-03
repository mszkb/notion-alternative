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
    expect(tables.map((t) => t.name).sort()).toEqual(['devices', 'sessions', 'users', 'workspaces'])
    await db.destroy()
  })

  it('T-MIG-01: 0002_devices keeps existing users and sessions', async () => {
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

    await migrateToLatest(db)
    const session = await db.selectFrom('sessions').selectAll().executeTakeFirstOrThrow()
    expect(session).toMatchObject({ id: 's1', user_id: 'u1', device_id: null })
    expect(await db.selectFrom('users').select('email').execute()).toEqual([
      { email: 'a@example.com' },
    ])
    await db.destroy()
  })
})
