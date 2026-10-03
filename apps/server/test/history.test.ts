import { randomUUID } from 'node:crypto'
import type { Operation } from '@notion-alt/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../src/db/database'
import { insertDevice } from '../src/devices/repository'
import { listVersions, versionState } from '../src/history/history'
import { applyOperation } from '../src/sync/apply'
import { createTestApp, register, type TestApp } from './helpers'

let app: TestApp
let db: Db
let cookie: string
let userId: string
let workspaceId: string
const laptop = randomUUID()
const phone = randomUUID()
const doc = randomUUID()
const first = randomUUID()
const second = randomUUID()
const T0 = Date.parse('2026-05-01T10:00:00Z')
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString()

async function apply(
  deviceId: string,
  minutes: number,
  entity: Operation['entity'],
  kind: Operation['kind'],
  entityId: string,
  payload: object,
  baseRevision: number | null = null,
) {
  const result = await applyOperation(
    db,
    userId,
    {
      opId: randomUUID(),
      deviceId,
      workspaceId,
      entity,
      entityId,
      kind,
      baseRevision,
      payload: payload as Record<string, unknown>,
      createdAt: at(minutes),
    },
    at(minutes),
  )
  expect(['applied', 'merged']).toContain(result.status)
  return result.status === 'applied' || result.status === 'merged' ? result.seq : 0
}

beforeEach(async () => {
  ;({ app, db } = await createTestApp({ allowRegistration: true }))
  const { response, cookie: c } = await register(app, 'alice@example.com')
  cookie = c
  userId = response.json().user.id
  workspaceId = (await app.inject({ url: '/api/workspaces', headers: { cookie } })).json()
    .workspaces[0].id
  for (const id of [laptop, phone]) await insertDevice(db, userId, id, id, at(0))
})
afterEach(() => app.close())

/** Three sessions: laptop writes, phone edits, laptop edits much later. */
async function story() {
  await apply(laptop, 0, 'document', 'create', doc, {
    parentId: null,
    title: 'Entwurf',
    sortKey: 'a0',
    favorite: false,
    createdAt: at(0),
  })
  await apply(laptop, 1, 'block', 'create', first, {
    documentId: doc,
    type: 'paragraph',
    content: 'erste Fassung',
    attrs: {},
    sortKey: 'a0',
  })
  const s1 = await apply(laptop, 2, 'block', 'create', second, {
    documentId: doc,
    type: 'heading',
    content: 'Abschnitt',
    attrs: { level: 2 },
    sortKey: 'a1',
  })
  const s2 = await apply(phone, 3, 'block', 'update', first, { content: 'vom Telefon' }, 1)
  await apply(laptop, 30, 'document', 'update', doc, { title: 'Fertig' }, 1)
  await apply(laptop, 31, 'block', 'delete', second, {}, 1)
  const s3 = await apply(laptop, 32, 'block', 'move', first, { sortKey: 'b0' }, 2)
  return { s1, s2, s3 }
}

describe('version history (ADR 0013)', () => {
  it('groups changes into editing sessions per device, newest first', async () => {
    const { s1, s2, s3 } = await story()
    expect(await listVersions(db, userId, workspaceId, doc)).toEqual([
      { seq: s3, at: at(32), deviceId: laptop, changes: 3 },
      { seq: s2, at: at(3), deviceId: phone, changes: 1 },
      { seq: s1, at: at(2), deviceId: laptop, changes: 3 },
    ])
  })

  it('rebuilds the page as it was at each version', async () => {
    const { s1, s2, s3 } = await story()
    const v1 = await versionState(db, userId, workspaceId, doc, s1)
    expect(v1!.document).toMatchObject({ title: 'Entwurf', deletedAt: null })
    expect(v1!.blocks.map((b) => [b.id, b.content])).toEqual([
      [first, 'erste Fassung'],
      [second, 'Abschnitt'],
    ])
    expect(v1!.blocks[1]).toMatchObject({ type: 'heading', attrs: { level: 2 } })

    const v2 = await versionState(db, userId, workspaceId, doc, s2)
    expect(v2!.blocks.map((b) => b.content)).toEqual(['vom Telefon', 'Abschnitt'])

    const v3 = await versionState(db, userId, workspaceId, doc, s3)
    expect(v3!.document.title).toBe('Fertig')
    expect(v3!.blocks.map((b) => [b.id, b.content, b.sortKey])).toEqual([
      [first, 'vom Telefon', 'b0'],
    ])
  })

  it('is served over HTTP for own pages only', async () => {
    const { s1 } = await story()
    const list = await app.inject({
      url: `/api/documents/${doc}/history?workspaceId=${workspaceId}`,
      headers: { cookie },
    })
    expect(list.json().versions).toHaveLength(3)
    const state = await app.inject({
      url: `/api/documents/${doc}/history/${s1}?workspaceId=${workspaceId}`,
      headers: { cookie },
    })
    expect(state.json().document.title).toBe('Entwurf')

    const { cookie: bob } = await register(app, 'bob@example.com')
    const foreign = await app.inject({
      url: `/api/documents/${doc}/history?workspaceId=${workspaceId}`,
      headers: { cookie: bob },
    })
    expect(foreign.statusCode).toBe(404)
    const before = await app.inject({
      url: `/api/documents/${randomUUID()}/history/1?workspaceId=${workspaceId}`,
      headers: { cookie },
    })
    expect(before.statusCode).toBe(404)
  })
})
