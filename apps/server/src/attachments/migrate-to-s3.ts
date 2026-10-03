import { createHash } from 'node:crypto'
import type { Db } from '../db/database'
import { type ContentStore, readAll } from './content-store'

export interface MigrationReport {
  copied: number
  skipped: number
  failed: string[]
}

/**
 * Copies every stored attachment from the volume to S3 and verifies the checksum (#63).
 * Idempotent: run again after an interruption. The volume files stay until the operator
 * removes them (see docs/operations/deployment.md).
 */
export async function migrateAttachments(
  db: Db,
  from: ContentStore,
  to: ContentStore,
): Promise<MigrationReport> {
  const report: MigrationReport = { copied: 0, skipped: 0, failed: [] }
  const rows = await db
    .selectFrom('attachments')
    .select(['id', 'workspace_id', 'sha256'])
    .where('stored_at', 'is not', null)
    .execute()
  for (const row of rows) {
    const source = await from.get(row.workspace_id, row.id)
    if (!source) {
      report.skipped++
      continue
    }
    const data = await readAll(source)
    if (createHash('sha256').update(data).digest('hex') !== row.sha256) {
      report.failed.push(row.id)
      continue
    }
    await to.put(row.workspace_id, row.id, data)
    const copy = await to.get(row.workspace_id, row.id)
    const copied = copy ? await readAll(copy) : null
    if (copied && createHash('sha256').update(copied).digest('hex') === row.sha256) report.copied++
    else report.failed.push(row.id)
  }
  return report
}
