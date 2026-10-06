import { randomUUID } from 'node:crypto'
import type { Change } from '@notion-alt/shared'
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
import { snapshot } from '../src/workspace-data'

/**
 * Server-side application of operations (ADR 0002/0003), observed through push, pull and
 * snapshot only.
 */

let alice: Account
/** A second device of Alice. */
let phone: Account

beforeEach(async () => {
  alice = await signUp({ name: 'alice' })
  phone = { ...alice, deviceId: await registerDevice(alice.client, 'Phone') }
})

const createDoc = (id: string, parentId: string | null = null, target: Account = alice) =>
  op(target, 'document', 'create', id, docPayload('Seite', parentId))

async function changes(account: Account = alice, workspaceId = account.workspaceId) {
  const response = await account.client.get(`/api/sync/pull?${query({ workspaceId, cursor: 0 })}`)
  expect(response.status).toBe(200)
  return response.json().changes as Change[]
}

describe('applying operations', () => {
  it('raises the revision per change and the seq without gaps', async () => {
    const doc = randomUUID()
    const block = randomUUID()
    expect(await push(alice, createDoc(doc))).toMatchObject([
      { status: 'applied', revision: 1, seq: 1 },
    ])
    expect(
      await push(alice, op(alice, 'block', 'create', block, blockPayload(doc, 'Hallo'))),
    ).toMatchObject([{ status: 'applied', revision: 1, seq: 2 }])
    expect(
      await push(alice, op(alice, 'block', 'update', block, { content: 'Welt', attrs: {} }, 1)),
    ).toMatchObject([{ status: 'applied', revision: 2, seq: 3 }])
    expect(
      await push(alice, op(alice, 'block', 'move', block, { sortKey: 'a5' }, 2)),
    ).toMatchObject([{ revision: 3, seq: 4 }])
    expect(
      await push(alice, op(alice, 'document', 'update', doc, { title: 'Neu', favorite: true }, 1)),
    ).toMatchObject([{ status: 'applied', revision: 2, seq: 5 }])
    expect(await push(alice, op(alice, 'block', 'delete', block, {}, 3))).toMatchObject([
      { revision: 4, seq: 6 },
    ])

    const state = await snapshot(alice.client, alice.workspaceId)
    const storedBlock = state.blocks.find((b) => b.id === block)!
    expect(storedBlock).toMatchObject({ content: 'Welt', sortKey: 'a5', revision: 4 })
    expect(storedBlock.deletedAt).not.toBeNull()
    expect(state.documents.find((d) => d.id === doc)).toMatchObject({
      title: 'Neu',
      favorite: true,
      revision: 2,
      deletedAt: null,
    })

    const log = await changes()
    expect(log.map((c) => c.seq)).toEqual([1, 2, 3, 4, 5, 6])
    expect(log.map((c) => `${c.entity}:${c.kind}:${c.revision}`)).toEqual([
      'document:create:1',
      'block:create:1',
      'block:update:2',
      'block:move:3',
      'document:update:2',
      'block:delete:4',
    ])
    expect(log[2]!.payload).toEqual({ content: 'Welt', attrs: {} })
    expect(log.every((c) => c.deviceId === alice.deviceId)).toBe(true)
  })

  it('is idempotent by opId and refuses a reused opId', async () => {
    const create = createDoc(randomUUID())
    await push(alice, create)
    expect(await push(alice, create)).toEqual([
      { opId: create.opId, status: 'duplicate', revision: 1, seq: 1 },
    ])
    expect(await changes()).toHaveLength(1)

    const reused = { ...createDoc(randomUUID()), opId: create.opId }
    expect(await push(alice, reused)).toMatchObject([{ status: 'rejected', code: 'op_id_reused' }])
  })

  it('reports a change by another device since the base revision as conflict', async () => {
    const doc = randomUUID()
    await push(alice, createDoc(doc))
    // The phone saw revision 1 and changed the title.
    await push(alice, op(phone, 'document', 'update', doc, { title: 'A' }, 1))
    // This device also edited the title on top of revision 1: conflict, title not written.
    const [result] = await push(alice, op(alice, 'document', 'update', doc, { title: 'B' }, 1))
    expect(result).toMatchObject({
      status: 'conflict',
      currentRevision: 2,
      reason: 'changed',
      conflictId: expect.any(String),
    })
    const state = await snapshot(alice.client, alice.workspaceId)
    expect(state.documents.find((d) => d.id === doc)).toMatchObject({ title: 'A', revision: 2 })
    // The conflict object is logged like any other entity.
    expect((await changes()).map((c) => c.entity)).toEqual(['document', 'document', 'conflict'])
    // A base revision the server never had.
    expect(
      await push(alice, op(alice, 'document', 'update', doc, { title: 'C' }, 7)),
    ).toMatchObject([{ status: 'rejected', code: 'invalid_payload' }])
  })

  it('T-DEL-02: edits to what another device deleted become conflicts, never vanish', async () => {
    const doc = randomUUID()
    const block = randomUUID()
    await push(
      alice,
      createDoc(doc),
      op(alice, 'block', 'create', block, blockPayload(doc, '')),
      // The phone deletes the page.
      op(phone, 'document', 'delete', doc, {}, 1),
    )

    // This device edited offline: block in the deleted page, the page itself, a new block.
    expect(
      await push(alice, op(alice, 'block', 'update', block, { content: 'offline' }, 1)),
    ).toMatchObject([{ status: 'conflict', currentRevision: 2, reason: 'parent_deleted' }])
    expect(
      await push(alice, op(alice, 'document', 'update', doc, { title: 'x' }, 1)),
    ).toMatchObject([{ status: 'conflict', currentRevision: 2, reason: 'deleted' }])
    expect(
      await push(
        alice,
        op(alice, 'block', 'create', randomUUID(), blockPayload(doc, 'neu', 'paragraph', 'a1')),
      ),
    ).toMatchObject([{ status: 'conflict', reason: 'parent_deleted' }])
    // Deleting it here as well is the same outcome; deleting its blocks is fine.
    const again = op(alice, 'document', 'delete', doc, {}, 1)
    expect(await push(alice, again)).toEqual([
      { opId: again.opId, status: 'duplicate', revision: 2, seq: 3 },
    ])
    expect(await push(alice, op(alice, 'block', 'delete', block, {}, 1))).toMatchObject([
      { status: 'applied' },
    ])
  })

  it("chains a device's own queued operations without conflict", async () => {
    const doc = randomUUID()
    // Created and edited offline: every queued op still has base revision null.
    await push(
      alice,
      createDoc(doc),
      op(alice, 'document', 'update', doc, { title: 'eins' }, null),
      op(alice, 'document', 'update', doc, { title: 'zwei' }, null),
    )
    expect(
      await push(alice, op(alice, 'document', 'move', doc, { parentId: null, sortKey: 'b' }, 1)),
    ).toMatchObject([{ status: 'applied', revision: 4, seq: 4 }])
  })

  it('keeps users, workspaces and devices apart', async () => {
    const bob = await signUp({ name: 'bob' })
    const doc = randomUUID()
    await push(alice, createDoc(doc))

    // Bob cannot write into Alice's workspace, nor touch her entities from his own workspace.
    expect(await push(bob, createDoc(randomUUID()))).toMatchObject([
      { status: 'rejected', code: 'workspace_not_found' },
    ])
    expect(await push(bob, op(bob, 'document', 'update', doc, { title: 'x' }, 1))).toMatchObject([
      { status: 'rejected', code: 'not_found' },
    ])
    // Alice cannot use Bob's device id.
    expect(
      await push(alice, createDoc(randomUUID(), null, { ...alice, deviceId: bob.deviceId })),
    ).toMatchObject([{ status: 'rejected', code: 'device_not_active' }])
    // Nor an id that was never registered.
    expect(
      await push(alice, createDoc(randomUUID(), null, { ...alice, deviceId: randomUUID() })),
    ).toMatchObject([{ status: 'rejected', code: 'device_not_active' }])
    // Bob cannot read Alice's log.
    const foreign = await bob.client.get(
      `/api/sync/pull?${query({ workspaceId: alice.workspaceId })}`,
    )
    expect(foreign.status).toBe(404)
  })

  it('a removed device can no longer push', async () => {
    // The session now belongs to the phone (registered last), so the laptop can be removed.
    expect((await alice.client.delete(`/api/devices/${alice.deviceId}`)).status).toBe(204)
    expect(await push(alice, createDoc(randomUUID()))).toMatchObject([
      { status: 'rejected', code: 'device_not_active' },
    ])
  })

  it('validates payloads, references and the page tree', async () => {
    const doc = randomUUID()
    const child = randomUUID()
    expect(
      await push(alice, op(alice, 'document', 'create', doc, { title: 'ohne Rest' })),
    ).toMatchObject([{ status: 'rejected', code: 'invalid_payload' }])
    expect(await push(alice, createDoc(doc, randomUUID()))).toMatchObject([{ code: 'not_found' }])
    await push(alice, createDoc(doc))
    expect(await push(alice, createDoc(doc))).toMatchObject([{ code: 'already_exists' }])
    await push(alice, createDoc(child, doc))
    // A page cannot move below its own child.
    expect(
      await push(alice, op(alice, 'document', 'move', doc, { parentId: child, sortKey: 'a1' }, 1)),
    ).toMatchObject([{ code: 'invalid_payload' }])
    expect(
      await push(alice, op(alice, 'block', 'create', randomUUID(), blockPayload(randomUUID()))),
    ).toMatchObject([{ code: 'not_found' }])
    expect(
      await push(
        alice,
        op(alice, 'document_tag', 'create', randomUUID(), {
          documentId: doc,
          tagId: randomUUID(),
        }),
      ),
    ).toMatchObject([{ code: 'not_found' }])
    await push(alice, op(alice, 'document', 'delete', child, {}, 1))
    expect(
      await push(alice, op(alice, 'document', 'update', child, { title: 'x' }, 2)),
    ).toMatchObject([{ code: 'deleted' }])
    // Rejected operations leave no trace in the log.
    expect((await changes()).map((c) => c.seq)).toEqual([1, 2, 3])
  })

  it('applies tags and tag assignments', async () => {
    const doc = randomUUID()
    const tag = randomUUID()
    const assignment = randomUUID()
    await push(alice, createDoc(doc))
    expect(await push(alice, op(alice, 'tag', 'create', tag, { name: 'Projekt' }))).toMatchObject([
      { status: 'applied' },
    ])
    expect(
      await push(
        alice,
        op(alice, 'document_tag', 'create', assignment, { documentId: doc, tagId: tag }),
      ),
    ).toMatchObject([{ status: 'applied' }])
    expect(await push(alice, op(alice, 'document_tag', 'delete', assignment, {}, 1))).toMatchObject(
      [{ status: 'applied', revision: 2 }],
    )
    expect(await push(alice, op(alice, 'tag', 'move', tag, {}, 1))).toMatchObject([
      { code: 'invalid_payload' },
    ])
    const state = await snapshot(alice.client, alice.workspaceId)
    expect(state.tags).toMatchObject([{ id: tag, name: 'Projekt', deletedAt: null }])
    expect(state.documentTags).toMatchObject([{ id: assignment, documentId: doc, tagId: tag }])
    expect(state.documentTags[0]!.deletedAt).not.toBeNull()
  })

  it('numbers changes per workspace and pages through them', async () => {
    const second = (await alice.client.post('/api/workspaces', { name: 'Zweiter' })).json()
      .workspace.id as string
    await push(alice, createDoc(randomUUID()), createDoc(randomUUID()))
    expect(await push(alice, { ...createDoc(randomUUID()), workspaceId: second })).toMatchObject([
      { seq: 1 },
    ])

    const pull = (cursor: number, limit: number) =>
      alice.client.get(`/api/sync/pull?${query({ workspaceId: alice.workspaceId, cursor, limit })}`)
    expect((await pull(1, 10)).json().changes.map((c: Change) => c.seq)).toEqual([2])
    expect((await pull(0, 1)).json().changes.map((c: Change) => c.seq)).toEqual([1])
  })
})

describe('restoring pages (#66)', () => {
  it('lifts the tombstone with blocks intact, idempotently', async () => {
    const doc = randomUUID()
    const block = randomUUID()
    await push(
      alice,
      createDoc(doc),
      op(alice, 'block', 'create', block, blockPayload(doc, 'Bleibt erhalten')),
      op(alice, 'document', 'delete', doc, {}, 1),
    )
    const restore = op(alice, 'document', 'restore', doc, {}, 2)
    expect(await push(alice, restore)).toMatchObject([{ status: 'applied', revision: 3 }])
    const state = await snapshot(alice.client, alice.workspaceId)
    expect(state.documents.find((d) => d.id === doc)).toMatchObject({
      deletedAt: null,
      revision: 3,
    })
    expect(state.blocks.find((b) => b.id === block)?.content).toBe('Bleibt erhalten')

    expect(await push(alice, op(alice, 'document', 'restore', doc, {}, 2))).toMatchObject([
      { status: 'duplicate', revision: 3 },
    ])
    expect(await push(alice, op(alice, 'block', 'restore', block, {}, 1))).toMatchObject([
      { status: 'rejected', code: 'invalid_payload' },
    ])
  })
})
