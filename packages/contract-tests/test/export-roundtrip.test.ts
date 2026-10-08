import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  buildExportArchive,
  type Change,
  EXPORT_SCHEMA_VERSION,
  exportMarkdown,
  type JsonExport,
  type Operation,
  remapExportIds,
  type SyncSnapshotResponse,
  verifyExportArchive,
} from '@notion-alt/shared'
import { describe, expect, it } from 'vitest'
import { type Account, expectStatus, push, query, signUp } from '../src/client'
import { EXPORT_FIXTURES } from '../src/config'
import { changeLog, expectSameContent, snapshot } from '../src/workspace-data'

/**
 * T-EXP-02 (#72): a workspace with everything the data model has is exported as ZIP, imported
 * and compared; the fixtures of every released `schema_version` (fixtures/exports) must import
 * completely. A new schema version gets its fixture with
 * `UPDATE_EXPORT_FIXTURES=1 pnpm --filter @notion-alt/contract-tests exec vitest run export-roundtrip`
 * (existing files are never overwritten). Ids are unique per server, so imports use a copy with new
 * ids (`remapExportIds`, as the app does for "import as copy") in a second account.
 */

const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')

const PNG = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  ),
)
const PDF = new TextEncoder().encode('%PDF-1.4 Bericht')

/** Builds the reference workspace through the sync API; returns the attachment contents. */
async function buildRichWorkspace(a: Account): Promise<Map<string, Uint8Array>> {
  const revisions = new Map<string, number>()
  const apply = async (
    entity: Operation['entity'],
    kind: Operation['kind'],
    entityId: string,
    payload: object = {},
  ) => {
    const [result] = await push(a, {
      opId: randomUUID(),
      deviceId: a.deviceId,
      workspaceId: a.workspaceId,
      entity,
      entityId,
      kind,
      baseRevision: revisions.get(entityId) ?? null,
      payload: payload as Record<string, unknown>,
      createdAt: new Date().toISOString(),
    })
    if (result!.status !== 'applied') throw new Error(JSON.stringify(result))
    revisions.set(entityId, result!.revision)
  }
  const now = new Date().toISOString()
  const page = async (id: string, title: string, parentId: string | null, sortKey = 'a0') =>
    apply('document', 'create', id, { parentId, title, sortKey, favorite: false, createdAt: now })
  let n = 0
  const block = async (
    documentId: string,
    type: string,
    content: string,
    attrs: object = {},
    id: string = randomUUID(),
  ) => {
    await apply('block', 'create', id, { documentId, type, content, attrs, sortKey: `a${n++}` })
    return id
  }

  const root = randomUUID()
  const child = randomUUID()
  const grandchild = randomUUID()
  const second = randomUUID()
  const deleted = randomUUID()
  await page(root, 'Projekte', null, 'a0')
  await page(child, 'Alpha: Plan/Ideen', root)
  await page(grandchild, 'Notizen', child)
  await page(second, 'Projekte', null, 'a1') // same title as a sibling
  await page(deleted, 'Alt', null, 'a2')
  await apply('document', 'update', root, { favorite: true })
  await apply('document', 'update', root, { title: 'Projekte 2026' })

  const image = randomUUID()
  const file = randomUUID()
  for (const [id, name, mimeType, data] of [
    [image, 'foto.png', 'image/png', PNG],
    [file, 'bericht.pdf', 'application/pdf', PDF],
  ] as const) {
    await apply('attachment', 'create', id, {
      documentId: child,
      name,
      mimeType,
      size: data.length,
      sha256: sha(data),
      createdAt: now,
    })
    const upload = await a.client.put(`/api/attachments/${id}/content`, {
      body: data,
      headers: { 'content-type': 'application/octet-stream' },
    })
    expectStatus(upload, 204)
  }

  await block(root, 'heading', 'Überblick', { level: 1 })
  await block(root, 'heading', 'Details', { level: 2 })
  await block(root, 'heading', 'Klein', { level: 3 })
  await block(
    root,
    'paragraph',
    `**fett**, _kursiv_, \`code\`, [Web](https://example.com) und [Notizen](page:${grandchild})`,
  )
  await block(root, 'list_item', 'Punkt', { list: 'bullet', indent: 0 })
  await block(root, 'list_item', 'Unterpunkt', { list: 'ordered', indent: 1 })
  await block(root, 'quote', 'Zitat\nzweite Zeile')
  await block(root, 'code', 'const x = `a` // [kein](page:link)', { language: 'ts' })
  await block(child, 'image', 'Ein Foto', { attachmentId: image })
  await block(child, 'file', 'Bericht', { attachmentId: file })
  const edited = await block(grandchild, 'paragraph', 'Erste Fassung')
  await apply('block', 'update', edited, { content: `Zurück zu [Projekte](page:${root})` })
  const removed = await block(grandchild, 'paragraph', 'Wird gelöscht')
  await apply('block', 'delete', removed)
  await apply('document', 'move', grandchild, { parentId: child, sortKey: 'b0' })

  const tag = randomUUID()
  const oldTag = randomUUID()
  await apply('tag', 'create', tag, { name: 'projekt' })
  await apply('tag', 'create', oldTag, { name: 'veraltet' })
  await apply('document_tag', 'create', randomUUID(), { documentId: root, tagId: tag })
  await apply('document_tag', 'create', randomUUID(), { documentId: grandchild, tagId: tag })
  const removedAssignment = randomUUID()
  await apply('document_tag', 'create', removedAssignment, { documentId: second, tagId: oldTag })
  await apply('document_tag', 'delete', removedAssignment)
  await apply('tag', 'delete', oldTag)
  await apply('document', 'delete', deleted)

  return new Map([
    [image, PNG],
    [file, PDF],
  ])
}

async function exportArchive(
  a: Account,
  contents: Map<string, Uint8Array>,
  exportedAt = new Date(),
) {
  const state = await snapshot(a.client, a.workspaceId)
  const log = await changeLog(a.client, a.workspaceId)
  const { parts } = await buildExportArchive(
    state,
    {
      workspace: { id: a.workspaceId, name: 'Referenz' },
      exportedAt,
      history: { compactedSeq: log.compactedSeq, changes: log.changes },
    },
    contents,
  )
  return new Uint8Array(Buffer.concat(parts))
}

/**
 * Imports a verified archive as a copy with new ids, like the client does; returns the new
 * workspace, the imported data and the attachment contents under their new ids.
 */
async function importArchive(a: Account, archive: Uint8Array) {
  const { data: original, attachments } = await verifyExportArchive(archive)
  const { data, idMap } = remapExportIds(original, randomUUID)
  const response = expectStatus(
    await a.client.post('/api/import', { name: data.workspace.name, data }),
    201,
  )
  const contents = new Map<string, Uint8Array>()
  for (const [id, content] of attachments) {
    const newId = idMap.get(id.toLowerCase())!
    contents.set(newId, content)
    const upload = await a.client.put(`/api/attachments/${newId}/content`, {
      body: content,
      headers: { 'content-type': 'application/octet-stream' },
    })
    expectStatus(upload, 204)
  }
  return { workspaceId: response.json().workspace.id as string, data, contents }
}

async function expectContents(a: Account, contents: Map<string, Uint8Array>) {
  for (const [id, content] of contents) {
    const response = await a.client.get(`/api/attachments/${id}/content`)
    expect(response.status).toBe(200)
    expect(sha(response.body)).toBe(sha(content))
  }
}

const withoutSeq = (changes: Change[]) => changes.map(({ seq: _seq, ...c }) => c)

describe('T-EXP-02: export → import', () => {
  it('keeps every entity, link, attachment, tombstone and the history', async () => {
    const source = await signUp({ name: 'source' })
    const archive = await exportArchive(source, await buildRichWorkspace(source))

    const target = await signUp({ name: 'target' })
    const { workspaceId, data, contents } = await importArchive(target, archive)

    const after = await snapshot(target.client, workspaceId)
    expectSameContent(after, data)
    // Tombstones are part of it: the trash and removed tags survive.
    expect(after.documents.filter((d) => d.deletedAt)).toHaveLength(1)
    expect(after.blocks.filter((b) => b.deletedAt)).toHaveLength(1)
    expect(after.tags.filter((t) => t.deletedAt)).toHaveLength(1)
    expect(after.documentTags.filter((t) => t.deletedAt)).toHaveLength(1)

    // History: every change with its operation, device, revision, payload, time and seq.
    const log = await changeLog(target.client, workspaceId)
    expect(log.changes).toEqual(data.history!.changes)
    expect(log.compactedSeq).toBe(data.history!.changes.length)

    await expectContents(target, contents)

    // The Markdown of both is the same (links, tags, attachments resolve identically); only
    // the page ids in the front matter differ in the copy.
    const before = await snapshot(source.client, source.workspaceId)
    const markdown = (s: SyncSnapshotResponse) =>
      exportMarkdown(s, {
        availableAttachments: new Set(s.attachments.map((x) => x.id)),
      }).files.map((f) => ({ ...f, content: f.content.replace(/^id: .*$/m, 'id: -') }))
    const files = new Map(markdown(after).map((f) => [f.path, f.content]))
    expect(markdown(after)).toEqual(markdown(before))
    expect([...files.keys()].sort()).toEqual([
      'Projekte 2026.md',
      'Projekte 2026/Alpha- Plan-Ideen.md',
      'Projekte 2026/Alpha- Plan-Ideen/Notizen.md',
      'Projekte.md',
    ])
    expect(files.get('Projekte 2026.md')).toContain(
      '[Notizen](Projekte%202026/Alpha-%20Plan-Ideen/Notizen.md)',
    )

    // Work continues on the imported workspace.
    const notes = after.documents.find((d) => d.title === 'Notizen')!.id
    const versions = await target.client.get(
      `/api/documents/${notes}/history?${query({ workspaceId })}`,
    )
    expect(versions.json().versions.length).toBeGreaterThan(0)
  })
})

describe('fixtures of released schema versions', () => {
  it('a fixture exists for the current schema version', async () => {
    const file = path.join(EXPORT_FIXTURES, `v${EXPORT_SCHEMA_VERSION}.zip`)
    if (!existsSync(file) && process.env.UPDATE_EXPORT_FIXTURES) {
      const source = await signUp({ name: 'fixture-source' })
      const contents = await buildRichWorkspace(source)
      mkdirSync(EXPORT_FIXTURES, { recursive: true })
      writeFileSync(file, await exportArchive(source, contents, new Date('2026-10-03T12:00:00Z')))
    }
    expect(existsSync(file)).toBe(true)
  })

  const fixtures = existsSync(EXPORT_FIXTURES)
    ? readdirSync(EXPORT_FIXTURES).filter((f) => /^v\d+\.zip$/.test(f))
    : []
  it.each(fixtures)('%s imports completely', async (name) => {
    const archive = new Uint8Array(readFileSync(path.join(EXPORT_FIXTURES, name)))
    const { manifest } = await verifyExportArchive(archive)
    expect(manifest.missing_attachments).toEqual([])

    const target = await signUp({ name: 'fixture' })
    const { workspaceId, data, contents } = await importArchive(target, archive)
    expectSameContent(await snapshot(target.client, workspaceId), data as JsonExport)
    const log = await changeLog(target.client, workspaceId)
    expect(withoutSeq(log.changes)).toEqual(withoutSeq(data.history!.changes))
    await expectContents(target, contents)

    const search = (q: string) =>
      target.client.get(`/api/search?${query({ workspaceId, q })}`).then((r) => r.json().hits)
    expect(await search('Fassung')).toEqual([])
    expect(await search('Zitat')).toHaveLength(1)
  })
})
