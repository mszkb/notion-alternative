import { Migrator, type Migration } from 'kysely/migration'
import type { Db } from './database'
import * as m0001 from './migrations/0001_initial'
import * as m0002 from './migrations/0002_devices'

// Migrations are registered statically so they survive bundling.
export const migrations: Record<string, Migration> = {
  '0001_initial': m0001,
  '0002_devices': m0002,
}

export async function migrateToLatest(db: Db): Promise<void> {
  const migrator = new Migrator({
    db,
    provider: { getMigrations: async () => migrations },
  })
  const { error, results } = await migrator.migrateToLatest()
  const failed = results?.find((result) => result.status === 'Error')
  if (error || failed) {
    throw new Error(`Migration ${failed?.migrationName ?? ''} failed`, { cause: error })
  }
}
