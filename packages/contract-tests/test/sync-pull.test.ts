import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { type Account, type Client, docPayload, op, push, query, signUp } from '../src/client'
import { exportWorkspace, importCopy, snapshot } from '../src/workspace-data'

let alice: Account

beforeEach(async () => {
  alice = await signUp({ name: 'alice' })
})

const createDoc = (title: string) =>
  op(alice, 'document', 'create', randomUUID(), docPayload(title))

const pull = (params: Record<string, string | number | undefined>, client: Client = alice.client) =>
  client.get(`/api/sync/pull?${query(params)}`)

const log = (params: Record<string, string | number | undefined>, client: Client = alice.client) =>
  client.get(`/api/sync/log?${query(params)}`)

describe('GET /api/sync/pull', () => {
  it('pages through changes with cursor and hasMore', async () => {
    const ops = ['a', 'b', 'c'].map(createDoc)
    await push(alice, ...ops)
    const workspaceId = alice.workspaceId

    const first = (await pull({ workspaceId, cursor: 0, limit: 2 })).json()
    expect(first.changes.map((c: { seq: number }) => c.seq)).toEqual([1, 2])
    expect(first).toMatchObject({ cursor: 2, hasMore: true })
    expect(first.changes[0]).toEqual({
      seq: 1,
      opId: ops[0]!.opId,
      deviceId: alice.deviceId,
      entity: 'document',
      entityId: ops[0]!.entityId,
      kind: 'create',
      revision: 1,
      payload: expect.objectContaining({ title: 'a' }),
      appliedAt: expect.any(String),
    })

    const second = (await pull({ workspaceId, cursor: 2, limit: 2 })).json()
    expect(second).toMatchObject({ cursor: 3, hasMore: false })
    expect((await pull({ workspaceId, cursor: 3 })).json()).toEqual({
      changes: [],
      cursor: 3,
      hasMore: false,
    })
    // Cursor and limit have defaults.
    expect((await pull({ workspaceId })).json().changes).toHaveLength(3)
  })

  it('is limited to own workspaces and validates the query', async () => {
    const bob = await signUp({ name: 'bob' })
    const workspaceId = alice.workspaceId
    const foreign = await pull({ workspaceId }, bob.client)
    expect(foreign.status).toBe(404)
    expect(foreign.json().error.code).toBe('not_found')
    expect((await pull({ workspaceId: randomUUID() })).status).toBe(404)
    expect((await pull({ workspaceId, limit: 1001 })).status).toBe(400)
    expect((await pull({ workspaceId, cursor: -1 })).status).toBe(400)
    const missing = await pull({ cursor: 0 })
    expect(missing.status).toBe(400)
    expect(missing.json().error.code).toBe('invalid_input')
    expect((await pull({ workspaceId }, alice.client.fork('session=x'))).status).toBe(401)
  })
})

describe('cursor ahead of the server', () => {
  it('answers 410 so a client re-syncs after the server was restored from a backup', async () => {
    await push(alice, createDoc('a'))
    const ahead = await pull({ workspaceId: alice.workspaceId, cursor: 5 })
    expect(ahead.status).toBe(410)
    expect(ahead.json().error.code).toBe('cursor_ahead')
    expect((await pull({ workspaceId: alice.workspaceId, cursor: 1 })).status).toBe(200)
  })
})

/**
 * Compaction has no API; an imported workspace is the only way to get one through HTTP: its
 * log counts as compacted up to the imported history (`compacted_seq` = number of changes).
 */
describe('compacted change log (imported workspace)', () => {
  async function compactedWorkspace() {
    await push(alice, ...['a', 'b', 'c'].map(createDoc))
    const data = await exportWorkspace(alice.client, alice.workspaceId)
    const { workspaceId } = await importCopy(alice.client, data)
    return workspaceId
  }

  it('answers 410 for cursors older than the log and keeps numbering', async () => {
    const workspaceId = await compactedWorkspace()
    const expired = await pull({ workspaceId, cursor: 1 })
    expect(expired.status).toBe(410)
    expect(expired.json().error.code).toBe('cursor_expired')
    expect((await pull({ workspaceId, cursor: 0 })).status).toBe(410)
    expect((await pull({ workspaceId, cursor: 3 })).json()).toEqual({
      changes: [],
      cursor: 3,
      hasMore: false,
    })
    expect((await pull({ workspaceId, cursor: 4 })).json().error.code).toBe('cursor_ahead')

    // Numbering continues above the compacted part.
    const [result] = await push(alice, { ...createDoc('d'), workspaceId })
    expect(result!.seq).toBe(4)
    const state = await snapshot(alice.client, workspaceId)
    expect(state.cursor).toBe(4)
    expect(state.documents).toHaveLength(4)
    const next = (await pull({ workspaceId, cursor: 3 })).json()
    expect(next.changes.map((c: { seq: number }) => c.seq)).toEqual([4])
  })

  it('GET /api/sync/log still serves the log with compactedSeq instead of 410', async () => {
    const workspaceId = await compactedWorkspace()
    await push(alice, { ...createDoc('d'), workspaceId })
    const first = (await log({ workspaceId, cursor: 0, limit: 2 })).json()
    expect(first).toMatchObject({ cursor: 2, hasMore: true, compactedSeq: 3 })
    expect(first.changes.map((c: { seq: number }) => c.seq)).toEqual([1, 2])
    const rest = (await log({ workspaceId, cursor: 2 })).json()
    expect(rest.changes.map((c: { seq: number }) => c.seq)).toEqual([3, 4])
    expect(rest.hasMore).toBe(false)
  })
})

describe('GET /api/sync/log', () => {
  it('returns the complete log of a workspace without compaction', async () => {
    await push(alice, ...['a', 'b'].map(createDoc))
    const response = await log({ workspaceId: alice.workspaceId })
    expect(response.status).toBe(200)
    expect(response.json()).toMatchObject({ cursor: 2, hasMore: false, compactedSeq: 0 })
    expect(response.json().changes).toHaveLength(2)
  })

  it('only serves the user’s own workspaces and validates the query', async () => {
    const mallory = await signUp({ name: 'mallory', device: false })
    expect((await log({ workspaceId: alice.workspaceId }, mallory.client)).status).toBe(404)
    expect((await log({ workspaceId: 'nope' })).status).toBe(400)
    expect((await log({ workspaceId: alice.workspaceId }, alice.client.fork())).status).toBe(401)
  })
})
