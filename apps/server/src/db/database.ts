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
  cacheStatements(sqlite)
  return new Kysely<Database>({ dialect: new SqliteDialect({ database: sqlite }) })
}

/**
 * Kysely prepares every query anew, which was about 40 % of the SQL time of a push (#95). Reuses
 * the prepared statement per SQL text. Bounded, because queries with variable `in` lists produce
 * many distinct texts. Safe because Kysely only runs statements to completion (`all`/`run`) on
 * this single connection; nothing here streams (`iterate`) or switches statement modes.
 */
function cacheStatements(sqlite: SQLite.Database, limit = 500): void {
  const prepare = sqlite.prepare.bind(sqlite)
  const cache = new Map<string, SQLite.Statement>()
  sqlite.prepare = ((source: string) => {
    let statement = cache.get(source)
    if (!statement) {
      if (cache.size >= limit) cache.clear()
      statement = prepare(source)
      cache.set(source, statement)
    }
    return statement
  }) as typeof sqlite.prepare
}
