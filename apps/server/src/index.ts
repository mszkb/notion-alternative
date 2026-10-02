import { buildApp } from './app'
import { deleteExpiredSessions } from './auth/sessions'
import { loadConfig } from './config'
import { createDatabase } from './db/database'
import { migrateToLatest } from './db/migrate'

const config = loadConfig()
const db = createDatabase(config.databasePath)
await migrateToLatest(db)
await deleteExpiredSessions(db)

const app = await buildApp({ db, config, logger: { level: config.logLevel } })
app.log.info({ databasePath: config.databasePath }, 'database ready')

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down')
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    )
  })
}

await app.listen({ host: config.host, port: config.port })
