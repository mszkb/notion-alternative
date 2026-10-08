import { createHash, randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { type Account, type Client, docPayload, op, push, query, signUp } from '../src/client'
import { LIMITS } from '../src/config'
import { snapshot } from '../src/workspace-data'

/**
 * Attachments (ADR 0012) with ATTACHMENT_MAX_MB=1 and WORKSPACE_STORAGE_MB=0.003 (3000 bytes per
 * account). Purging deleted files after the retention period needs server time and is tested in
 * PHPUnit (apps/server/tests).
 */

let alice: Account
let documentId: string

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex')
/** A third of the quota. */
const chunk = (fill: number) => Buffer.alloc(Math.floor(LIMITS.workspaceQuotaBytes / 3), fill)

beforeEach(async () => {
  alice = await signUp({ name: 'alice' })
  documentId = randomUUID()
  await push(alice, op(alice, 'document', 'create', documentId, docPayload('Mit Anhang')))
})

async function attachment(name: string, mimeType: string, data: Buffer, expected = 'applied') {
  const id = randomUUID()
  const [result] = await push(
    alice,
    op(alice, 'attachment', 'create', id, {
      documentId,
      name,
      mimeType,
      size: data.length,
      sha256: sha(data),
      createdAt: new Date().toISOString(),
    }),
  )
  expect(result!.status === 'rejected' ? result!.code : result!.status).toBe(expected)
  return id
}

const upload = (id: string, data: Buffer, client: Client = alice.client) =>
  client.put(`/api/attachments/${id}/content`, {
    body: data,
    headers: { 'content-type': 'application/octet-stream' },
  })
const download = (id: string, client: Client = alice.client) =>
  client.get(`/api/attachments/${id}/content`)
const usage = (workspaceId = alice.workspaceId, client: Client = alice.client) =>
  client.get(`/api/attachments/usage?${query({ workspaceId })}`)

describe('attachment content', () => {
  it('uploads verified content once and serves images inline', async () => {
    const id = await attachment('foto.png', 'image/png', PNG)
    const missing = await download(id)
    expect(missing.status).toBe(404)
    expect(missing.json().error.code).toBe('not_uploaded')

    const wrongSize = await upload(id, Buffer.from('falsch'))
    expect(wrongSize.status).toBe(400)
    expect(wrongSize.json().error.code).toBe('size_mismatch')
    const tampered = Buffer.from(PNG)
    tampered[0] = 0
    const wrongHash = await upload(id, tampered)
    expect(wrongHash.status).toBe(400)
    expect(wrongHash.json().error.code).toBe('checksum_mismatch')
    expect((await upload(id, PNG)).status).toBe(204)
    // Uploading again is harmless.
    expect((await upload(id, PNG)).status).toBe(204)

    const response = await download(id)
    expect(response.status).toBe(200)
    expect(response.body.equals(PNG)).toBe(true)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('content-length')).toBe(String(PNG.length))
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'")
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-disposition')).toMatch(/^inline; filename="foto.png"/)
  })

  it('never serves SVG or HTML inline', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    )
    const id = await attachment('böse.svg', 'image/svg+xml', svg)
    expect((await upload(id, svg)).status).toBe(204)
    const response = await download(id)
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="b_se.svg"; filename*=UTF-8''b%C3%B6se.svg`,
    )
  })

  it('requires application/octet-stream for uploads', async () => {
    const id = await attachment('foto.png', 'image/png', PNG)
    const response = await alice.client.put(`/api/attachments/${id}/content`, {
      body: PNG.toString('base64'),
      headers: { 'content-type': 'text/plain' },
    })
    expect(response.status).toBe(415)
  })

  it('is invisible to other accounts and limited in size', async () => {
    const id = await attachment('foto.png', 'image/png', PNG)
    await upload(id, PNG)
    const bob = await signUp({ name: 'bob', device: false })
    expect((await download(id, bob.client)).status).toBe(404)
    expect((await download(id, bob.client)).json().error.code).toBe('not_found')
    expect((await upload(id, PNG, bob.client)).status).toBe(404)
    expect((await download(randomUUID())).status).toBe(404)
    expect((await download('nope')).status).toBe(400)
    expect((await download(id, alice.client.fork())).status).toBe(401)
    expect((await upload(id, PNG, alice.client.fork())).status).toBe(401)

    // Too large is refused already with the metadata, the upload is refused as well.
    const big = Buffer.alloc(LIMITS.attachmentMaxBytes + 1, 1)
    const bigId = await attachment('gross.bin', 'application/octet-stream', big, 'too_large')
    expect((await upload(bigId, big)).status).toBe(413)
  })

  it('keeps a deleted attachment readable, but refuses new content', async () => {
    const id = await attachment('foto.png', 'image/png', PNG)
    await upload(id, PNG)
    const [deleted] = await push(alice, op(alice, 'attachment', 'delete', id, {}, 1))
    expect(deleted!.status).toBe('applied')
    const refused = await upload(id, PNG)
    expect(refused.status).toBe(410)
    expect(refused.json().error.code).toBe('deleted')
    expect((await download(id)).status).toBe(200)
  })

  it('appears in the snapshot; attachments for deleted pages are conflicts', async () => {
    const id = await attachment('foto.png', 'image/png', PNG)
    const state = await snapshot(alice.client, alice.workspaceId)
    expect(state.attachments).toMatchObject([
      {
        id,
        documentId,
        name: 'foto.png',
        mimeType: 'image/png',
        size: PNG.length,
        sha256: sha(PNG),
        revision: 1,
        deletedAt: null,
      },
    ])
    await push(alice, op(alice, 'document', 'delete', documentId, {}, 1))
    const [late] = await push(
      alice,
      op(alice, 'attachment', 'create', randomUUID(), {
        documentId,
        name: 'spät.png',
        mimeType: 'image/png',
        size: PNG.length,
        sha256: sha(PNG),
        createdAt: new Date().toISOString(),
      }),
    )
    expect(late!.status).not.toBe('applied')
  })
})

describe('storage limits (#64)', () => {
  it('refuses attachments beyond the quota until space is freed', async () => {
    const part = chunk(2)
    const first = await attachment('a.bin', 'application/octet-stream', part)
    await attachment('b.bin', 'application/octet-stream', part)
    await attachment('c.bin', 'application/octet-stream', part)
    await attachment('d.bin', 'application/octet-stream', part, 'quota_exceeded')

    const response = await usage()
    expect(response.status).toBe(200)
    expect(response.json()).toEqual({
      usedBytes: part.length * 3,
      count: 3,
      quotaBytes: LIMITS.workspaceQuotaBytes,
      maxFileBytes: LIMITS.attachmentMaxBytes,
    })

    // Never uploaded: deleting it frees the space right away.
    await push(alice, op(alice, 'attachment', 'delete', first, {}, 1))
    await attachment('e.bin', 'application/octet-stream', part)
  })

  it('counts deleted uploaded files and all workspaces of the account', async () => {
    const part = chunk(3)
    const stored = await attachment('a.bin', 'application/octet-stream', part)
    expect((await upload(stored, part)).status).toBe(204)
    await attachment('b.bin', 'application/octet-stream', part)
    // Deleting an uploaded file frees nothing while the file is kept for restores.
    await push(alice, op(alice, 'attachment', 'delete', stored, {}, 1))
    await attachment('c.bin', 'application/octet-stream', part)
    await attachment('d.bin', 'application/octet-stream', part, 'quota_exceeded')

    // A second workspace shares the account's quota.
    const other = (await alice.client.post('/api/workspaces', { name: 'Zweiter' })).json().workspace
      .id as string
    const page = randomUUID()
    const target = { ...alice, workspaceId: other }
    const [created, refused] = await push(
      alice,
      op(target, 'document', 'create', page, docPayload('x')),
      op(target, 'attachment', 'create', randomUUID(), {
        documentId: page,
        name: 'f.bin',
        mimeType: 'application/octet-stream',
        size: part.length,
        sha256: sha(part),
        createdAt: new Date().toISOString(),
      }),
    )
    expect(created!.status).toBe('applied')
    expect(refused!.code).toBe('quota_exceeded')
  })

  it('reports usage only for own workspaces', async () => {
    const bob = await signUp({ name: 'bob', device: false })
    const foreign = await usage(alice.workspaceId, bob.client)
    expect(foreign.status).toBe(404)
    expect(foreign.json().error.code).toBe('not_found')
    expect((await usage('nope')).status).toBe(400)
    expect((await usage(alice.workspaceId, alice.client.fork())).status).toBe(401)
  })
})
