import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  type Account,
  type Client,
  blockPayload,
  docPayload,
  op,
  push,
  query,
  signUp,
} from '../src/client'

let alice: Account

beforeEach(async () => {
  alice = await signUp({ name: 'alice' })
})

const get = (params: Record<string, string | number | undefined>, client: Client = alice.client) =>
  client.get(`/api/sync/snapshot?${query(params)}`)

const createDoc = (id = randomUUID()) => op(alice, 'document', 'create', id, docPayload())

describe('GET /api/sync/snapshot', () => {
  it('returns the whole workspace with tombstones and the matching cursor', async () => {
    const doc = randomUUID()
    const gone = randomUUID()
    const block = randomUUID()
    const tag = randomUUID()
    await push(
      alice,
      createDoc(doc),
      createDoc(gone),
      op(
        alice,
        'block',
        'create',
        block,
        blockPayload(doc, 'Titel', 'heading', 'a0', { level: 2 }),
      ),
      op(alice, 'tag', 'create', tag, { name: 'Projekt' }),
      op(alice, 'document_tag', 'create', randomUUID(), { documentId: doc, tagId: tag }),
      op(alice, 'document', 'delete', gone, {}, 1),
    )
    const response = await get({ workspaceId: alice.workspaceId })
    expect(response.status).toBe(200)
    const snapshot = response.json()
    expect(snapshot.cursor).toBe(6)
    expect(snapshot.next).toBeUndefined()
    expect(snapshot.documents).toHaveLength(2)
    expect(snapshot.documents.find((d: { id: string }) => d.id === gone).deletedAt).not.toBeNull()
    expect(snapshot.documents.find((d: { id: string }) => d.id === doc)).toMatchObject({
      id: doc,
      workspaceId: alice.workspaceId,
      parentId: null,
      title: 'Seite',
      sortKey: 'a0',
      favorite: false,
      revision: 1,
      deletedAt: null,
    })
    expect(snapshot.blocks[0]).toMatchObject({
      id: block,
      documentId: doc,
      type: 'heading',
      content: 'Titel',
      attrs: { level: 2 },
      revision: 1,
    })
    expect(snapshot.tags).toHaveLength(1)
    expect(snapshot.documentTags).toHaveLength(1)
    expect(snapshot.attachments).toEqual([])
    expect(snapshot.conflicts).toEqual([])
  })

  it('is limited to own workspaces', async () => {
    const bob = await signUp({ name: 'bob', device: false })
    const foreign = await get({ workspaceId: alice.workspaceId }, bob.client)
    expect(foreign.status).toBe(404)
    expect(foreign.json().error.code).toBe('not_found')
    expect((await get({})).status).toBe(400)
    expect((await get({ workspaceId: alice.workspaceId }, alice.client.fork())).status).toBe(401)
  })
})

describe('paged snapshot (#97)', () => {
  type Page = {
    documents: { id: string; deletedAt: string | null }[]
    blocks: { id: string }[]
    tags: { id: string }[]
    documentTags: { id: string }[]
    attachments: { id: string }[]
    conflicts: { id: string }[]
    cursor: number
    next: string | null
    total?: number
  }
  const page = async (limit: number, after?: string): Promise<Page> => {
    const response = await get({ workspaceId: alice.workspaceId, limit, after })
    expect(response.status).toBe(200)
    return response.json()
  }
  const ids = (p: Page) =>
    [p.documents, p.tags, p.documentTags, p.attachments, p.blocks, p.conflicts].flatMap((list) =>
      list.map((e) => e.id),
    )
  const block = (documentId: string, sortKey = 'a0') =>
    op(alice, 'block', 'create', randomUUID(), blockPayload(documentId, 'x', 'paragraph', sortKey))

  it('walks every entity exactly once with a fixed cursor, across table boundaries', async () => {
    const doc = randomUUID()
    const tag = randomUUID()
    await push(
      alice,
      createDoc(doc),
      createDoc(),
      op(alice, 'tag', 'create', tag, { name: 'Projekt' }),
      op(alice, 'document_tag', 'create', randomUUID(), { documentId: doc, tagId: tag }),
      ...Array.from({ length: 7 }, () => block(doc)),
    )
    const whole = (await get({ workspaceId: alice.workspaceId })).json()

    for (const limit of [1, 2, 3, 4, 11, 100]) {
      const first = await page(limit)
      expect(first.total).toBe(11)
      expect(first.cursor).toBe(whole.cursor)
      expect(ids(first).length).toBeLessThanOrEqual(limit)
      const seen = ids(first)
      let current = first
      while (current.next) {
        current = await page(limit, current.next)
        expect(current.cursor).toBe(first.cursor)
        expect(current.total).toBeUndefined()
        expect(ids(current).length).toBeLessThanOrEqual(limit)
        seen.push(...ids(current))
      }
      expect(current.next).toBeNull()
      expect(seen).toHaveLength(11)
      expect(new Set(seen)).toEqual(new Set(ids(whole)))
    }
  })

  it('covers entities created or deleted between two pages through the pull', async () => {
    const doc = randomUUID()
    await push(alice, createDoc(doc), ...Array.from({ length: 4 }, () => block(doc)))
    const first = await page(2)
    // Between the pages: a new page (behind the walk), a new block and a deleted page.
    const late = randomUUID()
    const [created] = await push(alice, createDoc(late), block(doc, 'b0'))
    await push(alice, op(alice, 'document', 'delete', doc, {}, 1))
    const seen = ids(first)
    let current = first
    while (current.next) {
      current = await page(2, current.next)
      seen.push(...ids(current))
    }
    // The walk passed the page before it was deleted and the new page behind it.
    expect(first.documents.find((d) => d.id === doc)?.deletedAt).toBeNull()
    expect(seen).not.toContain(late)
    // Whatever the pages missed or showed in an older state is in the log after the cursor.
    const pulled = (
      await alice.client.get(
        `/api/sync/pull?${query({ workspaceId: alice.workspaceId, cursor: first.cursor })}`,
      )
    ).json()
    const later = pulled.changes.map((c: { entityId: string; kind: string }) => [
      c.entityId,
      c.kind,
    ])
    expect(later).toContainEqual([late, 'create'])
    expect(later).toContainEqual([doc, 'delete'])
    expect(pulled.changes[0].seq).toBe(created!.seq)
  })

  it('pages within one table resume after the last id', async () => {
    const doc = randomUUID()
    await push(alice, createDoc(doc), block(doc), block(doc), block(doc))
    const first = await page(2)
    expect(first.documents).toHaveLength(1)
    expect(first.blocks).toHaveLength(1)
    // `<cursor>.<table>.<last id>` (syncSnapshotQuerySchema), opaque to clients.
    expect(first.next).toMatch(new RegExp(`^${first.cursor}\\.\\d\\.[0-9a-f-]{36}$`))
    const second = await page(2, first.next!)
    expect(second.blocks).toHaveLength(2)
    expect(second.blocks[0]!.id > first.blocks[0]!.id).toBe(true)
  })

  it('rejects malformed tokens and foreign workspaces', async () => {
    const workspaceId = alice.workspaceId
    const bad = await get({ workspaceId, limit: 10, after: 'x' })
    expect(bad.status).toBe(400)
    expect(bad.json().error.code).toBe('invalid_input')
    // Well-formed, but no such table.
    expect((await get({ workspaceId, limit: 10, after: '1.9.' })).status).toBe(404)
    expect((await get({ workspaceId, limit: 0 })).status).toBe(400)
    expect((await get({ workspaceId, limit: 5001 })).status).toBe(400)
    const bob = await signUp({ name: 'bob', device: false })
    expect((await get({ workspaceId, limit: 10 }, bob.client)).status).toBe(404)
  })
})
