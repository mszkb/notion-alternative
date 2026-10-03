import { buildApp } from './app'
import { S3Store, VolumeStore } from './attachments/content-store'
import { migrateAttachments } from './attachments/migrate-to-s3'
import { purgeDeletedAttachments } from './attachments/storage'
import { deleteExpiredSessions } from './auth/sessions'
import { loadConfig } from './config'
import { createDatabase } from './db/database'
import { migrateToLatest } from './db/migrate'

const config = loadConfig()
const db = createDatabase(config.databasePath)
await migrateToLatest(db)

// One-off command: copy attachment files from the volume to S3 (#63), then exit.
if (process.argv[2] === 'migrate-attachments-to-s3') {
  if (!config.attachments.s3) {
    console.error('Set ATTACHMENT_STORAGE=s3 and the S3_* variables first.')
    process.exit(1)
  }
  const report = await migrateAttachments(
    db,
    new VolumeStore(config.attachments.dir),
    new S3Store(config.attachments.s3),
  )
  console.log(JSON.stringify(report))
  await db.destroy()
  process.exit(report.failed.length ? 1 : 0)
}

await deleteExpiredSessions(db)

const app = await buildApp({ db, config, logger: { level: config.logLevel } })
app.log.info({ databasePath: config.databasePath }, 'database ready')

// Deleted attachments keep their file for the retention period; clean up daily.
async function purgeAttachments() {
  const removed = await purgeDeletedAttachments(
    db,
    app.contentStore,
    config.attachments.retentionDays,
  )
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
