import { createECDH, createHash, randomBytes, randomUUID } from 'node:crypto'
import { createJsonExport } from '@notion-alt/shared'
import { describe, expect, it } from 'vitest'
import { Account, Client, errorCode } from './client'

const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')

describe('search', () => {
  it('finds words by prefix within the own workspace only', async () => {
    const a = await Account.create()
    const { id } = await a.page('Reiseplanung', ['Zugtickets nach Wien'])
    const hits = (await a.get(`/search?workspaceId=${a.workspaceId}&q=wie`)).body.hits
    expect(hits).toEqual([expect.objectContaining({ documentId: id, title: 'Reiseplanung' })])
    expect(hits[0].snippet).toContain('Wien')
    const b = await Account.create()
    expect((await b.get(`/search?workspaceId=${a.workspaceId}&q=wien`)).status).toBe(404)
    expect((await a.get(`/search?workspaceId=${a.workspaceId}`)).status).toBe(400)
  })
})

describe('history', () => {
  it('lists versions of a page and returns the state at one of them', async () => {
    const a = await Account.create()
    const { id, blockIds } = await a.page('Seite', ['erste Fassung'])
    await a.push(a.op('block', 'update', blockIds[0]!, { content: 'zweite Fassung' }, 1))
    const versions = (await a.get(`/documents/${id}/history?workspaceId=${a.workspaceId}`)).body
      .versions
    expect(versions.length).toBeGreaterThanOrEqual(1)
    const state = (
      await a.get(`/documents/${id}/history/${versions[0].seq}?workspaceId=${a.workspaceId}`)
    ).body
    expect(state.document.id).toBe(id)
    expect(state.blocks.map((b: { content: string }) => b.content)).toEqual(['zweite Fassung'])
    expect(
      (await a.get(`/documents/${randomUUID()}/history?workspaceId=${a.workspaceId}`)).status,
    ).toBe(404)
  })
})

describe('import', () => {
  it('creates a workspace from an export, refuses existing ids and invalid data', async () => {
    const a = await Account.create()
    const workspace = { id: randomUUID(), name: 'Quelle' }
    const doc = {
      id: randomUUID(),
      workspaceId: workspace.id,
      parentId: null,
      title: 'Importiert',
      sortKey: 'a0',
      favorite: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      revision: 1,
      deletedAt: null,
    }
    const data = createJsonExport(
      { documents: [doc], blocks: [], tags: [], documentTags: [], attachments: [] },
      { workspace, exportedAt: new Date().toISOString(), history: null },
    )
    const created = await a.post('/import', { name: 'Neu', data })
    expect(created.status).toBe(201)
    const id = created.body.workspace.id
    const snapshot = (await a.get(`/sync/snapshot?workspaceId=${id}`)).body
    expect(snapshot.documents.map((d: { title: string }) => d.title)).toEqual(['Importiert'])

    const again = await a.post('/import', { name: 'Nochmal', data })
    expect([again.status, errorCode(again)]).toEqual([409, 'ids_exist'])
    const invalid = await a.post('/import', {
      name: 'Kaputt',
      data: { ...data, schema_version: 99 },
    })
    expect(invalid.status).toBe(400)
  })
})

describe('attachments', () => {
  it('uploads and downloads content checked against size and SHA-256', async () => {
    const a = await Account.create()
    const { id: doc } = await a.page()
    const data = new Uint8Array(randomBytes(300))
    const attachment = randomUUID()
    const [created] = await a.push(
      a.op('attachment', 'create', attachment, {
        documentId: doc,
        name: 'daten.bin',
        mimeType: 'application/octet-stream',
        size: data.length,
        sha256: sha(data),
        createdAt: new Date().toISOString(),
      }),
    )
    expect(created.status).toBe('applied')
    const octet = { 'content-type': 'application/octet-stream' }
    expect((await a.get(`/attachments/${attachment}/content`)).status).toBe(404)
    const wrongSize = await a.request(
      'PUT',
      `/attachments/${attachment}/content`,
      data.slice(1),
      octet,
    )
    expect([wrongSize.status, errorCode(wrongSize)]).toEqual([400, 'size_mismatch'])
    const wrongType = await a.request('PUT', `/attachments/${attachment}/content`, data, {
      'content-type': 'text/plain',
    })
    // Only raw bytes are accepted; other types never reach the storage.
    expect([400, 415]).toContain(wrongType.status)
    expect((await a.request('PUT', `/attachments/${attachment}/content`, data, octet)).status).toBe(
      204,
    )
    const download = await a.get(`/attachments/${attachment}/content`)
    expect(download.status).toBe(200)
    expect(sha(download.raw)).toBe(sha(data))
    const usage = (await a.get(`/attachments/usage?workspaceId=${a.workspaceId}`)).body
    expect(usage.usedBytes).toBe(data.length)
  })

  it('rejects attachments above the size limit', async () => {
    const a = await Account.create()
    const { id: doc } = await a.page()
    const [tooLarge] = await a.push(
      a.op('attachment', 'create', randomUUID(), {
        documentId: doc,
        name: 'gross.bin',
        mimeType: 'application/octet-stream',
        size: 5 * 1024 * 1024,
        sha256: '0'.repeat(64),
        createdAt: new Date().toISOString(),
      }),
    )
    expect(tooLarge).toMatchObject({ status: 'rejected', code: 'too_large' })
  })
})

describe('web push', () => {
  const keys = () => ({
    p256dh: createECDH('prime256v1').generateKeys().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  })

  it('stores and removes subscriptions for allowed push services only', async () => {
    const a = await Account.create()
    const publicKey = (await a.get('/push/public-key')).body.publicKey
    expect(publicKey).toMatch(/^B[A-Za-z0-9_-]{86}$/)
    const endpoint = `https://push.example.com/${randomUUID()}`
    const created = await a.post('/push/subscriptions', { endpoint, keys: keys() })
    expect([200, 201, 204]).toContain(created.status)
    const removed = await a.request('DELETE', '/push/subscriptions', { endpoint })
    expect([200, 204]).toContain(removed.status)

    const foreign = await a.post('/push/subscriptions', {
      endpoint: 'https://evil.example.org/x',
      keys: keys(),
    })
    expect([foreign.status, errorCode(foreign)]).toEqual([400, 'endpoint_not_allowed'])
    const badKeys = await a.post('/push/subscriptions', {
      endpoint,
      keys: { p256dh: 'x', auth: 'y' },
    })
    expect(badKeys.status).toBe(400)
  })

  it('needs a session', async () => {
    expect((await new Client().get('/push/public-key')).status).toBe(401)
  })
})

describe('metrics', () => {
  it('is off unless enabled', async () => {
    expect([401, 404]).toContain((await new Client().get('/metrics')).status)
  })
})
