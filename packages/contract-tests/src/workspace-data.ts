import {
  type Change,
  createJsonExport,
  type JsonExport,
  remapExportIds,
  type SyncSnapshotResponse,
} from '@notion-alt/shared'
import { randomUUID } from 'node:crypto'
import { expect } from 'vitest'
import { type Client, expectStatus, query } from './client'

export async function snapshot(client: Client, workspaceId: string): Promise<SyncSnapshotResponse> {
  return expectStatus(await client.get(`/api/sync/snapshot?${query({ workspaceId })}`), 200).json()
}

export async function changeLog(
  client: Client,
  workspaceId: string,
): Promise<{ changes: Change[]; compactedSeq: number }> {
  const response = await client.get(`/api/sync/log?${query({ workspaceId, limit: 1000 })}`)
  return expectStatus(response, 200).json()
}

/** Builds a JSON export from the server state, like the client does from its local DB. */
export async function exportWorkspace(
  client: Client,
  workspaceId: string,
  name = 'Quelle',
): Promise<JsonExport> {
  const state = await snapshot(client, workspaceId)
  const log = await changeLog(client, workspaceId)
  return createJsonExport(
    { ...state },
    {
      workspace: { id: workspaceId, name },
      exportedAt: new Date().toISOString(),
      history: { compactedSeq: log.compactedSeq, changes: log.changes },
    },
  )
}

/**
 * Imports a copy with new ids (the server keeps ids, so the original cannot be imported twice
 * into the same server); returns the new workspace id and the id mapping.
 */
export async function importCopy(client: Client, data: JsonExport, name = 'Importiert') {
  const copy = remapExportIds(data, randomUUID)
  const response = expectStatus(await client.post('/api/import', { name, data: copy.data }), 201)
  return { workspaceId: response.json().workspace.id as string, ...copy }
}

type Entity = { id: string; workspaceId?: string }
/** Workspace ids differ by design; everything else must survive unchanged. */
const comparable = (items: Entity[]) =>
  items.map(({ workspaceId: _ws, ...rest }) => rest).sort((a, b) => a.id.localeCompare(b.id))

/** Asserts that a snapshot holds exactly the entities of an export. */
export function expectSameContent(
  actual: SyncSnapshotResponse,
  expected: Pick<JsonExport, 'documents' | 'blocks' | 'tags' | 'document_tags' | 'attachments'>,
) {
  expect(comparable(actual.documents)).toEqual(comparable(expected.documents))
  expect(comparable(actual.blocks)).toEqual(comparable(expected.blocks))
  expect(comparable(actual.tags)).toEqual(comparable(expected.tags))
  expect(comparable(actual.documentTags)).toEqual(comparable(expected.document_tags))
  expect(comparable(actual.attachments)).toEqual(comparable(expected.attachments))
}
