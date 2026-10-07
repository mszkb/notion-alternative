import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildExportArchive,
  type Change,
  EXPORT_SCHEMA_VERSION,
  exportMarkdown,
  type JsonExport,
  type Operation,
  type SyncSnapshotResponse,
  verifyExportArchive,
} from '@notion-alt/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, register, type TestApp } from './helpers'

/**
 * T-EXP-02 (#72): a workspace with everything the data model has is exported, imported into a
 * fresh instance and compared. Fixtures of every released `schema_version` must stay
 * importable; create the one for a new version with
 * `UPDATE_EXPORT_FIXTURES=1 pnpm --filter @notion-alt/server test export-roundtrip`
 * (existing fixtures are never overwritten).
 */

const FIXTURES = fileURLToPath(new URL('./fixtures/exports', import.meta.url))

interface Instance {
  app: TestApp
  cookie: string
  workspaceId: string
  deviceId: string
}

let dir: string
const instances: Instance[] = []

async function instance(): Promise<Instance> {
  const { app } = await createTestApp({
    allowRegistration: true,
    attachments: {
      dir: path.join(dir, randomUUID()),
      maxBytes: 1_000_000,
      retentionDays: 30,
      workspaceQuotaBytes: null,
    },
  })
  const { cookie } = await register(app, 'owner@example.com')
  const workspaceId = (await app.inject({ url: '/api/workspaces', headers: { cookie } })).json()
    .workspaces[0].id
  const deviceId = randomUUID()
  await app.inject({
    method: 'POST',
    url: '/api/devices',
    headers: { cookie },
    payload: { id: deviceId, name: 'Laptop' },
  })
  const created = { app, cookie, workspaceId, deviceId }
  instances.push(created)
  return created
}

async function get<T>(i: Instance, url: string): Promise<T> {
  const response = await i.app.inject({ url, headers: { cookie: i.cookie } })
  if (response.statusCode !== 200) throw new Error(`${url}: ${response.statusCode}`)
  return response.json() as T
}

const snapshot = (i: Instance, workspaceId = i.workspaceId) =>
  get<SyncSnapshotResponse>(i, `/api/sync/snapshot?workspaceId=${workspaceId}`)

const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')

const PNG = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  ),
)
const PDF = new TextEncoder().encode('%PDF-1.4 Bericht')

/** Builds the reference workspace through the sync API; returns the attachment contents. */
async function buildRichWorkspace(i: Instance): Promise<Map<string, Uint8Array>> {
  const revisions = new Map<string, number>()
  const push = async (
    entity: Operation['entity'],
    kind: Operation['kind'],
    entityId: string,
    payload: object = {},
  ) => {
    const response = await i.app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: { cookie: i.cookie },
      payload: {
        operations: [
          {
            opId: randomUUID(),
            deviceId: i.deviceId,
            workspaceId: i.workspaceId,
            entity,
            entityId,
            kind,
            baseRevision: revisions.get(entityId) ?? null,
            payload,
            createdAt: new Date().toISOString(),
          },
        ],
      },
    })
    const [result] = response.json().results
    if (result.status !== 'applied') throw new Error(JSON.stringify(result))
    revisions.set(entityId, result.revision)
  }
  const now = new Date().toISOString()
  const page = async (id: string, title: string, parentId: string | null, sortKey = 'a0') =>
    push('document', 'create', id, { parentId, title, sortKey, favorite: false, createdAt: now })
  let n = 0
  const block = async (
    documentId: string,
    type: string,
    content: string,
    attrs: object = {},
    id: string = randomUUID(),
  ) => {
    await push('block', 'create', id, {
      documentId,
      type,
      content,
      attrs,
      sortKey: `a${n++}`,
    })
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
  await push('document', 'update', root, { favorite: true })
  await push('document', 'update', root, { title: 'Projekte 2026' })

  const image = randomUUID()
  const file = randomUUID()
  for (const [id, name, mimeType, data] of [
    [image, 'foto.png', 'image/png', PNG],
    [file, 'bericht.pdf', 'application/pdf', PDF],
  ] as const) {
    await push('attachment', 'create', id, {
      documentId: child,
      name,
      mimeType,
      size: data.length,
      sha256: sha(data),
      createdAt: now,
    })
    const upload = await i.app.inject({
      method: 'PUT',
      url: `/api/attachments/${id}/content`,
      headers: { cookie: i.cookie, 'content-type': 'application/octet-stream' },
      payload: Buffer.from(data),
    })
    if (upload.statusCode !== 204) throw new Error(upload.body)
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
  // ADR 0019 (schema_version 2)
  await block(root, 'todo', 'Erledigt', { checked: true })
  await block(root, 'todo', 'Offen', { indent: 1 })
  await block(root, 'toggle', 'Mehr dazu', {})
  await block(root, 'paragraph', 'Im Toggle', { indent: 1 })
  await block(root, 'callout', 'Hinweis', { icon: '⚠️' })
  await block(root, 'divider', '', {})
  await block(child, 'image', 'Ein Foto', { attachmentId: image })
  await block(child, 'file', 'Bericht', { attachmentId: file })
  const edited = await block(grandchild, 'paragraph', 'Erste Fassung')
  await push('block', 'update', edited, { content: `Zurück zu [Projekte](page:${root})` })
  const removed = await block(grandchild, 'paragraph', 'Wird gelöscht')
  await push('block', 'delete', removed)
  await push('document', 'move', grandchild, { parentId: child, sortKey: 'b0' })
  // #136 (schema_version 3)
  await push('document', 'update', root, { icon: '📁', cover: 'gradient:ocean' })
  await push('document', 'update', child, { cover: `attachment:${image}` })

  const tag = randomUUID()
  const oldTag = randomUUID()
  await push('tag', 'create', tag, { name: 'projekt' })
  await push('tag', 'create', oldTag, { name: 'veraltet' })
  await push('document_tag', 'create', randomUUID(), { documentId: root, tagId: tag })
  await push('document_tag', 'create', randomUUID(), { documentId: grandchild, tagId: tag })
  const removedAssignment = randomUUID()
  await push('document_tag', 'create', removedAssignment, { documentId: second, tagId: oldTag })
  await push('document_tag', 'delete', removedAssignment)
  await push('tag', 'delete', oldTag)
  await push('document', 'delete', deleted)

  return new Map([
    [image, PNG],
    [file, PDF],
  ])
}

async function exportArchive(i: Instance, contents: Map<string, Uint8Array>, exportedAt: Date) {
  const state = await snapshot(i)
  const log = await get<{ changes: Change[]; compactedSeq: number }>(
    i,
    `/api/sync/log?workspaceId=${i.workspaceId}`,
  )
  const { parts } = await buildExportArchive(
    state,
    {
      workspace: { id: i.workspaceId, name: 'Referenz' },
      exportedAt,
      history: { compactedSeq: log.compactedSeq, changes: log.changes },
    },
    contents,
  )
  return new Uint8Array(Buffer.concat(parts))
}

/** Imports a verified archive into an instance like the client does; returns the workspace id. */
async function importArchive(i: Instance, archive: Uint8Array): Promise<string> {
  const { data, attachments } = await verifyExportArchive(archive)
  const response = await i.app.inject({
    method: 'POST',
    url: '/api/import',
    headers: { cookie: i.cookie },
    payload: { name: data.workspace.name, data },
  })
  if (response.statusCode !== 201) throw new Error(response.body)
  for (const [id, content] of attachments) {
    const upload = await i.app.inject({
      method: 'PUT',
      url: `/api/attachments/${id}/content`,
      headers: { cookie: i.cookie, 'content-type': 'application/octet-stream' },
      payload: Buffer.from(content),
    })
    if (upload.statusCode !== 204) throw new Error(upload.body)
  }
  return response.json().workspace.id
}

type Entity = { id: string; workspaceId?: string }
/** Workspace ids differ by design; everything else must survive unchanged. */
const comparable = (items: Entity[]) =>
  items.map(({ workspaceId: _ws, ...rest }) => rest).sort((a, b) => a.id.localeCompare(b.id))

function expectSameContent(actual: SyncSnapshotResponse, expected: Omit<JsonExport, 'history'>) {
  expect(comparable(actual.documents)).toEqual(comparable(expected.documents))
  expect(comparable(actual.blocks)).toEqual(comparable(expected.blocks))
  expect(comparable(actual.tags)).toEqual(comparable(expected.tags))
  expect(comparable(actual.documentTags)).toEqual(comparable(expected.document_tags))
  expect(comparable(actual.attachments)).toEqual(comparable(expected.attachments))
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'roundtrip-'))
})
afterEach(async () => {
  await Promise.all(instances.splice(0).map((i) => i.app.close()))
  await rm(dir, { recursive: true, force: true })
})

describe('T-EXP-02: export → import into a fresh instance', () => {
  it('keeps every entity, link, attachment, tombstone and the history', async () => {
    const source = await instance()
    const contents = await buildRichWorkspace(source)
    const archive = await exportArchive(source, contents, new Date())

    const target = await instance()
    const workspaceId = await importArchive(target, archive)

    const before = await snapshot(source)
    const after = await snapshot(target, workspaceId)
    expectSameContent(after, {
      ...before,
      document_tags: before.documentTags,
    } as unknown as JsonExport)
    // Tombstones are part of it: the trash and removed tags survive.
    expect(after.documents.filter((d) => d.deletedAt)).toHaveLength(1)
    expect(after.blocks.filter((b) => b.deletedAt)).toHaveLength(1)
    expect(after.tags.filter((t) => t.deletedAt)).toHaveLength(1)
    expect(after.documentTags.filter((t) => t.deletedAt)).toHaveLength(1)

    // History: every change with its operation, device, revision, payload and time.
    const log = (i: Instance, ws: string) =>
      get<{ changes: Change[] }>(i, `/api/sync/log?workspaceId=${ws}`).then((r) => r.changes)
    expect(await log(target, workspaceId)).toEqual(await log(source, source.workspaceId))

    // Attachments: identical bytes.
    for (const [id, data] of contents) {
      const response = await target.app.inject({
        url: `/api/attachments/${id}/content`,
        headers: { cookie: target.cookie },
      })
      expect(response.statusCode).toBe(200)
      expect(sha(response.rawPayload)).toBe(sha(data))
    }

    // The Markdown of both is the same (links, tags, attachments resolve identically).
    const markdown = (s: SyncSnapshotResponse) =>
      exportMarkdown(s, { availableAttachments: new Set(contents.keys()) }).files
    expect(markdown(after)).toEqual(markdown(before))
    const files = new Map(markdown(after).map((f) => [f.path, f.content]))
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
    const versions = await get<{ versions: unknown[] }>(
      target,
      `/api/documents/${before.documents.find((d) => d.title === 'Notizen')!.id}/history?workspaceId=${workspaceId}`,
    )
    expect(versions.versions.length).toBeGreaterThan(0)
  })
})

describe('fixtures of released schema versions', () => {
  it('a fixture exists for the current schema version', async () => {
    const name = `v${EXPORT_SCHEMA_VERSION}.zip`
    const file = path.join(FIXTURES, name)
    if (!existsSync(file) && process.env.UPDATE_EXPORT_FIXTURES) {
      const source = await instance()
      const contents = await buildRichWorkspace(source)
      mkdirSync(FIXTURES, { recursive: true })
      writeFileSync(file, await exportArchive(source, contents, new Date('2026-10-03T12:00:00Z')))
    }
    expect(existsSync(file), `${name} missing, see the comment at the top`).toBe(true)
  })

  const fixtures = existsSync(FIXTURES)
    ? readdirSync(FIXTURES).filter((f) => /^v\d+\.zip$/.test(f))
    : []
  it.each(fixtures)('%s imports completely into a fresh instance', async (name) => {
    const archive = new Uint8Array(readFileSync(path.join(FIXTURES, name)))
    const { data, manifest, attachments } = await verifyExportArchive(archive)
    expect(manifest.missing_attachments).toEqual([])

    const target = await instance()
    const workspaceId = await importArchive(target, archive)
    expectSameContent(await snapshot(target, workspaceId), data)
    const log = await get<{ changes: Change[] }>(target, `/api/sync/log?workspaceId=${workspaceId}`)
    expect(log.changes.map(({ seq: _seq, ...c }) => c)).toEqual(
      data.history!.changes.map(({ seq: _seq, ...c }) => c),
    )
    for (const [id, content] of attachments) {
      const response = await target.app.inject({
        url: `/api/attachments/${id}/content`,
        headers: { cookie: target.cookie },
      })
      expect(sha(response.rawPayload)).toBe(sha(content))
    }
    const search = await get<{ hits: unknown[] }>(
      target,
      `/api/search?workspaceId=${workspaceId}&q=Fassung`,
    )
    expect(search.hits).toEqual([])
    const found = await get<{ hits: unknown[] }>(
      target,
      `/api/search?workspaceId=${workspaceId}&q=Zitat`,
    )
    expect(found.hits).toHaveLength(1)
  })
})
