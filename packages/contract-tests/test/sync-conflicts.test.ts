import { randomUUID } from 'node:crypto'
import type { Change, Operation } from '@notion-alt/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  type Account,
  type PushResult,
  blockPayload,
  docPayload,
  op,
  push,
  query,
  registerDevice,
  signUp,
} from '../src/client'
import { snapshot } from '../src/workspace-data'

/** Block merge and conflict objects (ADR 0003) with two devices of one account. */

let laptop: Account
let phone: Account

beforeEach(async () => {
  laptop = await signUp({ name: 'alice' })
  phone = { ...laptop, deviceId: await registerDevice(laptop.client, 'Phone') }
})

async function apply(operation: Operation): Promise<PushResult> {
  const [result] = await push(laptop, operation)
  return result!
}

/** A page with two blocks, all at revision 1, created by the laptop. */
async function page() {
  const doc = randomUUID()
  const blocks = [randomUUID(), randomUUID()] as const
  await push(
    laptop,
    op(laptop, 'document', 'create', doc, docPayload()),
    ...blocks.map((id, i) =>
      op(laptop, 'block', 'create', id, blockPayload(doc, `Block ${i}`, 'paragraph', `a${i}`)),
    ),
  )
  return { doc, blocks }
}

const state = () => snapshot(laptop.client, laptop.workspaceId)
const blockRow = async (id: string) => (await state()).blocks.find((b) => b.id === id)!
const conflictRow = async (id: string) => (await state()).conflicts.find((c) => c.id === id)!

describe('block merge and conflicts (ADR 0003)', () => {
  it('T-MD-02: different blocks changed offline on two devices both apply', async () => {
    const { blocks } = await page()
    expect(
      await apply(op(laptop, 'block', 'update', blocks[0], { content: 'Laptop' }, 1)),
    ).toMatchObject({ status: 'applied' })
    expect(
      await apply(op(phone, 'block', 'update', blocks[1], { content: 'Telefon' }, 1)),
    ).toMatchObject({ status: 'applied' })
    expect((await blockRow(blocks[0])).content).toBe('Laptop')
    expect((await blockRow(blocks[1])).content).toBe('Telefon')
  })

  it('merges different fields of the same block or page', async () => {
    const { doc, blocks } = await page()
    await apply(op(laptop, 'block', 'update', blocks[0], { content: 'neuer Text' }, 1))
    const move = op(phone, 'block', 'move', blocks[0], { sortKey: 'a5' }, 1)
    expect(await apply(move)).toEqual({
      opId: move.opId,
      status: 'merged',
      revision: 3,
      seq: expect.any(Number),
    })
    expect(await blockRow(blocks[0])).toMatchObject({ content: 'neuer Text', sortKey: 'a5' })

    await apply(op(laptop, 'document', 'update', doc, { title: 'Neuer Titel' }, 1))
    expect(await apply(op(phone, 'document', 'update', doc, { favorite: true }, 1))).toMatchObject({
      status: 'merged',
    })
    expect((await state()).documents.find((d) => d.id === doc)).toMatchObject({
      title: 'Neuer Titel',
      favorite: true,
    })
  })

  it('T-MD-03: the same block changed on two devices keeps both versions', async () => {
    const { doc, blocks } = await page()
    await apply(op(laptop, 'block', 'update', blocks[0], { content: 'Version Laptop' }, 1))
    const phoneEdit = op(phone, 'block', 'update', blocks[0], { content: 'Version Telefon' }, 1)
    const result = await apply(phoneEdit)
    expect(result).toEqual({
      opId: phoneEdit.opId,
      status: 'conflict',
      reason: 'changed',
      currentRevision: 2,
      conflictId: expect.any(String),
    })

    // The server keeps the first version; the conflict keeps the other one.
    expect((await blockRow(blocks[0])).content).toBe('Version Laptop')
    expect(await conflictRow(result.conflictId)).toMatchObject({
      id: result.conflictId,
      workspaceId: laptop.workspaceId,
      entity: 'block',
      entityId: blocks[0],
      documentId: doc,
      baseRevision: 1,
      local: { kind: 'update', payload: { content: 'Version Telefon' }, deviceId: phone.deviceId },
      remote: { content: 'Version Laptop', revision: 2 },
      resolvedAt: null,
    })

    // Resending the same operation returns the same conflict, no second object.
    expect(await apply(phoneEdit)).toMatchObject({ conflictId: result.conflictId })
    expect((await state()).conflicts).toHaveLength(1)

    // Every device learns about it through the change log.
    const log: Change[] = (
      await laptop.client.get(`/api/sync/pull?${query({ workspaceId: laptop.workspaceId })}`)
    ).json().changes
    const created = log.find((c) => c.entity === 'conflict')!
    expect(created).toMatchObject({ kind: 'create', entityId: result.conflictId, revision: 1 })
    expect(created.payload).toMatchObject({
      reason: 'changed',
      local: { deviceId: phone.deviceId },
    })
  })

  it('deleting a block another device edited is a conflict too', async () => {
    const { blocks } = await page()
    await apply(op(laptop, 'block', 'update', blocks[0], { content: 'bearbeitet' }, 1))
    expect(await apply(op(phone, 'block', 'delete', blocks[0], {}, 1))).toMatchObject({
      status: 'conflict',
      reason: 'changed',
    })
    expect((await blockRow(blocks[0])).deletedAt).toBeNull()
  })

  it('resolves through a normal operation, once', async () => {
    const { blocks } = await page()
    await apply(op(laptop, 'block', 'update', blocks[0], { content: 'A' }, 1))
    const result = await apply(op(phone, 'block', 'update', blocks[0], { content: 'B' }, 1))
    expect(result.status).toBe('conflict')

    // The phone picks its own version: a normal block update on the current revision ...
    expect(await apply(op(phone, 'block', 'update', blocks[0], { content: 'B' }, 2))).toMatchObject(
      { status: 'applied', revision: 3 },
    )
    // ... and resolves the conflict.
    const resolve = op(phone, 'conflict', 'update', result.conflictId, { resolution: 'local' }, 1)
    expect(await apply(resolve)).toMatchObject({ status: 'applied', revision: 2 })
    const row = await conflictRow(result.conflictId)
    expect(row).toMatchObject({ resolution: 'local', revision: 2 })
    expect(row.resolvedAt).not.toBeNull()

    // The laptop resolving it too is not a new conflict.
    expect(
      await apply(op(laptop, 'conflict', 'update', result.conflictId, { resolution: 'remote' }, 1)),
    ).toMatchObject({ status: 'duplicate' })
  })

  it('does not let clients create conflicts', async () => {
    expect(
      await apply(op(laptop, 'conflict', 'create', randomUUID(), { anything: true })),
    ).toMatchObject({ status: 'rejected', code: 'invalid_payload' })
  })
})
