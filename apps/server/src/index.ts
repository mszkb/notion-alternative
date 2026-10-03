import { buildApp } from './app'
import { purgeDeletedAttachments } from './attachments/storage'
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

// Deleted attachments keep their file for the retention period; clean up daily.
async function purgeAttachments() {
  const { dir, retentionDays } = config.attachments
  const removed = await purgeDeletedAttachments(db, dir, retentionDays)
  if (removed > 0) app.log.info({ removed }, 'deleted attachment files purged')
}
void purgeAttachments().catch((err) => app.log.error({ err }, 'attachment purge failed'))
const purgeTimer = setInterval(
  () => void purgeAttachments().catch((err) => app.log.error({ err }, 'attachment purge failed')),
  24 * 60 * 60 * 1000,
)
purgeTimer.unref()

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
