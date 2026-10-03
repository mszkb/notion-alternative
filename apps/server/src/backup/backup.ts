import { createHash } from 'node:crypto'
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import Database from 'better-sqlite3'
import { sql } from 'kysely'
import { z } from 'zod'
import { contentPath } from '../attachments/storage'
import type { Config } from '../config'
import { createDatabase } from '../db/database'
import { migrateToLatest } from '../db/migrate'

/**
 * Backup and restore of a server (#75): the SQLite database (all content, change log, users,
 * sessions, devices, push subscriptions, VAPID keys) via SQLite's online backup, consistent while
 * the server runs, plus the attachment files of the volume. Not included: `.env`/configuration
 * (on the host) and attachments in S3 (back up the bucket).
 */

export const BACKUP_FORMAT = 'notion-alt-backup'
const DATABASE_FILE = 'app.sqlite'
const ATTACHMENTS_FOLDER = 'attachments'

/**
 * Sequence numbers handed out after a restore start this far above the restored state, so they
 * never repeat numbers that devices saw before the restore; every device re-syncs (410).
 */
export const RESTORE_SEQ_GAP = 1_000_000

const manifestSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(1),
  createdAt: z.string(),
  /** Last applied database migration; a restore migrates from there. */
  migration: z.string().nullable(),
  attachmentStorage: z.enum(['volume', 's3']),
  files: z.array(z.object({ path: z.string(), size: z.number(), sha256: z.string() })),
  /** Attachments whose file was missing when the backup was taken. */
  missingAttachments: z.array(z.string()),
})
export type BackupManifest = z.infer<typeof manifestSchema>

async function sha256File(file: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(file))
    .digest('hex')
}

function stamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-')
}

/** Creates `backup-<time>/` in `targetRoot` and returns its path and manifest. */
export async function createBackup(
  config: Config,
  targetRoot: string,
  now = new Date(),
): Promise<{ dir: string; manifest: BackupManifest }> {
  const dir = path.join(targetRoot, `backup-${stamp(now)}`)
  const work = `${dir}.partial`
  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })

  // 1. Database: online backup, a consistent copy even while the server writes.
  const source = new Database(config.databasePath, { readonly: true, fileMustExist: true })
  try {
    await source.backup(path.join(work, DATABASE_FILE))
  } finally {
    source.close()
  }

  // 2. Attachment files referenced by the copied database (files never change after upload).
  const copy = new Database(path.join(work, DATABASE_FILE), { readonly: true })
  let migration: string | null
  let attachments: { id: string; workspace_id: string; sha256: string }[] = []
  try {
    migration =
      (
        copy.prepare('select name from kysely_migration order by name desc limit 1').get() as
          { name: string } | undefined
      )?.name ?? null
    // Databases from before attachments (migration 0008) have no such table.
    const hasAttachments = copy
      .prepare("select 1 from sqlite_master where type = 'table' and name = 'attachments'")
      .get()
    if (hasAttachments) {
      attachments = copy
        .prepare('select id, workspace_id, sha256 from attachments where stored_at is not null')
        .all() as typeof attachments
    }
  } finally {
    copy.close()
  }
  const missingAttachments: string[] = []
  const storage = config.attachments.s3 ? 's3' : 'volume'
  if (storage === 'volume') {
    for (const attachment of attachments) {
      const from = contentPath(config.attachments.dir, attachment.workspace_id, attachment.id)
      const relative = path.join(ATTACHMENTS_FOLDER, attachment.workspace_id, attachment.id)
      try {
        await mkdir(path.dirname(path.join(work, relative)), { recursive: true })
        await copyFile(from, path.join(work, relative))
      } catch {
        // Purged after deletion in the meantime, or lost: recorded, the backup goes on.
        missingAttachments.push(attachment.id)
      }
    }
  }

  // 3. Manifest with checksums of every file.
  const files: BackupManifest['files'] = []
  const walk = async (folder: string) => {
    for (const entry of await readdir(path.join(work, folder), { withFileTypes: true })) {
      const relative = path.join(folder, entry.name)
      if (entry.isDirectory()) await walk(relative)
      else {
        const full = path.join(work, relative)
        files.push({
          path: relative.split(path.sep).join('/'),
          size: (await stat(full)).size,
          sha256: await sha256File(full),
        })
      }
    }
  }
  await walk('')
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: 1,
    createdAt: now.toISOString(),
    migration,
    attachmentStorage: storage,
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    missingAttachments,
  }
  await writeFile(path.join(work, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  // Only a complete backup gets the final name.
  await rename(work, dir)
  return { dir, manifest }
}

/** Reads and checks a backup completely; throws with the first problem. */
export async function verifyBackup(dir: string): Promise<BackupManifest> {
  let manifest: BackupManifest
  try {
    manifest = manifestSchema.parse(
      JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8')),
    )
  } catch {
    throw new Error(`${dir}: no valid backup (manifest.json missing or invalid)`)
  }
  for (const file of manifest.files) {
    if (file.path.split('/').some((part) => part === '..' || part === '')) {
      throw new Error(`Unsafe path in backup: ${file.path}`)
    }
    const full = path.join(dir, file.path)
    let size: number
    try {
      size = (await stat(full)).size
    } catch {
      throw new Error(`File missing in backup: ${file.path}`)
    }
    if (size !== file.size || (await sha256File(full)) !== file.sha256) {
      throw new Error(`Checksum mismatch in backup: ${file.path}`)
    }
  }
  if (!manifest.files.some((f) => f.path === DATABASE_FILE)) {
    throw new Error('Backup contains no database')
  }
  return manifest
}

export interface RestoreReport {
  manifest: BackupManifest
  attachments: number
  migratedFrom: string | null
}

/**
 * Restores a verified backup into the configured locations. The server must be stopped.
 * Refuses to replace an existing database unless `force` is set. Afterwards the database is
 * migrated to the current version (T-MIG-01) and sequence numbers are lifted so every device
 * re-syncs and sends what the backup does not contain.
 */
export async function restoreBackup(
  config: Config,
  dir: string,
  options: { force?: boolean } = {},
): Promise<RestoreReport> {
  const manifest = await verifyBackup(dir)
  const target = config.databasePath
  const exists = await stat(target).then(
    () => true,
    () => false,
  )
  if (exists && !options.force) {
    throw new Error(`${target} exists. Stop the server and pass --force to replace it.`)
  }
  await mkdir(path.dirname(target), { recursive: true })
  for (const suffix of ['', '-wal', '-shm']) await rm(`${target}${suffix}`, { force: true })
  await copyFile(path.join(dir, DATABASE_FILE), `${target}.restoring`)
  await rename(`${target}.restoring`, target)

  let attachments = 0
  for (const file of manifest.files) {
    if (!file.path.startsWith(`${ATTACHMENTS_FOLDER}/`)) continue
    const [, workspaceId, id] = file.path.split('/')
    const destination = contentPath(config.attachments.dir, workspaceId!, id!)
    await mkdir(path.dirname(destination), { recursive: true })
    await copyFile(path.join(dir, file.path), destination)
    attachments++
  }

  const db = createDatabase(target)
  try {
    await migrateToLatest(db)
    await sql`update workspaces set compacted_seq = max(
      compacted_seq,
      coalesce((select max(seq) from changes where changes.workspace_id = workspaces.id), 0)
    ) + ${RESTORE_SEQ_GAP}`.execute(db)
  } finally {
    await db.destroy()
  }
  return { manifest, attachments, migratedFrom: manifest.migration }
}
