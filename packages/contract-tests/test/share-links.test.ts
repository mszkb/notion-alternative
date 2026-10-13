import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  type Account,
  Client,
  blockPayload,
  docPayload,
  expectStatus,
  op,
  push,
  query,
  signUp,
} from '../src/client'
import { LIMITS } from '../src/config'

/**
 * Read links for people without an account (ADR 0022): one page each, revocable, with an
 * optional expiry. Guests see only that page, never other pages, ids of the workspace or
 * e-mail addresses (T-SHARE-06 to T-SHARE-08).
 */

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex')

let owner: Account
let documentId: string
let otherId: string

const links = (account: { client: Client }, workspaceId: string, documentId?: string) =>
  account.client.get(`/api/workspaces/${workspaceId}/share-links?${query({ documentId })}`)
const createLink = (
  account: { client: Client },
  workspaceId: string,
  documentId: string,
  expiresAt: string | null = null,
) => account.client.post(`/api/workspaces/${workspaceId}/share-links`, { documentId, expiresAt })
const revoke = (account: { client: Client }, workspaceId: string, linkId: string) =>
  account.client.delete(`/api/workspaces/${workspaceId}/share-links/${linkId}`)
/** A guest: no session, its own client address. */
const guest = () => new Client()
const show = (token: string, client = guest()) => client.get(`/api/public/shares/${token}`)

async function share(account: Account, id = documentId, expiresAt: string | null = null) {
  const created = expectStatus(await createLink(account, account.workspaceId, id, expiresAt), 201)
  return created.json() as { link: { id: string }; token: string }
}

async function addMember(role: string): Promise<Account> {
  const member = await signUp({ name: role })
  expectStatus(
    await owner.client.post(`/api/workspaces/${owner.workspaceId}/members`, {
      email: member.email,
      role,
    }),
    201,
  )
  return member
}

async function attachment(name: string, mimeType: string, data = PNG): Promise<string> {
  const id = randomUUID()
  const [result] = await push(
    owner,
    op(owner, 'attachment', 'create', id, {
      documentId,
      name,
      mimeType,
      size: data.length,
      sha256: sha(data),
      createdAt: new Date().toISOString(),
    }),
  )
  expect(result!.status).toBe('applied')
  expectStatus(
    await owner.client.put(`/api/attachments/${id}/content`, {
      body: data,
      headers: { 'content-type': 'application/octet-stream' },
    }),
    204,
  )
  return id
}

beforeEach(async () => {
  owner = await signUp({ name: 'owner' })
  documentId = randomUUID()
  otherId = randomUUID()
  const results = await push(
    owner,
    op(owner, 'document', 'create', documentId, docPayload('Reiseplan')),
    op(
      owner,
      'block',
      'create',
      randomUUID(),
      blockPayload(documentId, 'Zweiter Tag', 'paragraph', 'a1'),
    ),
    op(
      owner,
      'block',
      'create',
      randomUUID(),
      blockPayload(documentId, 'Erster Tag', 'heading', 'a0', { level: 2 }),
    ),
    op(owner, 'document', 'create', otherId, docPayload('Geheime Notizen', null, 'a1')),
    op(owner, 'block', 'create', randomUUID(), blockPayload(otherId, 'Kontonummer')),
  )
  expect(results.every((r) => r.status === 'applied')).toBe(true)
})

describe('managing read links (GET/POST/DELETE /api/workspaces/:id/share-links)', () => {
  it('creates a link; the token comes only once and the list never shows it', async () => {
    const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString()
    const created = expectStatus(
      await createLink(owner, owner.workspaceId, documentId, expiresAt),
      201,
    ).json()
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(created.link).toEqual({
      id: expect.any(String),
      documentId,
      createdBy: owner.user.id,
      createdAt: expect.any(String),
      expiresAt,
      expired: false,
    })

    const listed = expectStatus(await links(owner, owner.workspaceId), 200)
    expect(listed.json()).toEqual({ links: [created.link] })
    expect(listed.text()).not.toContain(created.token)
    expect(expectStatus(await links(owner, owner.workspaceId, otherId), 200).json().links).toEqual(
      [],
    )
  })

  it('refuses unknown or deleted pages, pages of other workspaces and past expiry dates', async () => {
    expect((await createLink(owner, owner.workspaceId, randomUUID())).json().error.code).toBe(
      'document_not_found',
    )
    const stranger = await signUp({ name: 'stranger' })
    expect((await createLink(stranger, stranger.workspaceId, documentId)).status).toBe(404)
    expect((await createLink(stranger, owner.workspaceId, documentId)).status).toBe(404)

    const past = await createLink(owner, owner.workspaceId, documentId, '2020-01-01T00:00:00Z')
    expect(past.status).toBe(400)
    expect(past.json().error.code).toBe('invalid_input')
    const tooFar = new Date(Date.now() + 3651 * 86_400_000).toISOString()
    expect((await createLink(owner, owner.workspaceId, documentId, tooFar)).status).toBe(400)
    expect((await createLink(owner, owner.workspaceId, documentId, 'morgen')).status).toBe(400)

    await push(owner, op(owner, 'document', 'delete', otherId, {}, 1))
    expect((await createLink(owner, owner.workspaceId, otherId)).status).toBe(404)
  })

  it('editors and owners manage links, readers and commenters get 403, outsiders 404', async () => {
    const expected = { reader: 403, commenter: 403, editor: 201, owner: 201 } as const
    for (const [role, status] of Object.entries(expected)) {
      const member = await addMember(role)
      const created = await createLink(member, owner.workspaceId, documentId)
      expect([role, created.status]).toEqual([role, status])
      expect([role, (await links(member, owner.workspaceId)).status]).toEqual([
        role,
        status === 201 ? 200 : 403,
      ])
    }
    const { link } = await share(owner)
    const reader = await addMember('reader')
    expect((await revoke(reader, owner.workspaceId, link.id)).status).toBe(403)
    const stranger = await signUp({ name: 'stranger' })
    expect((await links(stranger, owner.workspaceId)).status).toBe(404)
    expect((await revoke(stranger, owner.workspaceId, link.id)).status).toBe(404)
    // An editor may revoke links of others.
    const editor = await addMember('editor')
    expect((await revoke(editor, owner.workspaceId, link.id)).status).toBe(204)
    expect((await revoke(editor, owner.workspaceId, link.id)).status).toBe(404)
  })

  it('needs a session', async () => {
    expect((await links({ client: guest() }, owner.workspaceId)).status).toBe(401)
    expect((await createLink({ client: guest() }, owner.workspaceId, documentId)).status).toBe(401)
  })
})

describe('reading a shared page as a guest (GET /api/public/shares/:token, T-SHARE-06)', () => {
  it('shows only the page with its blocks in order, without ids or e-mail addresses', async () => {
    const { token } = await share(owner)
    const response = expectStatus(await show(token), 200)
    expect(response.json()).toEqual({
      page: { title: 'Reiseplan', icon: null, cover: null, updatedAt: expect.any(String) },
      blocks: [
        { type: 'heading', content: 'Erster Tag', attrs: { level: 2 } },
        { type: 'paragraph', content: 'Zweiter Tag', attrs: {} },
      ],
    })
    const body = response.text()
    for (const secret of [owner.workspaceId, owner.user.id, owner.email, otherId, 'Kontonummer']) {
      expect(body).not.toContain(secret)
    }
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('follows later changes of the page', async () => {
    const { token } = await share(owner)
    await push(
      owner,
      op(
        owner,
        'block',
        'create',
        randomUUID(),
        blockPayload(documentId, 'Dritter Tag', 'paragraph', 'a2'),
      ),
    )
    const blocks = expectStatus(await show(token), 200).json().blocks
    expect(blocks.map((b: { content: string }) => b.content)).toEqual([
      'Erster Tag',
      'Zweiter Tag',
      'Dritter Tag',
    ])
  })

  it('answers unknown and malformed tokens with the same 404', async () => {
    for (const token of ['x'.repeat(43), 'kurz', `${'a'.repeat(42)}%2F`]) {
      const response = await show(token)
      expect([token, response.status]).toEqual([token, 404])
      expect(response.json().error.code).toBe('not_found')
    }
  })
})

describe('links stop working (T-SHARE-07)', () => {
  it('a revoked link answers 404 right away', async () => {
    const { token, link } = await share(owner)
    expectStatus(await show(token), 200)
    expectStatus(await revoke(owner, owner.workspaceId, link.id), 204)
    expect((await show(token)).status).toBe(404)
  })

  it('an expired link answers 404 and stays listed as expired', async () => {
    const { token } = await share(owner, documentId, new Date(Date.now() + 1500).toISOString())
    expectStatus(await show(token), 200)
    await sleep(2000)
    expect((await show(token)).status).toBe(404)
    const [listed] = expectStatus(await links(owner, owner.workspaceId), 200).json().links
    expect(listed.expired).toBe(true)
  })

  it('a deleted page answers 404, a restored one is visible again', async () => {
    const { token } = await share(owner)
    const [deleted] = await push(owner, op(owner, 'document', 'delete', documentId, {}, 1))
    expect((await show(token)).status).toBe(404)
    await push(owner, op(owner, 'document', 'restore', documentId, {}, deleted!.revision))
    expectStatus(await show(token), 200)
  })

  it('links of a creator who lost the editor role or left stop working', async () => {
    const editor = await addMember('editor')
    const { token } = await share({ ...editor, workspaceId: owner.workspaceId } as Account)
    expectStatus(await show(token), 200)
    expectStatus(
      await owner.client.patch(`/api/workspaces/${owner.workspaceId}/members/${editor.user.id}`, {
        role: 'reader',
      }),
      200,
    )
    expect((await show(token)).status).toBe(404)
    expectStatus(
      await owner.client.patch(`/api/workspaces/${owner.workspaceId}/members/${editor.user.id}`, {
        role: 'editor',
      }),
      200,
    )
    expectStatus(await show(token), 200)
    expectStatus(
      await owner.client.delete(`/api/workspaces/${owner.workspaceId}/members/${editor.user.id}`),
      204,
    )
    expect((await show(token)).status).toBe(404)
  })

  it('limits failed lookups per client address', async () => {
    const client = guest()
    for (let i = 0; i < LIMITS.loginMaxFailuresPerIp; i++) {
      expect((await show('y'.repeat(43), client)).status).toBe(404)
    }
    const { token } = await share(owner)
    const blocked = await show(token, client)
    expect(blocked.status).toBe(429)
    expect(blocked.json().error.code).toBe('too_many_attempts')
    expectStatus(await show(token), 200)
  })
})

describe('images of a shared page (GET /api/public/shares/:token/attachments/:id, T-SHARE-08)', () => {
  const image = (token: string, id: string) =>
    guest().get(`/api/public/shares/${token}/attachments/${id}`)

  it('serves raster images shown by an image block or as the cover, nothing else', async () => {
    const shown = await attachment('foto.png', 'image/png')
    const cover = await attachment('titel.png', 'image/png')
    const unused = await attachment('ungenutzt.png', 'image/png')
    const file = await attachment('notiz.txt', 'text/plain', Buffer.from('nur für Mitglieder'))
    const [doc] = await push(
      owner,
      op(
        owner,
        'block',
        'create',
        randomUUID(),
        blockPayload(documentId, 'Foto', 'image', 'a3', { attachmentId: shown }),
      ),
      op(
        owner,
        'block',
        'create',
        randomUUID(),
        blockPayload(documentId, 'Notiz', 'file', 'a4', { attachmentId: file }),
      ),
      op(owner, 'document', 'update', documentId, { cover: `attachment:${cover}` }, 1),
    ).then((results) => results.slice(2))
    expect(doc!.status).toBe('applied')
    const { token } = await share(owner)

    for (const id of [shown, cover]) {
      const response = expectStatus(await image(token, id), 200)
      expect(response.body.equals(PNG)).toBe(true)
      expect(response.headers.get('content-type')).toBe('image/png')
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
    for (const id of [unused, file, randomUUID()]) {
      expect((await image(token, id)).status).toBe(404)
    }
  })

  it('never serves images shown only on other pages', async () => {
    const shown = await attachment('foto.png', 'image/png')
    await push(
      owner,
      op(
        owner,
        'block',
        'create',
        randomUUID(),
        blockPayload(otherId, 'Foto', 'image', 'a3', { attachmentId: shown }),
      ),
    )
    // The image belongs to the shared page's workspace but is shown on another page only.
    const { token } = await share(owner)
    expect((await image(token, shown)).status).toBe(404)
  })
})
