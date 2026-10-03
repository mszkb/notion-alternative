import { Migrator, type Migration } from 'kysely/migration'
import type { Db } from './database'
import * as m0001 from './migrations/0001_initial'
import * as m0002 from './migrations/0002_devices'
import * as m0003 from './migrations/0003_sync'
import * as m0004 from './migrations/0004_change_log_floor'
import * as m0005 from './migrations/0005_search'
import * as m0006 from './migrations/0006_conflicts'
import * as m0007 from './migrations/0007_push'

// Migrations are registered statically so they survive bundling.
export const migrations: Record<string, Migration> = {
  '0001_initial': m0001,
  '0002_devices': m0002,
  '0003_sync': m0003,
  '0004_change_log_floor': m0004,
  '0005_search': m0005,
  '0006_conflicts': m0006,
  '0007_push': m0007,
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
