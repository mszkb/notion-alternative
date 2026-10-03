import { randomUUID } from 'node:crypto'
import type { Operation } from '@notion-alt/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp, register, type TestApp } from './helpers'

let app: TestApp
let cookie: string
let workspaceId: string
let deviceId: string

async function signUp(email: string) {
  const { cookie: c } = await register(app, email)
  const ws = (await app.inject({ url: '/api/workspaces', headers: { cookie: c } })).json()
    .workspaces[0].id as string
  const device = randomUUID()
  await app.inject({
    method: 'POST',
    url: '/api/devices',
    headers: { cookie: c },
    payload: { id: device, name: 'Test' },
  })
  return { cookie: c, workspaceId: ws, deviceId: device }
}

beforeEach(async () => {
  ;({ app } = await createTestApp({ allowRegistration: true }))
  ;({ cookie, workspaceId, deviceId } = await signUp('alice@example.com'))
})
afterEach(() => app.close())

function createDoc(title: string): Operation {
  return {
    opId: randomUUID(),
    deviceId,
    workspaceId,
    entity: 'document',
    entityId: randomUUID(),
    kind: 'create',
    baseRevision: null,
    payload: { parentId: null, title, sortKey: 'a0', favorite: false, createdAt: 'x' },
    createdAt: new Date().toISOString(),
  }
}

function pull(query: string, c = cookie) {
  return app.inject({ url: `/api/sync/pull?${query}`, headers: { cookie: c } })
}

describe('GET /api/sync/pull', () => {
  it('pages through changes with cursor and hasMore', async () => {
    const ops = ['a', 'b', 'c'].map(createDoc)
    await app.inject({
      method: 'POST',
      url: '/api/sync/push',
      headers: { cookie },
      payload: { operations: ops },
    })

    const first = (await pull(`workspaceId=${workspaceId}&cursor=0&limit=2`)).json()
    expect(first.changes.map((c: { seq: number }) => c.seq)).toEqual([1, 2])
    expect(first).toMatchObject({ cursor: 2, hasMore: true })
    expect(first.changes[0]).toMatchObject({
      opId: ops[0]!.opId,
      deviceId,
      entity: 'document',
      kind: 'create',
      revision: 1,
      payload: { title: 'a' },
    })

    const second = (await pull(`workspaceId=${workspaceId}&cursor=2&limit=2`)).json()
    expect(second).toMatchObject({ cursor: 3, hasMore: false })
    const empty = (await pull(`workspaceId=${workspaceId}&cursor=3`)).json()
    expect(empty).toEqual({ changes: [], cursor: 3, hasMore: false })
  })

  it('is limited to own workspaces and validates the query', async () => {
    const bob = await signUp('bob@example.com')
    expect((await pull(`workspaceId=${workspaceId}`, bob.cookie)).statusCode).toBe(404)
    expect((await pull(`workspaceId=${workspaceId}&limit=1001`)).statusCode).toBe(400)
    expect((await pull('cursor=0')).statusCode).toBe(400)
    expect((await pull(`workspaceId=${workspaceId}`, 'session=x')).statusCode).toBe(401)
  })
})
