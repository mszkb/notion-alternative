import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Db } from '../db/database'
import type { ContentStore } from './content-store'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** File of an attachment: `<dir>/<workspace>/<id>` (both UUIDs, never user-chosen names). */
export function contentPath(dir: string, workspaceId: string, id: string): string {
  if (!UUID.test(workspaceId) || !UUID.test(id)) throw new Error('Invalid attachment path')
  return path.join(dir, workspaceId, id)
}

/** Writes atomically (temp file + rename): a crash never leaves a half-written attachment. */
export async function storeContent(
  dir: string,
  workspaceId: string,
  id: string,
  data: Buffer,
): Promise<void> {
  const target = contentPath(dir, workspaceId, id)
  await mkdir(path.dirname(target), { recursive: true })
  const temp = `${target}.${process.pid}.tmp`
  await writeFile(temp, data)
  await rename(temp, target)
}

/**
 * Removes the files of attachments deleted longer than `retentionDays` ago (ADR 0012). The
 * tombstones stay for the sync; only the content goes. Returns the number of removed files.
 */
export async function purgeDeletedAttachments(
  db: Db,
  store: ContentStore,
  retentionDays: number,
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString()
  const rows = await db
    .selectFrom('attachments')
    .select(['id', 'workspace_id'])
    .where('deleted_at', 'is not', null)
    .where('deleted_at', '<', cutoff)
    .where('stored_at', 'is not', null)
    .execute()
  for (const row of rows) {
    await store.remove(row.workspace_id, row.id)
    await db.updateTable('attachments').set({ stored_at: null }).where('id', '=', row.id).execute()
  }
  return rows.length
}
