import { randomUUID } from 'node:crypto'
import type { Operation } from '@notion-alt/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../src/db/database'
import { compactChangeLog } from '../src/sync/changes'
import { createTestApp, register, type TestApp } from './helpers'

let app: TestApp
let db: Db
let cookie: string
let workspaceId: string
let deviceId: string

beforeEach(async () => {
  ;({ app, db } = await createTestApp({ allowRegistration: true }))
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
})
afterEach(() => app.close())

function op(
  entity: Operation['entity'],
  kind: Operation['kind'],
  entityId: string,
  payload: object,
  baseRevision: number | null = null,
): Operation {
  return {
    opId: randomUUID(),
    deviceId,
    workspaceId,
    entity,
    entityId,
    kind,
    baseRevision,
    payload: payload as Record<string, unknown>,
    createdAt: new Date().toISOString(),
  }
}

const docPayload = {
  parentId: null,
  title: 'Seite',
  sortKey: 'a0',
  favorite: false,
  createdAt: 'x',
}

async function push(...operations: Operation[]) {
  return (
    await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: { cookie },
      payload: { operations },
    })
  ).json().results
}

const get = (url: string, c = cookie) => app.inject({ url, headers: { cookie: c } })

describe('GET /api/sync/snapshot', () => {
  it('returns the whole workspace with tombstones and the matching cursor', async () => {
    const doc = randomUUID()
    const gone = randomUUID()
    const block = randomUUID()
    const tag = randomUUID()
    await push(
      op('document', 'create', doc, docPayload),
      op('document', 'create', gone, docPayload),
      op('block', 'create', block, {
        documentId: doc,
        type: 'heading',
        content: 'Titel',
        attrs: { level: 2 },
        sortKey: 'a0',
      }),
      op('tag', 'create', tag, { name: 'Projekt' }),
      op('document_tag', 'create', randomUUID(), { documentId: doc, tagId: tag }),
      op('document', 'delete', gone, {}, 1),
    )
    const snapshot = (await get(`/api/sync/snapshot?workspaceId=${workspaceId}`)).json()
    expect(snapshot.cursor).toBe(6)
    expect(snapshot.documents).toHaveLength(2)
    expect(snapshot.documents.find((d: { id: string }) => d.id === gone).deletedAt).not.toBeNull()
    expect(snapshot.blocks[0]).toMatchObject({
      id: block,
      documentId: doc,
      attrs: { level: 2 },
      revision: 1,
    })
    expect(snapshot.tags).toHaveLength(1)
    expect(snapshot.documentTags).toHaveLength(1)
  })

  it('is limited to own workspaces', async () => {
    const { cookie: bob } = await register(app, 'bob@example.com')
    expect((await get(`/api/sync/snapshot?workspaceId=${workspaceId}`, bob)).statusCode).toBe(404)
    expect((await get('/api/sync/snapshot')).statusCode).toBe(400)
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
    const query = new URLSearchParams({ workspaceId, limit: String(limit) })
    if (after !== undefined) query.set('after', after)
    const response = await get(`/api/sync/snapshot?${query}`)
    expect(response.statusCode).toBe(200)
    return response.json()
  }
  const ids = (p: Page) =>
    [p.documents, p.tags, p.documentTags, p.attachments, p.blocks, p.conflicts].flatMap((list) =>
      list.map((e) => e.id),
    )
  const block = (documentId: string, sortKey = 'a0') =>
    op('block', 'create', randomUUID(), {
      documentId,
      type: 'paragraph',
      content: 'x',
      attrs: {},
      sortKey,
    })

  it('walks every entity exactly once with a fixed cursor', async () => {
    const doc = randomUUID()
    const tag = randomUUID()
    await push(
      op('document', 'create', doc, docPayload),
      op('document', 'create', randomUUID(), docPayload),
      op('tag', 'create', tag, { name: 'Projekt' }),
      op('document_tag', 'create', randomUUID(), { documentId: doc, tagId: tag }),
      ...Array.from({ length: 7 }, () => block(doc)),
    )
    const whole = (await get(`/api/sync/snapshot?workspaceId=${workspaceId}`)).json()

    for (const limit of [1, 2, 3, 4, 11, 100]) {
      const first = await page(limit)
      expect(first.total).toBe(11)
      expect(first.cursor).toBe(whole.cursor)
      const seen = ids(first)
      let current = first
      while (current.next) {
        current = await page(limit, current.next)
        expect(current.cursor).toBe(first.cursor)
        expect(current.total).toBeUndefined()
        expect(ids(current).length).toBeLessThanOrEqual(limit)
        seen.push(...ids(current))
      }
      expect(seen).toHaveLength(11)
      expect(new Set(seen)).toEqual(new Set(ids(whole)))
    }
  })

  it('covers entities created or deleted between two pages through the pull', async () => {
    const doc = randomUUID()
    await push(
      op('document', 'create', doc, docPayload),
      ...Array.from({ length: 4 }, () => block(doc)),
    )
    const first = await page(2)
    // Between the pages: a new page (behind the walk), a new block and a deleted page.
    const late = randomUUID()
    const [created] = await push(op('document', 'create', late, docPayload), block(doc, 'b0'))
    await push(op('document', 'delete', doc, {}, 1))
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
      await get(`/api/sync/pull?workspaceId=${workspaceId}&cursor=${first.cursor}`)
    ).json()
    const later = pulled.changes.map((c: { entityId: string; kind: string }) => [
      c.entityId,
      c.kind,
    ])
    expect(later).toContainEqual([late, 'create'])
    expect(later).toContainEqual([doc, 'delete'])
    expect(pulled.changes[0].seq).toBe(created.seq)
  })

  it('pages within one table resume after the last id', async () => {
    const doc = randomUUID()
    await push(op('document', 'create', doc, docPayload), block(doc), block(doc), block(doc))
    const first = await page(2)
    expect(first.documents).toHaveLength(1)
    expect(first.blocks).toHaveLength(1)
    expect(first.next).toMatch(new RegExp(`^${first.cursor}\\.4\\.`))
    const second = await page(2, first.next!)
    expect(second.blocks).toHaveLength(2)
    expect(second.blocks[0]!.id > first.blocks[0]!.id).toBe(true)
  })

  it('rejects malformed tokens and foreign workspaces', async () => {
    const bad = await get(`/api/sync/snapshot?workspaceId=${workspaceId}&limit=10&after=x`)
    expect(bad.statusCode).toBe(400)
    const outOfRange = await get(
      `/api/sync/snapshot?workspaceId=${workspaceId}&limit=10&after=1.9.`,
    )
    expect(outOfRange.statusCode).toBe(404)
    expect((await get(`/api/sync/snapshot?workspaceId=${workspaceId}&limit=0`)).statusCode).toBe(
      400,
    )
    const { cookie: bob } = await register(app, 'bob@example.com')
    const foreign = await get(`/api/sync/snapshot?workspaceId=${workspaceId}&limit=10`, bob)
    expect(foreign.statusCode).toBe(404)
  })
})

describe('compacted change log', () => {
  it('answers 410 for cursors older than the log and keeps numbering', async () => {
    await push(...['a', 'b', 'c'].map(() => op('document', 'create', randomUUID(), docPayload)))
    await compactChangeLog(db, workspaceId, 3)

    const expired = await get(`/api/sync/pull?workspaceId=${workspaceId}&cursor=1`)
    expect(expired.statusCode).toBe(410)
    expect(expired.json().error.code).toBe('cursor_expired')
    expect((await get(`/api/sync/pull?workspaceId=${workspaceId}&cursor=3`)).json()).toEqual({
      changes: [],
      cursor: 3,
      hasMore: false,
    })

    // The log is empty now, numbering continues above the compacted part.
    const [result] = await push(op('document', 'create', randomUUID(), docPayload))
    expect(result.seq).toBe(4)
    const snapshot = (await get(`/api/sync/snapshot?workspaceId=${workspaceId}`)).json()
    expect(snapshot.cursor).toBe(4)
    expect(snapshot.documents).toHaveLength(4)
  })
})

describe('cursor ahead of the server', () => {
  it('answers 410 so a client re-syncs after the server was restored from a backup', async () => {
    await push(op('document', 'create', randomUUID(), docPayload))
    const ahead = await get(`/api/sync/pull?workspaceId=${workspaceId}&cursor=5`)
    expect(ahead.statusCode).toBe(410)
    expect(ahead.json().error.code).toBe('cursor_ahead')
    expect((await get(`/api/sync/pull?workspaceId=${workspaceId}&cursor=1`)).statusCode).toBe(200)
  })
})

describe('GET /api/sync/log', () => {
  it('returns the remaining log after compaction instead of 410', async () => {
    await push(
      ...['a', 'b', 'c', 'd'].map(() => op('document', 'create', randomUUID(), docPayload)),
    )
    await compactChangeLog(db, workspaceId, 2)

    const first = (await get(`/api/sync/log?workspaceId=${workspaceId}&cursor=0&limit=1`)).json()
    expect(first.changes.map((c: { seq: number }) => c.seq)).toEqual([3])
    expect(first).toMatchObject({ cursor: 3, hasMore: true, compactedSeq: 2 })
    const second = (await get(`/api/sync/log?workspaceId=${workspaceId}&cursor=3`)).json()
    expect(second.changes.map((c: { seq: number }) => c.seq)).toEqual([4])
    expect(second.hasMore).toBe(false)
  })

  it('only serves the user’s own workspaces', async () => {
    const { cookie: other } = await register(app, 'mallory@example.com')
    const response = await app.inject({
      url: `/api/sync/log?workspaceId=${workspaceId}`,
      headers: { cookie: other },
    })
    expect(response.statusCode).toBe(404)
  })
})

describe('content on demand (ADR 0017)', () => {
  const block = (documentId: string, content = 'x') =>
    op('block', 'create', randomUUID(), {
      documentId,
      type: 'paragraph',
      content,
      attrs: {},
      sortKey: 'a0',
    })

  it('leaves out the blocks with content=false, whole and paged', async () => {
    const doc = randomUUID()
    const tag = randomUUID()
    await push(
      op('document', 'create', doc, docPayload),
      op('tag', 'create', tag, { name: 'Projekt' }),
      ...Array.from({ length: 5 }, () => block(doc)),
    )
    const whole = (await get(`/api/sync/snapshot?workspaceId=${workspaceId}&content=false`)).json()
    expect(whole.documents).toHaveLength(1)
    expect(whole.tags).toHaveLength(1)
    expect(whole.blocks).toEqual([])
    expect(whole.cursor).toBe(7)

    for (const limit of [1, 2, 100]) {
      const seen: string[] = []
      let after: string | undefined
      let first = true
      for (;;) {
        const query = new URLSearchParams({ workspaceId, limit: String(limit), content: 'false' })
        if (after !== undefined) query.set('after', after)
        const page = (await get(`/api/sync/snapshot?${query}`)).json()
        if (first) expect(page.total).toBe(2)
        first = false
        expect(page.blocks).toEqual([])
        seen.push(...page.documents.map((d: { id: string }) => d.id))
        seen.push(...page.tags.map((t: { id: string }) => t.id))
        if (!page.next) break
        after = page.next
      }
      expect(seen.sort()).toEqual([doc, tag].sort())
    }
  })

  it('loads one page with its blocks and the matching seq', async () => {
    const doc = randomUUID()
    const other = randomUUID()
    await push(
      op('document', 'create', doc, docPayload),
      op('document', 'create', other, docPayload),
      block(doc, 'eins'),
      block(doc, 'zwei'),
      block(other, 'fremd'),
    )
    const response = await get(`/api/sync/documents/${doc}?workspaceId=${workspaceId}`)
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.document.id).toBe(doc)
    expect(body.blocks.map((b: { content: string }) => b.content).sort()).toEqual(['eins', 'zwei'])
    expect(body.seq).toBe(5)
  })

  it('answers 404 for foreign workspaces and unknown pages, 400 for bad input', async () => {
    const doc = randomUUID()
    await push(op('document', 'create', doc, docPayload))
    const { cookie: bob } = await register(app, 'bob@example.com')
    expect(
      (await get(`/api/sync/documents/${doc}?workspaceId=${workspaceId}`, bob)).statusCode,
    ).toBe(404)
    expect(
      (await get(`/api/sync/documents/${randomUUID()}?workspaceId=${workspaceId}`)).statusCode,
    ).toBe(404)
    expect((await get(`/api/sync/documents/${doc}`)).statusCode).toBe(400)
    expect((await get(`/api/sync/documents/x?workspaceId=${workspaceId}`)).statusCode).toBe(400)
  })
})

describe('page icon and cover (#136)', () => {
  it('stores, changes and clears them; invalid values are rejected', async () => {
    const doc = randomUUID()
    const [created] = await push(op('document', 'create', doc, { ...docPayload, icon: '📁' }))
    expect(created.status).toBe('applied')
    await push(op('document', 'update', doc, { cover: 'gradient:ocean' }, 1))
    let page = (await get(`/api/sync/snapshot?workspaceId=${workspaceId}`)).json().documents[0]
    expect([page.icon, page.cover]).toEqual(['📁', 'gradient:ocean'])

    await push(op('document', 'update', doc, { icon: null }, 2))
    page = (await get(`/api/sync/snapshot?workspaceId=${workspaceId}`)).json().documents[0]
    expect(page.icon).toBeUndefined()
    expect(page.cover).toBe('gradient:ocean')

    const [bad] = await push(op('document', 'update', doc, { cover: 'https://example.com/x' }, 3))
    expect(bad.status).toBe('rejected')
  })
})
