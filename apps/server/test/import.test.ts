import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  createJsonExport,
  type JsonExport,
  type Operation,
  remapExportIds,
  type SyncSnapshotResponse,
} from '@notion-alt/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, register, type TestApp } from './helpers'

interface Account {
  app: TestApp
  cookie: string
  workspaceId: string
  deviceId: string
}

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex')

let dir: string
let source: Account
let target: Account

async function account(email: string): Promise<Account> {
  const { app } = await createTestApp({
    allowRegistration: true,
    attachments: { dir, maxBytes: 1_000_000, retentionDays: 30, workspaceQuotaBytes: 10_000 },
  })
  const { cookie } = await register(app, email)
  const workspaceId = (await app.inject({ url: '/api/workspaces', headers: { cookie } })).json()
    .workspaces[0].id
  const deviceId = randomUUID()
  await app.inject({
    method: 'POST',
    url: '/api/devices',
    headers: { cookie },
    payload: { id: deviceId, name: 'Test' },
  })
  return { app, cookie, workspaceId, deviceId }
}

function op(
  a: Account,
  entity: Operation['entity'],
  kind: Operation['kind'],
  entityId: string,
  payload: object,
  baseRevision: number | null = null,
): Operation {
  return {
    opId: randomUUID(),
    deviceId: a.deviceId,
    workspaceId: a.workspaceId,
    entity,
    entityId,
    kind,
    baseRevision,
    payload: payload as Record<string, unknown>,
    createdAt: new Date().toISOString(),
  }
}

async function push(a: Account, ...operations: Operation[]) {
  const response = await a.app.inject({
    method: 'POST',
    url: '/api/sync/push',
    headers: { cookie: a.cookie },
    payload: { operations },
  })
  return response.json().results as { status: string; seq?: number }[]
}

async function get<T>(a: Account, url: string): Promise<T> {
  return (await a.app.inject({ url, headers: { cookie: a.cookie } })).json() as T
}

const snapshot = (a: Account, workspaceId = a.workspaceId) =>
  get<SyncSnapshotResponse>(a, `/api/sync/snapshot?workspaceId=${workspaceId}`)

/** Builds a JSON export from the server state (the client does the same from its local DB). */
async function exportFrom(a: Account): Promise<JsonExport> {
  const s = await snapshot(a)
  const log = await get<{ changes: never[]; compactedSeq: number }>(
    a,
    `/api/sync/log?workspaceId=${a.workspaceId}`,
  )
  return createJsonExport(
    { ...s },
    {
      workspace: { id: a.workspaceId, name: 'Quelle' },
      exportedAt: new Date().toISOString(),
      history: { compactedSeq: log.compactedSeq, changes: log.changes },
    },
  )
}

function importInto(a: Account, data: JsonExport, name = 'Importiert') {
  return a.app.inject({
    method: 'POST',
    url: '/api/import',
    headers: { cookie: a.cookie },
    payload: { name, data },
  })
}

const docId = randomUUID()
const childId = randomUUID()
const deletedId = randomUUID()
const blockId = randomUUID()
const tagId = randomUUID()
const attachmentId = randomUUID()

async function fillSource() {
  const doc = (id: string, title: string, parentId: string | null = null) =>
    op(source, 'document', 'create', id, {
      parentId,
      title,
      sortKey: 'a0',
      favorite: false,
      createdAt: new Date().toISOString(),
    })
  await push(
    source,
    doc(docId, 'Projekte'),
    doc(childId, 'Alpha', docId),
    doc(deletedId, 'Weg'),
    op(source, 'block', 'create', blockId, {
      documentId: docId,
      type: 'paragraph',
      content: `Siehe [Alpha](page:${childId}) zum Thema Zebrafinken`,
      attrs: {},
      sortKey: 'a0',
    }),
    op(source, 'tag', 'create', tagId, { name: 'wichtig' }),
    op(source, 'document_tag', 'create', randomUUID(), { documentId: childId, tagId }),
    op(source, 'attachment', 'create', attachmentId, {
      documentId: childId,
      name: 'bild.png',
      mimeType: 'image/png',
      size: PNG.length,
      sha256: sha(PNG),
      createdAt: new Date().toISOString(),
    }),
  )
  await push(source, op(source, 'document', 'delete', deletedId, {}, 1))
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'import-'))
  source = await account('alice@example.com')
  target = await account('alice@example.com')
  await fillSource()
})
afterEach(async () => {
  await source.app.close()
  await target.app.close()
  await rm(dir, { recursive: true, force: true })
})

describe('POST /api/import', () => {
  it('T-EXP-02: restores the workspace on a fresh installation', async () => {
    const data = await exportFrom(source)
    const response = await importInto(target, data)
    expect(response.statusCode).toBe(201)
    const workspace = response.json().workspace
    expect(workspace.name).toBe('Importiert')

    const before = await snapshot(source)
    const after = await snapshot(target, workspace.id)
    type Entity = { id: string; workspaceId?: string }
    const strip = (items: Entity[]) =>
      items.map(({ workspaceId: _ws, ...rest }) => rest).sort((a, b) => a.id.localeCompare(b.id))
    for (const key of ['documents', 'blocks', 'tags', 'documentTags', 'attachments'] as const) {
      expect(strip(after[key])).toEqual(strip(before[key]))
    }
    // Deleted page stays in the trash.
    expect(after.documents.find((d) => d.id === deletedId)?.deletedAt).not.toBeNull()

    // History is kept for the version view; devices start with a snapshot.
    const versions = await get<{ versions: unknown[] }>(
      target,
      `/api/documents/${docId}/history?workspaceId=${workspace.id}`,
    )
    expect(versions.versions.length).toBeGreaterThan(0)
    const pull = await target.app.inject({
      url: `/api/sync/pull?workspaceId=${workspace.id}&cursor=0`,
      headers: { cookie: target.cookie },
    })
    expect(pull.statusCode).toBe(410)
    expect(after.cursor).toBe(data.history!.changes.length)

    // Search finds imported content.
    const search = await get<{ hits: { documentId: string }[] }>(
      target,
      `/api/search?workspaceId=${workspace.id}&q=zebrafinken`,
    )
    expect(search.hits.map((h) => h.documentId)).toEqual([docId])

    // The attachment content follows through the normal upload.
    const upload = await target.app.inject({
      method: 'PUT',
      url: `/api/attachments/${attachmentId}/content`,
      headers: { cookie: target.cookie, 'content-type': 'application/octet-stream' },
      payload: PNG,
    })
    expect(upload.statusCode).toBe(204)

    // Editing continues with the next revision and seq.
    const edit = { ...op(target, 'block', 'update', blockId, { content: 'neu' }, 1) }
    edit.workspaceId = workspace.id
    const [result] = await push(target, edit)
    expect(result).toMatchObject({ status: 'applied', seq: after.cursor + 1 })
  })

  it('refuses ids that already exist; a copy with new ids works', async () => {
    const data = await exportFrom(source)
    // Same server: the ids exist in the source workspace.
    const again = await importInto(source, data)
    expect(again.statusCode).toBe(409)
    expect(again.json().error.code).toBe('ids_exist')
    // Nothing was created.
    const list = await get<{ workspaces: unknown[] }>(source, '/api/workspaces')
    expect(list.workspaces).toHaveLength(1)

    const copy = remapExportIds(data, randomUUID)
    const response = await importInto(source, copy.data, 'Kopie')
    expect(response.statusCode).toBe(201)
    const imported = await snapshot(source, response.json().workspace.id)
    expect(imported.documents.map((d) => d.id)).not.toContain(docId)
    const block = imported.blocks.find((b) => b.id === copy.idMap.get(blockId))!
    expect(block.content).toContain(`page:${copy.idMap.get(childId)}`)
    // The original is untouched.
    expect((await snapshot(source)).blocks.find((b) => b.id === blockId)?.content).toContain(
      `page:${childId}`,
    )
  })

  it('validates references, schema and limits', async () => {
    const data = await exportFrom(source)
    const orphan = {
      ...data,
      blocks: [...data.blocks, { ...data.blocks[0]!, id: randomUUID(), documentId: randomUUID() }],
    }
    const invalid = await importInto(target, orphan)
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json().error.code).toBe('invalid_import')

    // A page tree with a cycle would make later moves loop forever.
    const [first, second] = data.documents
    const cycle = {
      ...data,
      documents: data.documents.map((d) =>
        d.id === first!.id
          ? { ...d, parentId: second!.id }
          : d.id === second!.id
            ? { ...d, parentId: first!.id }
            : d,
      ),
    }
    const cyclic = await importInto(target, cycle)
    expect(cyclic.statusCode).toBe(400)
    expect(cyclic.json().error.message).toMatch(/Cycle/)
    const self = await importInto(target, {
      ...data,
      documents: data.documents.map((d) => (d.id === first!.id ? { ...d, parentId: d.id } : d)),
    })
    expect(self.statusCode).toBe(400)

    const wrongVersion = await importInto(target, { ...data, schema_version: 2 } as never)
    expect(wrongVersion.statusCode).toBe(400)

    const huge = {
      ...data,
      attachments: data.attachments.map((a) => ({ ...a, size: 1_000_000 })),
    }
    const tooLarge = await importInto(target, huge)
    expect(tooLarge.statusCode).toBe(413)

    const anonymous = await target.app.inject({ method: 'POST', url: '/api/import', payload: {} })
    expect(anonymous.statusCode).toBe(401)
    const list = await get<{ workspaces: unknown[] }>(target, '/api/workspaces')
    expect(list.workspaces).toHaveLength(1)
  })
})
