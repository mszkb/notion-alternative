import fs from 'node:fs'
import path from 'node:path'
import SQLite from 'better-sqlite3'
import { Kysely, SqliteDialect } from 'kysely'
import type { Database } from './schema'

export type Db = Kysely<Database>

/** Opens the SQLite database (":memory:" for tests) and applies connection pragmas. */
export function createDatabase(databasePath: string): Db {
  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true })
  }
  const sqlite = new SQLite(databasePath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  return new Kysely<Database>({ dialect: new SqliteDialect({ database: sqlite }) })
}
