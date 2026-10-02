import { describe, expect, it } from 'vitest'
import { createDatabase } from '../src/db/database'
import { migrateToLatest } from '../src/db/migrate'

describe('migrations', () => {
  it('are idempotent when run repeatedly', async () => {
    const db = createDatabase(':memory:')
    await migrateToLatest(db)
    await migrateToLatest(db)
    const tables = await db.introspection.getTables()
    expect(tables.map((t) => t.name).sort()).toEqual(['sessions', 'users', 'workspaces'])
    await db.destroy()
  })
})
