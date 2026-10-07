import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Account, blockPayload, docPayload, errorCode } from './client'

// Sync protocol (ADR 0002, ADR 0003) over HTTP only.

describe('POST /sync/push', () => {
  it('applies in order and answers a resent operation as duplicate', async () => {
    const a = await Account.create()
    const doc = randomUUID()
    const create = a.op('document', 'create', doc, docPayload('Eins'))
    const [first] = await a.push(create)
    expect(first).toMatchObject({ opId: create.opId, status: 'applied', revision: 1 })
    expect(first.seq).toBeGreaterThan(0)
    const [again] = await a.push(create)
    expect(again).toMatchObject({ status: 'duplicate', revision: 1, seq: first.seq })
  })

  it('rejects a reused op id with another change, invalid payloads and unknown entities', async () => {
    const a = await Account.create()
    const doc = randomUUID()
    const create = a.op('document', 'create', doc, docPayload('Eins'))
    await a.push(create)
    // Same op id for another entity: refused (the same entity counts as a resend).
    const [reused] = await a.push({ ...create, entityId: randomUUID() })
    expect(reused).toMatchObject({ status: 'rejected', code: 'op_id_reused' })
    const [invalid] = await a.push(a.op('block', 'create', randomUUID(), { type: 'nope' }))
    expect(invalid).toMatchObject({ status: 'rejected', code: 'invalid_payload' })
    const [missing] = await a.push(a.op('document', 'update', randomUUID(), { title: 'x' }, 1))
    expect(missing).toMatchObject({ status: 'rejected', code: 'not_found' })
    const [exists] = await a.push(a.op('document', 'create', doc, docPayload('Doppelt')))
    expect(exists).toMatchObject({ status: 'rejected', code: 'already_exists' })
  })

  it('rejects malformed batches and foreign workspaces', async () => {
    const a = await Account.create()
    expect((await a.post('/sync/push', { operations: [] })).status).toBe(400)
    expect(errorCode(await a.post('/sync/push', { operations: 'x' }))).toBe('invalid_input')
    const b = await Account.create()
    const foreign = {
      ...a.op('document', 'create', randomUUID(), docPayload()),
      workspaceId: b.workspaceId,
    }
    const [result] = await a.push(foreign)
    expect(result).toMatchObject({ status: 'rejected', code: 'workspace_not_found' })
  })

  it('merges different fields and makes the same field a visible conflict', async () => {
    const a = await Account.create()
    const phone = randomUUID()
    expect((await a.post('/devices', { id: phone, name: 'Telefon' })).status).toBe(201)
    const { id: doc, blockIds } = await a.page('Seite', ['Original'])
    const block = blockIds[0]!
    // Laptop changes the text, the phone (same base) moves the block: merged.
    await a.push(a.op('block', 'update', block, { content: 'Laptop' }, 1))
    const [moved] = await a.push(a.op('block', 'move', block, { sortKey: 'a5' }, 1, phone))
    expect(moved).toMatchObject({ status: 'merged', revision: 3 })
    // The phone changes the same text from the old base: conflict, the first version stays.
    const [conflict] = await a.push(
      a.op('block', 'update', block, { content: 'Telefon' }, 1, phone),
    )
    expect(conflict).toMatchObject({ status: 'conflict', reason: 'changed' })
    const snapshot = (await a.get(`/sync/snapshot?workspaceId=${a.workspaceId}`)).body
    const stored = snapshot.blocks.find((b: { id: string }) => b.id === block)
    expect([stored.content, stored.sortKey]).toEqual(['Laptop', 'a5'])
    expect(
      snapshot.conflicts.find((c: { id: string }) => c.id === conflict.conflictId),
    ).toMatchObject({
      entity: 'block',
      entityId: block,
      documentId: doc,
      resolvedAt: null,
    })
  })

  it('reports conflicts for edits of deleted blocks and inside deleted pages', async () => {
    const a = await Account.create()
    const other = randomUUID()
    const device = await a.post('/devices', { id: other, name: 'Zweites' })
    expect(device.status).toBe(201)
    const { id: doc, blockIds } = await a.page('Seite', ['eins', 'zwei'])
    // Deleted on the second device, edited on the first: conflict "deleted".
    await a.push(a.op('block', 'delete', blockIds[0]!, {}, 1, other))
    const [deleted] = await a.push(a.op('block', 'update', blockIds[0]!, { content: 'neu' }, 1))
    expect(deleted).toMatchObject({ status: 'conflict', reason: 'deleted' })
    // A new block in a page deleted elsewhere: conflict "parent_deleted".
    await a.push(a.op('document', 'delete', doc, {}, 1, other))
    const [orphan] = await a.push(a.op('block', 'create', randomUUID(), blockPayload(doc, 'spät')))
    expect(orphan).toMatchObject({ status: 'conflict', reason: 'parent_deleted' })
  })
})

describe('GET /sync/pull', () => {
  it('pages through the change log with a cursor', async () => {
    const a = await Account.create()
    await a.page('Seite', ['eins', 'zwei', 'drei'])
    const first = (await a.get(`/sync/pull?workspaceId=${a.workspaceId}&cursor=0&limit=2`)).body
    expect(first.changes).toHaveLength(2)
    expect(first.hasMore).toBe(true)
    const rest = (
      await a.get(`/sync/pull?workspaceId=${a.workspaceId}&cursor=${first.cursor}&limit=1000`)
    ).body
    expect(rest.changes).toHaveLength(2)
    expect(rest.hasMore).toBe(false)
    expect(rest.changes[0].seq).toBe(first.cursor + 1)
    expect(Object.keys(rest.changes[0]).sort()).toEqual(
      [
        'appliedAt',
        'deviceId',
        'entity',
        'entityId',
        'kind',
        'opId',
        'payload',
        'revision',
        'seq',
      ].sort(),
    )
  })

  it('answers 410 cursor_ahead, 404 for foreign workspaces and 400 for bad input', async () => {
    const a = await Account.create()
    await a.page()
    const ahead = await a.get(`/sync/pull?workspaceId=${a.workspaceId}&cursor=999999`)
    expect([ahead.status, errorCode(ahead)]).toEqual([410, 'cursor_ahead'])
    const b = await Account.create()
    expect((await b.get(`/sync/pull?workspaceId=${a.workspaceId}&cursor=0`)).status).toBe(404)
    expect((await a.get(`/sync/pull?workspaceId=${a.workspaceId}&cursor=-1`)).status).toBe(400)
  })

  it('/sync/log returns the change log with its compaction mark', async () => {
    const a = await Account.create()
    await a.page()
    const log = (await a.get(`/sync/log?workspaceId=${a.workspaceId}`)).body
    expect(log).toMatchObject({ hasMore: false, compactedSeq: 0 })
    expect(log.changes).toHaveLength(1)
  })
})

describe('GET /sync/snapshot', () => {
  it('walks every entity once across pages and table boundaries, with a fixed cursor', async () => {
    const a = await Account.create()
    const { id: doc } = await a.page('Seite', ['a', 'b', 'c'])
    const tag = randomUUID()
    await a.push(
      a.op('tag', 'create', tag, { name: 'projekt' }),
      a.op('document_tag', 'create', randomUUID(), { documentId: doc, tagId: tag }),
    )
    const whole = (await a.get(`/sync/snapshot?workspaceId=${a.workspaceId}`)).body
    for (const limit of [1, 2, 3, 100]) {
      const seen: string[] = []
      let after: string | undefined
      let cursor: number | undefined
      for (let page = 0; page < 50; page++) {
        const query = new URLSearchParams({ workspaceId: a.workspaceId, limit: String(limit) })
        if (after) query.set('after', after)
        const body = (await a.get(`/sync/snapshot?${query}`)).body
        if (page === 0) expect(body.total).toBe(6)
        cursor ??= body.cursor
        expect(body.cursor).toBe(cursor)
        for (const list of [
          'documents',
          'tags',
          'documentTags',
          'attachments',
          'blocks',
          'conflicts',
        ]) {
          seen.push(...body[list].map((e: { id: string }) => e.id))
        }
        if (!body.next) break
        after = body.next
      }
      expect(seen.sort()).toEqual(
        [...whole.documents, ...whole.tags, ...whole.documentTags, ...whole.blocks]
          .map((e: { id: string }) => e.id)
          .sort(),
      )
      expect(cursor).toBe(whole.cursor)
    }
  })

  it('leaves out blocks with content=false and loads one page on its own (ADR 0017)', async () => {
    const a = await Account.create()
    const { id: doc } = await a.page('Seite', ['eins'])
    const lean = (await a.get(`/sync/snapshot?workspaceId=${a.workspaceId}&content=false`)).body
    expect(lean.blocks).toEqual([])
    expect(lean.documents).toHaveLength(1)
    const single = (await a.get(`/sync/documents/${doc}?workspaceId=${a.workspaceId}`)).body
    expect(single.document.id).toBe(doc)
    expect(single.blocks.map((b: { content: string }) => b.content)).toEqual(['eins'])
    expect(single.seq).toBe(lean.cursor)
    expect(
      (await a.get(`/sync/documents/${randomUUID()}?workspaceId=${a.workspaceId}`)).status,
    ).toBe(404)
    const batch = await a.post('/sync/documents', {
      workspaceId: a.workspaceId,
      ids: [doc, randomUUID()],
    })
    expect(batch.status).toBe(200)
    expect(batch.body.pages.map((p: { document: { id: string } }) => p.document.id)).toEqual([doc])
    expect(batch.body.seq).toBe(lean.cursor)
    const empty = await a.post('/sync/documents', { workspaceId: a.workspaceId, ids: [] })
    expect(empty.status).toBe(400)
  })

  it('refuses malformed paging tokens and foreign workspaces', async () => {
    const a = await Account.create()
    const bad = await a.get(`/sync/snapshot?workspaceId=${a.workspaceId}&limit=10&after=x`)
    expect(bad.status).toBe(400)
    const b = await Account.create()
    expect((await b.get(`/sync/snapshot?workspaceId=${a.workspaceId}`)).status).toBe(404)
  })
})
