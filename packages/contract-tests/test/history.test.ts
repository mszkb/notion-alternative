import { randomUUID } from 'node:crypto'
import type { Operation } from '@notion-alt/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  type Account,
  blockPayload,
  docPayload,
  op,
  push,
  query,
  registerDevice,
  signUp,
} from '../src/client'

/**
 * Version history (ADR 0013). Versions are editing sessions per device; the 10-minute gap
 * between sessions of one device needs server time and is tested in PHPUnit (apps/server-php/tests).
 */

let laptop: Account
let phone: Account
// Ids are unique per server, so every test gets its own.
let doc: string
let first: string
let second: string

beforeEach(async () => {
  doc = randomUUID()
  first = randomUUID()
  second = randomUUID()
  laptop = await signUp({ name: 'alice' })
  phone = { ...laptop, deviceId: await registerDevice(laptop.client, 'Phone') }
})

async function apply(operation: Operation): Promise<number> {
  const [result] = await push(laptop, operation)
  expect(['applied', 'merged']).toContain(result!.status)
  return result!.seq!
}

/** Three sessions: laptop writes, phone edits, laptop edits again. */
async function story() {
  await apply(op(laptop, 'document', 'create', doc, docPayload('Entwurf')))
  await apply(op(laptop, 'block', 'create', first, blockPayload(doc, 'erste Fassung')))
  const s1 = await apply(
    op(
      laptop,
      'block',
      'create',
      second,
      blockPayload(doc, 'Abschnitt', 'heading', 'a1', { level: 2 }),
    ),
  )
  const s2 = await apply(op(phone, 'block', 'update', first, { content: 'vom Telefon' }, 1))
  await apply(op(laptop, 'document', 'update', doc, { title: 'Fertig' }, 1))
  await apply(op(laptop, 'block', 'delete', second, {}, 1))
  const s3 = await apply(op(laptop, 'block', 'move', first, { sortKey: 'b0' }, 2))
  return { s1, s2, s3 }
}

const history = (documentId: string, workspaceId = laptop.workspaceId, client = laptop.client) =>
  client.get(`/api/documents/${documentId}/history?${query({ workspaceId })}`)

const version = (seq: number | string, documentId?: string, client = laptop.client) =>
  client.get(
    `/api/documents/${documentId ?? doc}/history/${seq}?${query({ workspaceId: laptop.workspaceId })}`,
  )

describe('GET /api/documents/:id/history', () => {
  it('groups changes into editing sessions per device, newest first', async () => {
    const { s1, s2, s3 } = await story()
    const response = await history(doc)
    expect(response.status).toBe(200)
    expect(response.json().versions).toEqual([
      { seq: s3, at: expect.any(String), deviceId: laptop.deviceId, changes: 3 },
      { seq: s2, at: expect.any(String), deviceId: phone.deviceId, changes: 1 },
      { seq: s1, at: expect.any(String), deviceId: laptop.deviceId, changes: 3 },
    ])
  })

  it('serves own pages only and validates the request', async () => {
    await story()
    const bob = await signUp({ name: 'bob', device: false })
    const foreign = await history(doc, laptop.workspaceId, bob.client)
    expect(foreign.status).toBe(404)
    expect(foreign.json().error.code).toBe('not_found')
    expect((await history(randomUUID())).status).toBe(404)
    expect((await history('nope')).status).toBe(400)
    expect((await laptop.client.get(`/api/documents/${doc}/history`)).status).toBe(400)
    expect((await history(doc, laptop.workspaceId, laptop.client.fork())).status).toBe(401)
  })
})

describe('GET /api/documents/:id/history/:seq', () => {
  it('rebuilds the page as it was at each version', async () => {
    const { s1, s2, s3 } = await story()
    const v1 = (await version(s1)).json()
    expect(v1.document).toMatchObject({ id: doc, title: 'Entwurf', deletedAt: null })
    expect(v1.blocks.map((b: { id: string; content: string }) => [b.id, b.content])).toEqual([
      [first, 'erste Fassung'],
      [second, 'Abschnitt'],
    ])
    expect(v1.blocks[1]).toMatchObject({ type: 'heading', attrs: { level: 2 } })

    const v2 = (await version(s2)).json()
    expect(v2.blocks.map((b: { content: string }) => b.content)).toEqual([
      'vom Telefon',
      'Abschnitt',
    ])

    const v3 = (await version(s3)).json()
    expect(v3.document.title).toBe('Fertig')
    expect(
      v3.blocks.map((b: { id: string; content: string; sortKey: string }) => [
        b.id,
        b.content,
        b.sortKey,
      ]),
    ).toEqual([[first, 'vom Telefon', 'b0']])
  })

  it('answers 404 for unknown pages or versions before the page existed', async () => {
    await push(laptop, op(laptop, 'document', 'create', randomUUID(), docPayload()))
    const { s1 } = await story()
    expect((await version(1, randomUUID())).status).toBe(404)
    // seq 1 is the other page, before this one was created.
    expect((await version(1)).status).toBe(404)
    expect((await version(s1)).status).toBe(200)
    expect((await version(0)).status).toBe(400)
    expect((await version('x')).status).toBe(400)
    const bob = await signUp({ name: 'bob', device: false })
    expect((await version(s1, doc, bob.client)).status).toBe(404)
  })
})
