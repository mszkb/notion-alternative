import { describe, expect, it } from 'vitest'
import { blockSchema, documentSchema, operationSchema } from './content'
import { isUuid, newId } from './ids'
import { compareBySortKey, sortKeyBetween } from './sort-key'

describe('newId', () => {
  it('creates v4 UUIDs, also without crypto.randomUUID', () => {
    const original = crypto.randomUUID
    try {
      Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true })
      const id = newId()
      expect(isUuid(id)).toBe(true)
      expect(id[14]).toBe('4')
      expect(['8', '9', 'a', 'b']).toContain(id[19])
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true })
    }
    expect(isUuid(newId())).toBe(true)
  })
})

describe('sort keys', () => {
  it('inserts between neighbours and sorts by plain string order', () => {
    const a = sortKeyBetween(null, null)
    const c = sortKeyBetween(a, null)
    const b = sortKeyBetween(a, c)
    const items = [c, a, b].map((sortKey, index) => ({ sortKey, id: String(index) }))
    expect(items.sort(compareBySortKey).map((item) => item.sortKey)).toEqual([a, b, c])
  })

  it('breaks ties by id and survives equal neighbours', () => {
    const key = sortKeyBetween(null, null)
    expect(compareBySortKey({ sortKey: key, id: 'a' }, { sortKey: key, id: 'b' })).toBe(-1)
    expect(sortKeyBetween(key, key) > key).toBe(true)
  })
})

describe('schemas', () => {
  const now = new Date().toISOString()

  it('accepts a local document and block', () => {
    const document = documentSchema.parse({
      id: newId(),
      workspaceId: newId(),
      parentId: null,
      title: 'Start',
      sortKey: 'a0',
      favorite: false,
      createdAt: now,
      updatedAt: now,
      revision: null,
      deletedAt: null,
    })
    expect(
      blockSchema.safeParse({
        id: newId(),
        documentId: document.id,
        type: 'heading',
        content: 'Hallo',
        attrs: { level: 2 },
        sortKey: 'a0',
        revision: null,
        deletedAt: null,
      }).success,
    ).toBe(true)
  })

  it('rejects unknown block attrs and operation kinds', () => {
    expect(
      blockSchema.safeParse({
        id: newId(),
        documentId: newId(),
        type: 'paragraph',
        content: '',
        attrs: { color: 'red' },
        sortKey: 'a0',
        revision: null,
        deletedAt: null,
      }).success,
    ).toBe(false)
    expect(
      operationSchema.safeParse({
        opId: newId(),
        deviceId: newId(),
        workspaceId: newId(),
        entity: 'block',
        entityId: newId(),
        kind: 'replace',
        baseRevision: null,
        payload: {},
        createdAt: now,
      }).success,
    ).toBe(false)
  })
})
