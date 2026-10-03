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

async function attachment(name: string, mimeType: string, data: Buffer) {
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
  expect(result.status).toBe('applied')
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
    attachments: { dir, maxBytes: 1024, retentionDays: 30 },
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

    const big = Buffer.alloc(2048, 1)
    const bigId = await attachment('gross.bin', 'application/octet-stream', big)
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
    expect(await purgeDeletedAttachments(db, dir, 30)).toBe(0)
    expect(existsSync(file)).toBe(true)
    const later = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000)
    expect(await purgeDeletedAttachments(db, dir, 30, later)).toBe(1)
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
