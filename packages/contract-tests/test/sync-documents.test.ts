import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { type Account, blockPayload, docPayload, op, push, query, signUp } from '../src/client'

let alice: Account

beforeEach(async () => {
  alice = await signUp({ name: 'alice' })
})

/** A page with one block per content string; returns the page id. */
async function page(contents: string[], title = 'Seite'): Promise<string> {
  const id = randomUUID()
  const results = await push(
    alice,
    op(alice, 'document', 'create', id, docPayload(title)),
    ...contents.map((content, i) =>
      op(alice, 'block', 'create', randomUUID(), blockPayload(id, content, 'paragraph', `a${i}`)),
    ),
  )
  expect(results.every((r) => r.status === 'applied')).toBe(true)
  return id
}

const snapshot = (params: Record<string, string | number | undefined>) =>
  alice.client.get(`/api/sync/snapshot?${query({ workspaceId: alice.workspaceId, ...params })}`)

describe('content on demand (ADR 0017)', () => {
  it('leaves out the blocks with content=false, paged or not', async () => {
    const doc = await page(['eins', 'zwei'])
    const lean = (await snapshot({ content: 'false' })).json()
    expect(lean.blocks).toEqual([])
    expect(lean.documents.map((d: { id: string }) => d.id)).toEqual([doc])

    const paged = (await snapshot({ content: 'false', limit: 10 })).json()
    expect(paged).toMatchObject({ blocks: [], total: 1, next: null })
    expect((await snapshot({ content: 'true' })).json().blocks).toHaveLength(2)
    expect((await snapshot({ content: 'yes' })).status).toBe(400)
  })

  it('pages past the skipped blocks without a gap', async () => {
    await page(['eins'])
    const tag = randomUUID()
    await push(alice, op(alice, 'tag', 'create', tag, { name: 't' }))
    // Documents and tags only: two entities, one per page.
    const first = (await snapshot({ content: 'false', limit: 1 })).json()
    expect(first.total).toBe(2)
    const second = (await snapshot({ content: 'false', limit: 1, after: first.next })).json()
    expect(second.tags.map((t: { id: string }) => t.id)).toEqual([tag])
    let next = second.next
    while (next) {
      const more = (await snapshot({ content: 'false', limit: 1, after: next })).json()
      expect(more.blocks).toEqual([])
      next = more.next
    }
  })

  it('GET /api/sync/documents/:id returns one page with its blocks and the log position', async () => {
    const doc = await page(['eins', 'zwei'])
    await page(['anderswo'])
    const cursor = (await snapshot({ content: 'false' })).json().cursor
    const response = await alice.client.get(
      `/api/sync/documents/${doc}?workspaceId=${alice.workspaceId}`,
    )
    expect(response.status).toBe(200)
    const body = response.json()
    expect(body.document.id).toBe(doc)
    expect(body.blocks.map((b: { content: string }) => b.content).sort()).toEqual(['eins', 'zwei'])
    expect(body.seq).toBe(cursor)

    const missing = await alice.client.get(
      `/api/sync/documents/${randomUUID()}?workspaceId=${alice.workspaceId}`,
    )
    expect([missing.status, missing.json().error.code]).toEqual([404, 'not_found'])
    expect(
      (await alice.client.get(`/api/sync/documents/x?workspaceId=${alice.workspaceId}`)).status,
    ).toBe(400)
    expect((await alice.client.get(`/api/sync/documents/${doc}`)).status).toBe(400)
    const bob = await signUp({ name: 'bob', device: false })
    expect(
      (await bob.client.get(`/api/sync/documents/${doc}?workspaceId=${alice.workspaceId}`)).status,
    ).toBe(404)
    expect(
      (await alice.client.fork().get(`/api/sync/documents/${doc}?workspaceId=${alice.workspaceId}`))
        .status,
    ).toBe(401)
  })

  it('POST /api/sync/documents returns the known pages of a batch', async () => {
    const a = await page(['a1', 'a2'])
    const b = await page([])
    const cursor = (await snapshot({ content: 'false' })).json().cursor
    const response = await alice.client.post('/api/sync/documents', {
      workspaceId: alice.workspaceId,
      ids: [a, b, randomUUID()],
    })
    expect(response.status).toBe(200)
    const body = response.json()
    expect(body.seq).toBe(cursor)
    const pages = new Map<string, { content: string }[]>(
      body.pages.map((p: { document: { id: string }; blocks: { content: string }[] }) => [
        p.document.id,
        p.blocks,
      ]),
    )
    expect([...pages.keys()].sort()).toEqual([a, b].sort())
    expect(
      pages
        .get(a)!
        .map((block) => block.content)
        .sort(),
    ).toEqual(['a1', 'a2'])
    expect(pages.get(b)).toEqual([])

    const post = (body: unknown) => alice.client.post('/api/sync/documents', body)
    expect((await post({ workspaceId: alice.workspaceId, ids: [] })).status).toBe(400)
    const tooMany = Array.from({ length: 101 }, () => randomUUID())
    expect((await post({ workspaceId: alice.workspaceId, ids: tooMany })).status).toBe(400)
    expect((await post({ workspaceId: alice.workspaceId, ids: ['x'] })).status).toBe(400)
    const bob = await signUp({ name: 'bob', device: false })
    const foreign = await bob.client.post('/api/sync/documents', {
      workspaceId: alice.workspaceId,
      ids: [a],
    })
    expect(foreign.status).toBe(404)
  })
})

describe('page icon and cover (#136)', () => {
  const documents = async () =>
    (await snapshot({})).json().documents as { id: string; icon?: string; cover?: string }[]

  it('stores, changes and removes them; absent fields stay absent', async () => {
    const doc = randomUUID()
    const plain = await page([])
    const [created] = await push(
      alice,
      op(alice, 'document', 'create', doc, {
        ...docPayload('Mit Icon'),
        icon: '🚀',
        cover: 'gradient:ocean',
      }),
    )
    expect(created!.status).toBe('applied')
    let byId = new Map((await documents()).map((d) => [d.id, d]))
    expect(byId.get(doc)).toMatchObject({ icon: '🚀', cover: 'gradient:ocean' })
    expect(byId.get(plain)).not.toHaveProperty('icon')
    expect(byId.get(plain)).not.toHaveProperty('cover')

    const [updated] = await push(
      alice,
      op(alice, 'document', 'update', doc, { icon: null, cover: 'gradient:sand' }, 1),
    )
    expect(updated!.status).toBe('applied')
    byId = new Map((await documents()).map((d) => [d.id, d]))
    expect(byId.get(doc)).not.toHaveProperty('icon')
    expect(byId.get(doc)!.cover).toBe('gradient:sand')
  })

  it('accepts an attachment of the same workspace as cover only', async () => {
    const doc = await page([])
    const attachment = randomUUID()
    await push(
      alice,
      op(alice, 'attachment', 'create', attachment, {
        documentId: doc,
        name: 'bild.png',
        mimeType: 'image/png',
        size: 10,
        sha256: '0'.repeat(64),
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    )
    const results = await push(
      alice,
      op(alice, 'document', 'update', doc, { cover: `attachment:${attachment}` }, 1),
      op(alice, 'document', 'update', doc, { cover: `attachment:${randomUUID()}` }, 2),
      op(alice, 'document', 'update', doc, { cover: 'gradient:neon' }, 2),
      op(alice, 'document', 'update', doc, { icon: '' }, 2),
      op(alice, 'document', 'update', doc, { icon: 'x'.repeat(17) }, 2),
    )
    expect(results.map((r) => [r.status, r.code])).toEqual([
      ['applied', undefined],
      ['rejected', 'invalid_payload'],
      ['rejected', 'invalid_payload'],
      ['rejected', 'invalid_payload'],
      ['rejected', 'invalid_payload'],
    ])
    expect((await documents()).find((d) => d.id === doc)!.cover).toBe(`attachment:${attachment}`)
  })
})

describe('block types to-do, toggle, callout and divider (ADR 0019)', () => {
  it('accepts the new types with their attributes and rejects unknown ones', async () => {
    const doc = await page([])
    const block = (type: string, attrs: object, content = 'x') =>
      op(alice, 'block', 'create', randomUUID(), blockPayload(doc, content, type, 'a0', attrs))
    const results = await push(
      alice,
      block('todo', { checked: true, indent: 1 }),
      block('toggle', {}),
      block('callout', { icon: '💡' }),
      block('divider', {}, ''),
      block('todo', { checked: 'yes' }),
      block('callout', { icon: '' }),
      block('checklist', {}),
    )
    expect(results.map((r) => r.status)).toEqual([
      'applied',
      'applied',
      'applied',
      'applied',
      'rejected',
      'rejected',
      'rejected',
    ])
    const blocks = (await snapshot({})).json().blocks as { type: string; attrs: object }[]
    expect(blocks.find((b) => b.type === 'todo')!.attrs).toEqual({ checked: true, indent: 1 })
    expect(blocks.find((b) => b.type === 'callout')!.attrs).toEqual({ icon: '💡' })
  })
})
