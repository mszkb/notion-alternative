import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Operation } from '@notion-alt/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../src/db/database'
import { contentPath, purgeDeletedAttachments } from '../src/attachments/storage'
import { createTestApp, register, type TestApp } from './helpers'

let app: TestApp
let db: Db
let dir: string
let cookie: string
let workspaceId: string
let deviceId: string
let documentId: string

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex')

function op(
  entity: Operation['entity'],
  kind: Operation['kind'],
  entityId: string,
  payload: object,
  base: number | null = null,
): Operation {
  return {
    opId: randomUUID(),
    deviceId,
    workspaceId,
    entity,
    entityId,
    kind,
    baseRevision: base,
    payload: payload as Record<string, unknown>,
    createdAt: new Date().toISOString(),
  }
}

async function push(...operations: Operation[]) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/sync/push',
    headers: { cookie },
    payload: { operations },
  })
  return response.json().results
}

async function attachment(name: string, mimeType: string, data: Buffer, expected = 'applied') {
  const id = randomUUID()
  const [result] = await push(
    op('attachment', 'create', id, {
      documentId,
      name,
      mimeType,
      size: data.length,
      sha256: sha(data),
      createdAt: new Date().toISOString(),
    }),
  )
  expect(result.status === 'rejected' ? result.code : result.status).toBe(expected)
  return id
}

const upload = (id: string, data: Buffer, c = cookie) =>
  app.inject({
    method: 'PUT',
    url: `/api/attachments/${id}/content`,
    headers: { cookie: c, 'content-type': 'application/octet-stream' },
    payload: data,
  })
const download = (id: string, c = cookie) =>
  app.inject({ url: `/api/attachments/${id}/content`, headers: { cookie: c } })

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'attachments-'))
  ;({ app, db } = await createTestApp({
    allowRegistration: true,
    attachments: { dir, maxBytes: 1024, retentionDays: 30, workspaceQuotaBytes: 3000 },
  }))
  ;({ cookie } = await register(app, 'alice@example.com'))
  workspaceId = (await app.inject({ url: '/api/workspaces', headers: { cookie } })).json()
    .workspaces[0].id
  deviceId = randomUUID()
  await app.inject({
    method: 'POST',
    url: '/api/devices',
    headers: { cookie },
    payload: { id: deviceId, name: 'Test' },
  })
  documentId = randomUUID()
  await push(
    op('document', 'create', documentId, {
      parentId: null,
      title: 'Mit Anhang',
      sortKey: 'a0',
      favorite: false,
      createdAt: 'x',
    }),
  )
})
afterEach(async () => {
  await app.close()
  await rm(dir, { recursive: true, force: true })
})

describe('attachments', () => {
  it('uploads verified content once and serves images inline', async () => {
    const id = await attachment('foto.png', 'image/png', PNG)
    expect((await download(id)).json().error.code).toBe('not_uploaded')

    expect((await upload(id, Buffer.from('falsch'))).json().error.code).toBe('size_mismatch')
    const tampered = Buffer.from(PNG)
    tampered[0] = 0
    expect((await upload(id, tampered)).json().error.code).toBe('checksum_mismatch')
    expect((await upload(id, PNG)).statusCode).toBe(204)
    expect((await upload(id, PNG)).statusCode).toBe(204)

    const response = await download(id)
    expect(response.statusCode).toBe(200)
    expect(response.rawPayload.equals(PNG)).toBe(true)
    expect(response.headers).toMatchObject({
      'content-type': 'image/png',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "sandbox; default-src 'none'",
    })
    expect(response.headers['content-disposition']).toMatch(/^inline; filename="foto.png"/)
  })

  it('never serves SVG or HTML inline', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    )
    const id = await attachment('böse.svg', 'image/svg+xml', svg)
    await upload(id, svg)
    const response = await download(id)
    expect(response.headers['content-type']).toBe('application/octet-stream')
    expect(response.headers['content-disposition']).toMatch(
      /^attachment; filename="b_se.svg"; filename\*=UTF-8''b%C3%B6se.svg$/,
    )
  })

  it('is invisible to other accounts and limited in size', async () => {
    const id = await attachment('foto.png', 'image/png', PNG)
    await upload(id, PNG)
    const { cookie: bob } = await register(app, 'bob@example.com')
    expect((await download(id, bob)).statusCode).toBe(404)
    expect((await upload(id, PNG, bob)).statusCode).toBe(404)

    // Too large is refused already with the metadata, the upload is refused as well.
    const big = Buffer.alloc(2048, 1)
    const bigId = await attachment('gross.bin', 'application/octet-stream', big, 'too_large')
    expect((await upload(bigId, big)).statusCode).toBe(413)
  })

  it('keeps a deleted attachment for the retention period, then removes the file', async () => {
    const id = await attachment('foto.png', 'image/png', PNG)
    await upload(id, PNG)
    const [deleted] = await push(op('attachment', 'delete', id, {}, 1))
    expect(deleted.status).toBe('applied')
    expect((await upload(id, PNG)).json().error.code).toBe('deleted')
    expect((await download(id)).statusCode).toBe(200)

    const file = contentPath(dir, workspaceId, id)
    expect(await purgeDeletedAttachments(db, app.contentStore, 30)).toBe(0)
    expect(existsSync(file)).toBe(true)
    const later = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000)
    expect(await purgeDeletedAttachments(db, app.contentStore, 30, later)).toBe(1)
    expect(existsSync(file)).toBe(false)
    expect((await download(id)).json().error.code).toBe('not_uploaded')
  })

  it('appears in the snapshot and rejects attachments for deleted pages', async () => {
    const id = await attachment('foto.png', 'image/png', PNG)
    const snapshot = (
      await app.inject({
        url: `/api/sync/snapshot?workspaceId=${workspaceId}`,
        headers: { cookie },
      })
    ).json()
    expect(snapshot.attachments).toMatchObject([{ id, name: 'foto.png', size: PNG.length }])
    expect(() => contentPath(dir, '../etc', id)).toThrow()
  })
})

describe('storage limits (#64)', () => {
  it('refuses attachments beyond the workspace quota until space is freed', async () => {
    const kb = Buffer.alloc(1000, 2)
    const first = await attachment('a.bin', 'application/octet-stream', kb)
    await attachment('b.bin', 'application/octet-stream', kb)
    await attachment('c.bin', 'application/octet-stream', kb)
    await attachment('d.bin', 'application/octet-stream', kb, 'quota_exceeded')

    const usage = await app.inject({
      url: `/api/attachments/usage?workspaceId=${workspaceId}`,
      headers: { cookie },
    })
    expect(usage.json()).toEqual({
      usedBytes: 3000,
      count: 3,
      quotaBytes: 3000,
      maxFileBytes: 1024,
    })

    await push(op('attachment', 'delete', first, {}, 1))
    await attachment('e.bin', 'application/octet-stream', kb)
  })

  it('counts deleted files until they are purged and all workspaces of the account', async () => {
    const kb = Buffer.alloc(1000, 3)
    const stored = await attachment('a.bin', 'application/octet-stream', kb)
    expect((await upload(stored, kb)).statusCode).toBe(204)
    await attachment('b.bin', 'application/octet-stream', kb)
    // Deleting an uploaded file frees nothing while the file is kept for restores.
    await push(op('attachment', 'delete', stored, {}, 1))
    await attachment('c.bin', 'application/octet-stream', kb)
    await attachment('d.bin', 'application/octet-stream', kb, 'quota_exceeded')
    await purgeDeletedAttachments(db, app.contentStore, 0, new Date(Date.now() + 1000))
    await attachment('e.bin', 'application/octet-stream', kb)

    // A second workspace shares the account's quota.
    const other = (
      await app.inject({
        method: 'POST',
        url: '/api/workspaces',
        headers: { cookie },
        payload: { name: 'Zweiter' },
      })
    ).json().workspace.id
    const page = randomUUID()
    const inOther = (o: Operation) => ({ ...o, workspaceId: other })
    const [created, refused] = await push(
      inOther(
        op('document', 'create', page, {
          parentId: null,
          title: 'x',
          sortKey: 'a0',
          favorite: false,
          createdAt: 'x',
        }),
      ),
      inOther(
        op('attachment', 'create', randomUUID(), {
          documentId: page,
          name: 'f.bin',
          mimeType: 'application/octet-stream',
          size: kb.length,
          sha256: sha(kb),
          createdAt: 'x',
        }),
      ),
    )
    expect(created.status).toBe('applied')
    expect(refused.code).toBe('quota_exceeded')
  })

  it('reports usage only for own workspaces', async () => {
    const { cookie: bob } = await register(app, 'bob@example.com')
    const response = await app.inject({
      url: `/api/attachments/usage?workspaceId=${workspaceId}`,
      headers: { cookie: bob },
    })
    expect(response.statusCode).toBe(404)
  })
})
