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
