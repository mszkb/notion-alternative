import { randomUUID } from 'node:crypto'
import type { Operation } from '@notion-alt/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../src/db/database'
import { insertDevice } from '../src/devices/repository'
import { applyOperation } from '../src/sync/apply'
import { listChangesSince } from '../src/sync/changes'
import { toChange, toConflict } from '../src/sync/mapping'
import { createTestApp, register, type TestApp } from './helpers'

let app: TestApp
let db: Db
let userId: string
let workspaceId: string
let laptop: string
let phone: string

beforeEach(async () => {
  ;({ app, db } = await createTestApp())
  const { response } = await register(app, 'alice@example.com')
  userId = response.json().user.id
  workspaceId = (
    await db
      .selectFrom('workspaces')
      .select('id')
      .where('owner_id', '=', userId)
      .executeTakeFirstOrThrow()
  ).id
  laptop = randomUUID()
  phone = randomUUID()
  for (const id of [laptop, phone]) await insertDevice(db, userId, id, id, new Date().toISOString())
})
afterEach(() => app.close())

function op(
  deviceId: string,
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

const apply = (operation: Operation) => applyOperation(db, userId, operation)

/** A page with two blocks, all at revision 1, created by the laptop. */
async function page() {
  const doc = randomUUID()
  const blocks = [randomUUID(), randomUUID()]
  await apply(
    op(laptop, 'document', 'create', doc, {
      parentId: null,
      title: 'Seite',
      sortKey: 'a0',
      favorite: false,
      createdAt: 'x',
    }),
  )
  for (const [i, id] of blocks.entries()) {
    await apply(
      op(laptop, 'block', 'create', id, {
        documentId: doc,
        type: 'paragraph',
        content: `Block ${i}`,
        attrs: {},
        sortKey: `a${i}`,
      }),
    )
  }
  return { doc, blocks }
}

const blockRow = (id: string) =>
  db.selectFrom('blocks').selectAll().where('id', '=', id).executeTakeFirstOrThrow()

describe('block merge and conflicts (ADR 0003)', () => {
  it('T-MD-02: different blocks changed offline on two devices both apply', async () => {
    const { blocks } = await page()
    expect(
      await apply(op(laptop, 'block', 'update', blocks[0]!, { content: 'Laptop' }, 1)),
    ).toMatchObject({ status: 'applied' })
    expect(
      await apply(op(phone, 'block', 'update', blocks[1]!, { content: 'Telefon' }, 1)),
    ).toMatchObject({ status: 'applied' })
    expect((await blockRow(blocks[0]!)).content).toBe('Laptop')
    expect((await blockRow(blocks[1]!)).content).toBe('Telefon')
  })

  it('merges different fields of the same block or page', async () => {
    const { doc, blocks } = await page()
    await apply(op(laptop, 'block', 'update', blocks[0]!, { content: 'neuer Text' }, 1))
    expect(await apply(op(phone, 'block', 'move', blocks[0]!, { sortKey: 'a5' }, 1))).toEqual({
      status: 'merged',
      revision: 3,
      seq: expect.any(Number),
    })
    expect(await blockRow(blocks[0]!)).toMatchObject({ content: 'neuer Text', sort_key: 'a5' })

    await apply(op(laptop, 'document', 'update', doc, { title: 'Neuer Titel' }, 1))
    expect(await apply(op(phone, 'document', 'update', doc, { favorite: true }, 1))).toMatchObject({
      status: 'merged',
    })
  })

  it('T-MD-03: the same block changed on two devices keeps both versions', async () => {
    const { doc, blocks } = await page()
    await apply(op(laptop, 'block', 'update', blocks[0]!, { content: 'Version Laptop' }, 1))
    const phoneEdit = op(phone, 'block', 'update', blocks[0]!, { content: 'Version Telefon' }, 1)
    const result = await apply(phoneEdit)
    expect(result).toMatchObject({ status: 'conflict', reason: 'changed', currentRevision: 2 })
    if (result.status !== 'conflict') throw new Error('expected conflict')

    // The server keeps the first version; the conflict keeps the other one.
    expect((await blockRow(blocks[0]!)).content).toBe('Version Laptop')
    const stored = toConflict(
      await db
        .selectFrom('conflicts')
        .selectAll()
        .where('id', '=', result.conflictId)
        .executeTakeFirstOrThrow(),
    )
    expect(stored).toMatchObject({
      entity: 'block',
      entityId: blocks[0],
      documentId: doc,
      baseRevision: 1,
      local: { kind: 'update', payload: { content: 'Version Telefon' }, deviceId: phone },
      remote: { content: 'Version Laptop', revision: 2 },
      resolvedAt: null,
    })

    // Resending the same operation returns the same conflict, no second object.
    expect(await apply(phoneEdit)).toMatchObject({ conflictId: result.conflictId })
    expect(await db.selectFrom('conflicts').select('id').execute()).toHaveLength(1)

    // Every device learns about it through the change log.
    const log = (await listChangesSince(db, userId, workspaceId, 0, 100))!.map(toChange)
    const created = log.find((c) => c.entity === 'conflict')!
    expect(created).toMatchObject({ kind: 'create', entityId: result.conflictId, revision: 1 })
    expect(created.payload).toMatchObject({ reason: 'changed', local: { deviceId: phone } })
  })

  it('ADR 0019: ticking the same to-do on two devices differently is a visible conflict', async () => {
    const { blocks } = await page()
    await apply(op(laptop, 'block', 'update', blocks[0]!, { type: 'todo', attrs: {} }, 1))
    await apply(op(laptop, 'block', 'update', blocks[0]!, { attrs: { checked: true } }, 2))
    const result = await apply(
      op(phone, 'block', 'update', blocks[0]!, { attrs: { checked: false, indent: 1 } }, 2),
    )
    expect(result).toMatchObject({ status: 'conflict', reason: 'changed' })
    expect(JSON.parse((await blockRow(blocks[0]!)).attrs)).toEqual({ checked: true })

    // Ticking while the other device edits the text merges.
    await apply(op(laptop, 'block', 'update', blocks[1]!, { type: 'todo', attrs: {} }, 1))
    await apply(op(laptop, 'block', 'update', blocks[1]!, { content: 'Neu' }, 2))
    expect(
      await apply(op(phone, 'block', 'update', blocks[1]!, { attrs: { checked: true } }, 2)),
    ).toMatchObject({ status: 'merged' })
    const merged = await blockRow(blocks[1]!)
    expect([merged.type, merged.content, JSON.parse(merged.attrs)]).toEqual([
      'todo',
      'Neu',
      { checked: true },
    ])
  })

  it('deleting a block another device edited is a conflict too', async () => {
    const { blocks } = await page()
    await apply(op(laptop, 'block', 'update', blocks[0]!, { content: 'bearbeitet' }, 1))
    expect(await apply(op(phone, 'block', 'delete', blocks[0]!, {}, 1))).toMatchObject({
      status: 'conflict',
      reason: 'changed',
    })
    expect((await blockRow(blocks[0]!)).deleted_at).toBeNull()
  })

  it('resolves through a normal operation, once', async () => {
    const { blocks } = await page()
    await apply(op(laptop, 'block', 'update', blocks[0]!, { content: 'A' }, 1))
    const result = await apply(op(phone, 'block', 'update', blocks[0]!, { content: 'B' }, 1))
    if (result.status !== 'conflict') throw new Error('expected conflict')

    // The phone picks its own version: a normal block update on the current revision ...
    expect(
      await apply(op(phone, 'block', 'update', blocks[0]!, { content: 'B' }, 2)),
    ).toMatchObject({ status: 'applied', revision: 3 })
    // ... and resolves the conflict.
    const resolve = op(phone, 'conflict', 'update', result.conflictId, { resolution: 'local' }, 1)
    expect(await apply(resolve)).toMatchObject({ status: 'applied', revision: 2 })
    const row = await db
      .selectFrom('conflicts')
      .selectAll()
      .where('id', '=', result.conflictId)
      .executeTakeFirstOrThrow()
    expect(row).toMatchObject({ resolution: 'local', revision: 2 })
    expect(row.resolved_at).not.toBeNull()

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
