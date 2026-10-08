import { createHash, randomUUID } from 'node:crypto'
import { type JsonExport, remapExportIds } from '@notion-alt/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import { type Account, Client, expectStatus, op, push, query, signUp } from '../src/client'
import { LIMITS } from '../src/config'
import { exportWorkspace, expectSameContent, snapshot } from '../src/workspace-data'

/**
 * `POST /api/import` (ADR 0004). Ids are unique per server, so the "fresh installation" is a
 * copy with new ids in another account; refusing existing ids is tested with the original.
 * The one-import-at-a-time lock (429 import_running) is not reproducible over HTTP reliably.
 */

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex')

let source: Account
let target: Account
let ids: Record<'doc' | 'child' | 'deleted' | 'block' | 'tag' | 'attachment', string>

beforeEach(async () => {
  source = await signUp({ name: 'source' })
  target = await signUp({ name: 'target' })
  ids = {
    doc: randomUUID(),
    child: randomUUID(),
    deleted: randomUUID(),
    block: randomUUID(),
    tag: randomUUID(),
    attachment: randomUUID(),
  }
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
    doc(ids.doc, 'Projekte'),
    doc(ids.child, 'Alpha', ids.doc),
    doc(ids.deleted, 'Weg'),
    op(source, 'block', 'create', ids.block, {
      documentId: ids.doc,
      type: 'paragraph',
      content: `Siehe [Alpha](page:${ids.child}) zum Thema Zebrafinken`,
      attrs: {},
      sortKey: 'a0',
    }),
    op(source, 'tag', 'create', ids.tag, { name: 'wichtig' }),
    op(source, 'document_tag', 'create', randomUUID(), { documentId: ids.child, tagId: ids.tag }),
    op(source, 'attachment', 'create', ids.attachment, {
      documentId: ids.child,
      name: 'bild.png',
      mimeType: 'image/png',
      size: PNG.length,
      sha256: sha(PNG),
      createdAt: new Date().toISOString(),
    }),
  )
  await push(source, op(source, 'document', 'delete', ids.deleted, {}, 1))
})

const importInto = (account: Account, data: unknown, name = 'Importiert') =>
  account.client.post('/api/import', { name, data })

const workspaceCount = async (account: Account) =>
  (await account.client.get('/api/workspaces')).json().workspaces.length

describe('POST /api/import', () => {
  it('T-EXP-02: restores the workspace with entities, trash, history and search', async () => {
    const data = await exportWorkspace(source.client, source.workspaceId)
    const copy = remapExportIds(data, randomUUID)
    const newId = (id: string) => copy.idMap.get(id)!
    const response = await importInto(target, copy.data)
    expect(response.status).toBe(201)
    const workspace = response.json().workspace
    expect(workspace).toMatchObject({ name: 'Importiert', ownerId: target.user.id })
    expect(workspace.id).not.toBe(source.workspaceId)

    const after = await snapshot(target.client, workspace.id)
    expectSameContent(after, copy.data)
    // Deleted page stays in the trash.
    expect(after.documents.find((d) => d.id === newId(ids.deleted))?.deletedAt).not.toBeNull()

    // History is kept for the version view; devices start with a snapshot.
    const versions = await target.client.get(
      `/api/documents/${newId(ids.doc)}/history?${query({ workspaceId: workspace.id })}`,
    )
    expect(versions.json().versions.length).toBeGreaterThan(0)
    const pull = await target.client.get(
      `/api/sync/pull?${query({ workspaceId: workspace.id, cursor: 0 })}`,
    )
    expect(pull.status).toBe(410)
    expect(pull.json().error.code).toBe('cursor_expired')
    expect(after.cursor).toBe(data.history!.changes.length)

    // Search finds imported content.
    const search = await target.client.get(
      `/api/search?${query({ workspaceId: workspace.id, q: 'zebrafinken' })}`,
    )
    expect(search.json().hits.map((h: { documentId: string }) => h.documentId)).toEqual([
      newId(ids.doc),
    ])

    // The attachment content follows through the normal upload.
    const upload = await target.client.put(`/api/attachments/${newId(ids.attachment)}/content`, {
      body: PNG,
      headers: { 'content-type': 'application/octet-stream' },
    })
    expect(upload.status).toBe(204)

    // Editing continues with the next revision and seq.
    const edit = op(
      { ...target, workspaceId: workspace.id },
      'block',
      'update',
      newId(ids.block),
      { content: 'neu' },
      1,
    )
    const [result] = await push(target, edit)
    expect(result).toMatchObject({ status: 'applied', seq: after.cursor + 1, revision: 2 })
  })

  it('refuses ids that already exist; a copy with new ids works', async () => {
    const data = await exportWorkspace(source.client, source.workspaceId)
    // The ids exist in the source workspace (on this server, for any account).
    for (const account of [source, target]) {
      const again = await importInto(account, data)
      expect(again.status).toBe(409)
      expect(again.json().error.code).toBe('ids_exist')
    }
    // Nothing was created.
    expect(await workspaceCount(source)).toBe(1)

    const copy = remapExportIds(data, randomUUID)
    const response = await importInto(source, copy.data, 'Kopie')
    expect(response.status).toBe(201)
    const imported = await snapshot(source.client, response.json().workspace.id)
    expect(imported.documents.map((d) => d.id)).not.toContain(ids.doc)
    const block = imported.blocks.find((b) => b.id === copy.idMap.get(ids.block))!
    expect(block.content).toContain(`page:${copy.idMap.get(ids.child)}`)
    // The original is untouched.
    const original = await snapshot(source.client, source.workspaceId)
    expect(original.blocks.find((b) => b.id === ids.block)?.content).toContain(`page:${ids.child}`)
  })

  it('validates references, schema and limits', async () => {
    const data: JsonExport = remapExportIds(
      await exportWorkspace(source.client, source.workspaceId),
      randomUUID,
    ).data
    const orphan = {
      ...data,
      blocks: [...data.blocks, { ...data.blocks[0]!, id: randomUUID(), documentId: randomUUID() }],
    }
    const invalid = await importInto(target, orphan)
    expect(invalid.status).toBe(400)
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
    expect(cyclic.status).toBe(400)
    expect(cyclic.json().error.code).toBe('invalid_import')
    const self = await importInto(target, {
      ...data,
      documents: data.documents.map((d) => (d.id === first!.id ? { ...d, parentId: d.id } : d)),
    })
    expect(self.status).toBe(400)

    const wrongVersion = await importInto(target, { ...data, schema_version: 2 })
    expect(wrongVersion.status).toBe(400)
    expect(wrongVersion.json().error.code).toBe('invalid_input')
    expect((await target.client.post('/api/import', { data })).status).toBe(400)

    const huge = {
      ...data,
      attachments: data.attachments.map((a) => ({ ...a, size: LIMITS.workspaceQuotaBytes + 1 })),
    }
    const tooLarge = await importInto(target, huge)
    expect(tooLarge.status).toBe(413)
    expect(tooLarge.json().error.code).toBe('storage_limit')

    const anonymous = await new Client().post('/api/import', {})
    expect(anonymous.status).toBe(401)
    expect(await workspaceCount(target)).toBe(1)
    expectStatus(await importInto(target, data), 201)
  })
})
