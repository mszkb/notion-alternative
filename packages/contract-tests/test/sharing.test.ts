import { createHash, randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  type Account,
  type Client,
  blockPayload,
  docPayload,
  expectStatus,
  op,
  push,
  query,
  signUp,
} from '../src/client'

/**
 * Sharing and roles (ADR 0014): members of a workspace with `reader`, `commenter`, `editor` or
 * `owner`; the creator stays owner. Every endpoint is checked for every role and for accounts
 * outside the workspace (T-SHARE-*).
 */

const members = (account: { client: Client }, workspaceId: string) =>
  account.client.get(`/api/workspaces/${workspaceId}/members`)
const addMember = (owner: { client: Client }, workspaceId: string, email: string, role: string) =>
  owner.client.post(`/api/workspaces/${workspaceId}/members`, { email, role })
const setRole = (owner: { client: Client }, workspaceId: string, userId: string, role: string) =>
  owner.client.patch(`/api/workspaces/${workspaceId}/members/${userId}`, { role })
const removeMember = (account: { client: Client }, workspaceId: string, userId: string) =>
  account.client.delete(`/api/workspaces/${workspaceId}/members/${userId}`)

/** `account` as a device in `workspaceId` (operations target the shared workspace). */
const as = (account: Account, workspaceId: string) => ({
  client: account.client,
  deviceId: account.deviceId,
  workspaceId,
})

async function share(owner: Account, role: string): Promise<Account> {
  const member = await signUp({ name: role })
  expectStatus(await addMember(owner, owner.workspaceId, member.email, role), 201)
  return member
}

describe('members (GET/POST/PATCH/DELETE /api/workspaces/:id/members)', () => {
  it('adds an existing account by e-mail; the creator comes first and stays owner', async () => {
    const owner = await signUp({ name: 'owner' })
    const bob = await signUp({ name: 'bob' })

    const added = await addMember(
      owner,
      owner.workspaceId,
      ` ${bob.email.toUpperCase()} `,
      'editor',
    )
    expect(added.status).toBe(201)
    expect(added.json().member).toEqual({
      userId: bob.user.id,
      email: bob.email,
      role: 'editor',
      creator: false,
      addedAt: expect.any(String),
    })

    const list = expectStatus(await members(bob, owner.workspaceId), 200).json().members
    expect(
      list.map((m: { email: string; role: string; creator: boolean }) => [
        m.email,
        m.role,
        m.creator,
      ]),
    ).toEqual([
      [owner.email, 'owner', true],
      [bob.email, 'editor', false],
    ])

    // The shared workspace appears in the member's list with the role.
    const workspaces = expectStatus(await bob.client.get('/api/workspaces'), 200).json().workspaces
    expect(workspaces.map((w: { id: string; role: string }) => [w.id, w.role]).sort()).toEqual(
      [
        [bob.workspaceId, 'owner'],
        [owner.workspaceId, 'editor'],
      ].sort(),
    )
    const one = expectStatus(await bob.client.get(`/api/workspaces/${owner.workspaceId}`), 200)
    expect(one.json().workspace).toMatchObject({ ownerId: owner.user.id, role: 'editor' })
  })

  it('refuses unknown accounts, members twice and the creator', async () => {
    const owner = await signUp({ name: 'owner' })
    const bob = await signUp({ name: 'bob' })
    const unknown = await addMember(owner, owner.workspaceId, 'niemand@example.com', 'reader')
    expect(unknown.status).toBe(404)
    expect(unknown.json().error.code).toBe('user_not_found')

    expectStatus(await addMember(owner, owner.workspaceId, bob.email, 'reader'), 201)
    const twice = await addMember(owner, owner.workspaceId, bob.email, 'editor')
    expect(twice.status).toBe(409)
    expect(twice.json().error.code).toBe('already_member')
    const creator = await addMember(owner, owner.workspaceId, owner.email, 'reader')
    expect(creator.json().error.code).toBe('already_member')

    const invalid = await addMember(owner, owner.workspaceId, bob.email, 'admin')
    expect(invalid.status).toBe(400)
    expect(invalid.json().error.code).toBe('invalid_input')
  })

  it('only owners manage members; outsiders do not learn the workspace exists', async () => {
    const owner = await signUp({ name: 'owner' })
    const editor = await share(owner, 'editor')
    const carol = await signUp({ name: 'carol' })
    const stranger = await signUp({ name: 'stranger' })

    for (const response of [
      await addMember(editor, owner.workspaceId, carol.email, 'reader'),
      await setRole(editor, owner.workspaceId, editor.user.id, 'owner'),
      await removeMember(editor, owner.workspaceId, owner.user.id),
    ]) {
      expect(response.status).toBe(403)
      expect(response.json().error.code).toBe('forbidden')
    }
    for (const response of [
      await members(stranger, owner.workspaceId),
      await addMember(stranger, owner.workspaceId, carol.email, 'reader'),
      await setRole(stranger, owner.workspaceId, editor.user.id, 'reader'),
      await removeMember(stranger, owner.workspaceId, editor.user.id),
      await stranger.client.get(`/api/workspaces/${owner.workspaceId}`),
    ]) {
      expect(response.status).toBe(404)
      expect(response.json().error.code).toBe('not_found')
    }
  })

  it('owners change roles and may make others owner; the creator is fixed', async () => {
    const owner = await signUp({ name: 'owner' })
    const bob = await share(owner, 'reader')
    const carol = await signUp({ name: 'carol' })

    const promoted = expectStatus(
      await setRole(owner, owner.workspaceId, bob.user.id, 'owner'),
      200,
    )
    expect(promoted.json().member).toMatchObject({ userId: bob.user.id, role: 'owner' })
    // The new owner manages members too, but cannot touch the creator.
    expectStatus(await addMember(bob, owner.workspaceId, carol.email, 'commenter'), 201)
    for (const response of [
      await setRole(bob, owner.workspaceId, owner.user.id, 'reader'),
      await removeMember(bob, owner.workspaceId, owner.user.id),
      await removeMember(owner, owner.workspaceId, owner.user.id),
    ]) {
      expect(response.status).toBe(409)
      expect(response.json().error.code).toBe('creator_fixed')
    }
    const missing = await setRole(owner, owner.workspaceId, randomUUID(), 'reader')
    expect(missing.status).toBe(404)
  })

  it('members leave on their own; removed members lose access', async () => {
    const owner = await signUp({ name: 'owner' })
    const reader = await share(owner, 'reader')
    const editor = await share(owner, 'editor')

    expect((await removeMember(reader, owner.workspaceId, reader.user.id)).status).toBe(204)
    expect((await reader.client.get(`/api/workspaces/${owner.workspaceId}`)).status).toBe(404)

    expect((await removeMember(owner, owner.workspaceId, editor.user.id)).status).toBe(204)
    const pull = await editor.client.get(
      `/api/sync/pull?${query({ workspaceId: owner.workspaceId })}`,
    )
    expect(pull.status).toBe(404)
    const [result] = await push(
      as(editor, owner.workspaceId),
      op(as(editor, owner.workspaceId), 'document', 'create', randomUUID(), docPayload('Zu spät')),
    )
    expect(result).toMatchObject({ status: 'rejected', code: 'workspace_not_found' })
    const list = expectStatus(await members(owner, owner.workspaceId), 200).json().members
    expect(list).toHaveLength(1)
  })
})

describe('authorization matrix (T-SHARE-01)', () => {
  const ROLES = ['reader', 'commenter', 'editor', 'owner'] as const
  type Who = (typeof ROLES)[number] | 'stranger'

  let owner: Account
  const accounts = {} as Record<Who, Account>
  let documentId: string
  let blockId: string
  let attachmentId: string
  let seq: number
  const content = Buffer.from('geteilter Anhang')

  beforeAll(async () => {
    owner = await signUp({ name: 'owner' })
    for (const role of ROLES) {
      accounts[role] = role === 'owner' ? await share(owner, 'owner') : await share(owner, role)
    }
    accounts.stranger = await signUp({ name: 'stranger' })
    documentId = randomUUID()
    blockId = randomUUID()
    attachmentId = randomUUID()
    const results = await push(
      owner,
      op(owner, 'document', 'create', documentId, docPayload('Gemeinsame Planung')),
      op(owner, 'block', 'create', blockId, blockPayload(documentId, 'Einkaufsliste Zitronen')),
      op(owner, 'attachment', 'create', attachmentId, {
        documentId,
        name: 'notiz.txt',
        mimeType: 'text/plain',
        size: content.length,
        sha256: createHash('sha256').update(content).digest('hex'),
        createdAt: new Date().toISOString(),
      }),
    )
    expect(results.map((r) => r.status)).toEqual(['applied', 'applied', 'applied'])
    seq = results[0]!.seq!
    expectStatus(
      await owner.client.put(`/api/attachments/${attachmentId}/content`, {
        body: content,
        headers: { 'content-type': 'application/octet-stream' },
      }),
      204,
    )
  })

  const ws = () => owner.workspaceId
  const reads: Record<string, (client: Client) => Promise<{ status: number }>> = {
    'GET /api/workspaces/:id': (c) => c.get(`/api/workspaces/${ws()}`),
    'GET /api/workspaces/:id/members': (c) => c.get(`/api/workspaces/${ws()}/members`),
    'GET /api/sync/pull': (c) => c.get(`/api/sync/pull?${query({ workspaceId: ws() })}`),
    'GET /api/sync/log': (c) => c.get(`/api/sync/log?${query({ workspaceId: ws() })}`),
    'GET /api/sync/snapshot': (c) => c.get(`/api/sync/snapshot?${query({ workspaceId: ws() })}`),
    'GET /api/sync/snapshot (paged)': (c) =>
      c.get(`/api/sync/snapshot?${query({ workspaceId: ws(), limit: 10 })}`),
    'GET /api/sync/documents/:id': (c) =>
      c.get(`/api/sync/documents/${documentId}?${query({ workspaceId: ws() })}`),
    'POST /api/sync/documents': (c) =>
      c.post('/api/sync/documents', { workspaceId: ws(), ids: [documentId] }),
    'GET /api/search': (c) => c.get(`/api/search?${query({ workspaceId: ws(), q: 'zitronen' })}`),
    'GET /api/documents/:id/history': (c) =>
      c.get(`/api/documents/${documentId}/history?${query({ workspaceId: ws() })}`),
    'GET /api/documents/:id/history/:seq': (c) =>
      c.get(`/api/documents/${documentId}/history/${seq}?${query({ workspaceId: ws() })}`),
    'GET /api/attachments/usage': (c) =>
      c.get(`/api/attachments/usage?${query({ workspaceId: ws() })}`),
    'GET /api/attachments/:id/content': (c) => c.get(`/api/attachments/${attachmentId}/content`),
  }

  for (const [name, read] of Object.entries(reads)) {
    it(`${name}: every member reads, outsiders get 404`, async () => {
      for (const role of ROLES) {
        expect([role, (await read(accounts[role].client)).status]).toEqual([role, 200])
      }
      expect((await read(accounts.stranger.client)).status).toBe(404)
    })
  }

  it('the search finds shared pages for members only', async () => {
    const hits = expectStatus(
      await accounts.reader.client.get(
        `/api/search?${query({ workspaceId: ws(), q: 'zitronen' })}`,
      ),
      200,
    ).json()
    expect(hits.hits.map((h: { documentId: string }) => h.documentId)).toEqual([documentId])
  })

  it('POST /api/sync/push: editors and owners change content, readers and commenters get forbidden', async () => {
    const expected: Record<Who, string> = {
      reader: 'forbidden',
      commenter: 'forbidden',
      editor: 'applied',
      owner: 'applied',
      stranger: 'workspace_not_found',
    }
    for (const [who, outcome] of Object.entries(expected) as [Who, string][]) {
      const target = as(accounts[who], ws())
      const id = randomUUID()
      const results = await push(
        target,
        op(
          target,
          'block',
          'create',
          id,
          blockPayload(documentId, `von ${who}`, 'paragraph', 'b0'),
        ),
        op(target, 'block', 'update', id, { content: `geändert von ${who}` }, 1),
      )
      for (const result of results) {
        const got = result.status === 'rejected' ? result.code : result.status
        expect([who, got === 'merged' ? 'applied' : got]).toEqual([who, outcome])
      }
    }
  })

  it('PUT /api/attachments/:id/content: editors upload, readers and commenters get 403', async () => {
    const data = Buffer.from('neue Datei')
    const id = randomUUID()
    const editor = as(accounts.editor, ws())
    const [created] = await push(
      editor,
      op(editor, 'attachment', 'create', id, {
        documentId,
        name: 'neu.txt',
        mimeType: 'text/plain',
        size: data.length,
        sha256: createHash('sha256').update(data).digest('hex'),
        createdAt: new Date().toISOString(),
      }),
    )
    expect(created!.status).toBe('applied')
    const upload = (client: Client) =>
      client.put(`/api/attachments/${id}/content`, {
        body: data,
        headers: { 'content-type': 'application/octet-stream' },
      })
    for (const role of ['reader', 'commenter'] as const) {
      const response = await upload(accounts[role].client)
      expect([role, response.status]).toEqual([role, 403])
    }
    expect((await upload(accounts.stranger.client)).status).toBe(404)
    expect((await upload(accounts.editor.client)).status).toBe(204)
    // The creator's quota carries the file.
    const usage = expectStatus(
      await owner.client.get(`/api/attachments/usage?${query({ workspaceId: owner.workspaceId })}`),
      200,
    ).json()
    expect(usage.usedBytes).toBe(content.length + data.length)
  })

  it('read links (ADR 0022): editors and owners manage them, readers and commenters get 403', async () => {
    const expected: Record<Who, number> = {
      reader: 403,
      commenter: 403,
      editor: 201,
      owner: 201,
      stranger: 404,
    }
    for (const [who, status] of Object.entries(expected) as [Who, number][]) {
      const client = accounts[who].client
      const created = await client.post(`/api/workspaces/${ws()}/share-links`, {
        documentId,
        expiresAt: null,
      })
      expect([who, created.status]).toEqual([who, status])
      const listed = await client.get(`/api/workspaces/${ws()}/share-links`)
      expect([who, listed.status]).toEqual([who, status === 201 ? 200 : status])
      const linkId = status === 201 ? created.json().link.id : randomUUID()
      const revoked = await client.delete(`/api/workspaces/${ws()}/share-links/${linkId}`)
      expect([who, revoked.status]).toEqual([who, status === 201 ? 204 : status])
    }
  })

  it('changes of one member reach the others; private workspaces stay private', async () => {
    const editor = as(accounts.editor, ws())
    const pageId = randomUUID()
    const before = expectStatus(
      await accounts.reader.client.get(`/api/sync/log?${query({ workspaceId: ws() })}`),
      200,
    ).json()
    await push(editor, op(editor, 'document', 'create', pageId, docPayload('Vom Editor')))
    const after = expectStatus(
      await accounts.reader.client.get(
        `/api/sync/pull?${query({ workspaceId: ws(), cursor: before.cursor })}`,
      ),
      200,
    ).json()
    expect(after.changes.map((c: { entityId: string }) => c.entityId)).toContain(pageId)

    // The editor's own workspace is not shared with anyone.
    const own = accounts.editor.workspaceId
    for (const role of ['reader', 'owner'] as const) {
      const response = await accounts[role].client.get(
        `/api/sync/snapshot?${query({ workspaceId: own })}`,
      )
      expect(response.status).toBe(404)
    }
  })
})

describe('roles change while devices are offline (T-SHARE-02)', () => {
  it('a lowered role refuses new changes but still acknowledges ones applied before', async () => {
    const owner = await signUp({ name: 'owner' })
    const bob = await share(owner, 'editor')
    const target = as(bob, owner.workspaceId)
    const applied = op(target, 'document', 'create', randomUUID(), docPayload('Vorher'))
    expect((await push(target, applied))[0]!.status).toBe('applied')

    expectStatus(await setRole(owner, owner.workspaceId, bob.user.id, 'reader'), 200)
    const later = op(target, 'document', 'create', randomUUID(), docPayload('Nachher'))
    const [again, refused] = await push(target, applied, later)
    expect(again!.status).toBe('duplicate')
    expect(refused).toMatchObject({ status: 'rejected', code: 'forbidden' })
  })
})
