import {
  createJsonExport,
  type ExportHistory,
  jsonExportChunks,
  SYNC_PULL_MAX_LIMIT,
  type SyncLogQuery,
  type SyncLogResponse,
} from '@notion-alt/shared'
import type { LocalStore } from '../local/store'
import { exportFileName } from './markdown'

export interface JsonExportResult {
  fileName: string
  blob: Blob
  documents: number
  changes: number | null
}

/** Reads the whole change log of the workspace from the server, page by page. */
export async function fetchHistory(
  workspaceId: string,
  syncLog: (query: SyncLogQuery) => Promise<SyncLogResponse>,
): Promise<ExportHistory> {
  const changes: ExportHistory['changes'] = []
  let cursor = 0
  for (;;) {
    const page = await syncLog({ workspaceId, cursor, limit: SYNC_PULL_MAX_LIMIT })
    changes.push(...page.changes)
    cursor = page.cursor
    if (!page.hasMore) return { compactedSeq: page.compactedSeq, changes }
  }
}

/**
 * Lossless JSON export (ADR 0004). The current state comes from the local database (offline,
 * including unsynced changes); the history is the server's change log and needs a connection.
 */
export async function buildJsonExport(
  store: LocalStore,
  workspace: { id: string; name: string },
  options: {
    /** Omit to export without history. */
    syncLog?: (query: SyncLogQuery) => Promise<SyncLogResponse>
    now?: Date
  } = {},
): Promise<JsonExportResult> {
  const now = options.now ?? new Date()
  const input = await store.exportData(workspace.id)
  const history = options.syncLog ? await fetchHistory(workspace.id, options.syncLog) : null
  const data = createJsonExport(input, {
    workspace,
    exportedAt: now.toISOString(),
    history,
  })
  return {
    fileName: exportFileName(workspace.name, 'json', now, 'json'),
    blob: new Blob([...jsonExportChunks(data)], { type: 'application/json' }),
    documents: data.documents.filter((d) => !d.deletedAt).length,
    changes: history?.changes.length ?? null,
  }
}
