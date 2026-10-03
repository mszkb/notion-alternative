import {
  compareBySortKey,
  type DocumentVersion,
  type DocumentVersionState,
} from '@notion-alt/shared'
import type { Db } from '../db/database'
import { findWorkspaceForUser } from '../workspaces/repository'

/** Changes of one device less than this apart form one version (ADR 0013). */
export const SESSION_GAP_MS = 10 * 60 * 1000

/** All change-log entries of a page and its blocks, oldest first; null if not the user's. */
async function documentChanges(db: Db, userId: string, workspaceId: string, documentId: string) {
  if (!(await findWorkspaceForUser(db, workspaceId, userId))) return null
  const document = await db
    .selectFrom('documents')
    .select('id')
    .where('id', '=', documentId)
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst()
  if (!document) return null
  const blockIds = (
    await db.selectFrom('blocks').select('id').where('document_id', '=', documentId).execute()
  ).map((row) => row.id)
  return db
    .selectFrom('changes')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where((eb) =>
      eb.or([
        eb.and([eb('entity', '=', 'document'), eb('entity_id', '=', documentId)]),
        ...(blockIds.length
          ? [eb.and([eb('entity', '=', 'block'), eb('entity_id', 'in', blockIds)])]
          : []),
      ]),
    )
    .orderBy('seq')
    .execute()
}

/** Versions of a page, newest first (ADR 0013). */
export async function listVersions(
  db: Db,
  userId: string,
  workspaceId: string,
  documentId: string,
  limit = 200,
): Promise<DocumentVersion[] | null> {
  const changes = await documentChanges(db, userId, workspaceId, documentId)
  if (!changes) return null
  const versions: DocumentVersion[] = []
  for (const change of changes) {
    const last = versions.at(-1)
    const close =
      last &&
      last.deviceId === change.device_id &&
      Date.parse(change.applied_at) - Date.parse(last.at) <= SESSION_GAP_MS
    if (close) {
      last.seq = change.seq
      last.at = change.applied_at
      last.changes++
    } else {
      versions.push({
        seq: change.seq,
        at: change.applied_at,
        deviceId: change.device_id,
        changes: 1,
      })
    }
  }
  return versions.reverse().slice(0, limit)
}

type Fields = Record<string, unknown>

/** Rebuilds page and blocks as they were after change `seq` (ADR 0013). */
export async function versionState(
  db: Db,
  userId: string,
  workspaceId: string,
  documentId: string,
  seq: number,
): Promise<DocumentVersionState | null> {
  const changes = await documentChanges(db, userId, workspaceId, documentId)
  if (!changes) return null
  let document: Fields | null = null
  const blocks = new Map<string, Fields>()
  for (const change of changes) {
    if (change.seq > seq) break
    const payload = JSON.parse(change.payload) as Fields
    const fold = (current: Fields | null | undefined): Fields | null => {
      if (change.kind === 'create') return { id: change.entity_id, ...payload, deletedAt: null }
      if (!current) return null
      if (change.kind === 'delete') return { ...current, deletedAt: change.applied_at }
      if (change.kind === 'restore') return { ...current, deletedAt: null }
      return { ...current, ...payload }
    }
    if (change.entity === 'document') document = fold(document)
    else {
      const next = fold(blocks.get(change.entity_id))
      if (next) blocks.set(change.entity_id, next)
    }
  }
  if (!document) return null
  return {
    seq,
    document: {
      id: documentId,
      title: String(document.title ?? ''),
      parentId: (document.parentId as string | null) ?? null,
      favorite: Boolean(document.favorite),
      deletedAt: (document.deletedAt as string | null) ?? null,
    },
    blocks: [...blocks.values()]
      .filter((block) => !block.deletedAt)
      .map((block) => ({
        id: String(block.id),
        type: block.type as DocumentVersionState['blocks'][number]['type'],
        content: String(block.content ?? ''),
        attrs: (block.attrs ?? {}) as DocumentVersionState['blocks'][number]['attrs'],
        sortKey: String(block.sortKey),
      }))
      .sort(compareBySortKey),
  }
}
