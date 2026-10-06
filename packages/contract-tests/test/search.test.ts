import { randomUUID } from 'node:crypto'
import type { Operation } from '@notion-alt/shared'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  type Account,
  type Client,
  blockPayload,
  docPayload,
  op,
  push,
  query,
  signUp,
} from '../src/client'

let alice: Account

beforeEach(async () => {
  alice = await signUp({ name: 'alice' })
})

const page = (id: string, title: string, target: Account = alice) =>
  op(target, 'document', 'create', id, docPayload(title))
const block = (id: string, documentId: string, content: string, type = 'paragraph') =>
  op(alice, 'block', 'create', id, blockPayload(documentId, content, type))

const search = (q: string, workspaceId = alice.workspaceId, client: Client = alice.client) =>
  client.get(`/api/search?${query({ workspaceId, q })}`)

const titles = async (q: string) => {
  const response = await search(q)
  expect(response.status).toBe(200)
  return response.json().hits.map((h: { title: string }) => h.title)
}

describe('GET /api/search', () => {
  it('finds titles and block text (normalised Markdown, prefixes, umlauts)', async () => {
    const doc = randomUUID()
    const other = randomUUID()
    await push(
      alice,
      page(doc, 'Reiseplanung'),
      block(randomUUID(), doc, 'Wir fahren **über** die Alpen'),
      page(other, 'Küche'),
      block(randomUUID(), other, 'const rezept = "Kuchen"', 'code'),
    )
    expect(await titles('reise')).toEqual(['Reiseplanung'])
    expect(await titles('uber alpen')).toEqual(['Reiseplanung'])
    expect(await titles('kuche')).toEqual(['Küche'])
    expect(await titles('rezept')).toEqual(['Küche'])
    const [hit] = (await search('alpen')).json().hits
    expect(hit.documentId).toBe(doc)
    expect(hit.snippet).toContain('Wir fahren über die Alpen')
    expect(hit.snippet).not.toContain('**')
  })

  it('follows edits and drops deleted blocks and pages', async () => {
    const doc = randomUUID()
    const b = randomUUID()
    await push(alice, page(doc, 'Notizen'), block(b, doc, 'alter Inhalt'))
    await push(alice, op(alice, 'block', 'update', b, { content: 'neuer Inhalt' }, 1))
    expect(await titles('alter')).toEqual([])
    expect(await titles('neuer')).toEqual(['Notizen'])
    await push(alice, op(alice, 'block', 'delete', b, {}, 2))
    expect(await titles('neuer')).toEqual([])
    await push(alice, op(alice, 'document', 'update', doc, { title: 'Umbenannt' }, 1))
    expect(await titles('umbenannt')).toEqual(['Umbenannt'])
    await push(alice, op(alice, 'document', 'delete', doc, {}, 2))
    expect(await titles('umbenannt')).toEqual([])
  })

  it('#99: indexes every block of a large batch', async () => {
    const doc = randomUUID()
    const ops: Operation[] = [page(doc, 'Lang')]
    for (let i = 0; i < 300; i++) {
      ops.push(
        op(alice, 'block', 'create', randomUUID(), {
          ...blockPayload(doc, `zeile${i}`),
          sortKey: `a${i}`,
        }),
      )
    }
    await push(alice, ...ops)
    expect(await titles('zeile0')).toEqual(['Lang'])
    expect(await titles('zeile299')).toEqual(['Lang'])
  })

  it('never returns hits from foreign workspaces', async () => {
    await push(alice, page(randomUUID(), 'Geheim'))
    const bob = await signUp({ name: 'bob' })
    await push(bob, page(randomUUID(), 'Bobs Seite', bob))
    const foreign = await search('geheim', alice.workspaceId, bob.client)
    expect(foreign.status).toBe(404)
    expect(foreign.json().error.code).toBe('not_found')
    expect((await search('geheim', bob.workspaceId, bob.client)).json().hits).toEqual([])
    expect((await search('bobs', bob.workspaceId, bob.client)).json().hits).toHaveLength(1)
  })

  it('treats FTS syntax in the input as plain words and validates the query', async () => {
    await push(alice, page(randomUUID(), 'Alpha Beta'))
    expect((await search('"alpha" OR title:x NEAR(')).status).toBe(200)
    expect((await search('  -- ')).json()).toEqual({ hits: [] })
    const empty = await search('')
    expect(empty.status).toBe(400)
    expect(empty.json().error.code).toBe('invalid_input')
    expect((await search('x'.repeat(201))).status).toBe(400)
    expect((await search('alpha', 'nope')).status).toBe(400)
    expect((await search('alpha', alice.workspaceId, alice.client.fork())).status).toBe(401)
  })
})
