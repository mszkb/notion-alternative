import type { Document } from '@notion-alt/shared'
import { describe, expect, it } from 'vitest'
import { groupByParent, reuseUnchanged } from './workspace'

const doc = (id: string, parentId: string | null, title = id): Document => ({
  id,
  workspaceId: 'w',
  parentId,
  title,
  sortKey: id,
  favorite: false,
  createdAt: 'x',
  updatedAt: 'x',
  revision: 1,
  deletedAt: null,
})

describe('page tree helpers (#102)', () => {
  it('groups children by parent and keeps the order', () => {
    const groups = groupByParent([doc('a', null), doc('b', 'a'), doc('c', null), doc('d', 'a')])
    expect(groups.get(null)!.map((d) => d.id)).toEqual(['a', 'c'])
    expect(groups.get('a')!.map((d) => d.id)).toEqual(['b', 'd'])
    expect(groups.get('c')).toBeUndefined()
  })

  it('keeps the arrays of groups whose documents did not change', () => {
    const a = doc('a', null)
    const b = doc('b', 'a')
    const c = doc('c', 'x')
    const first = groupByParent([a, b, c])
    const next = groupByParent([a, b, doc('c', 'x', 'neu')], first)
    expect(next.get(null)).toBe(first.get(null))
    expect(next.get('a')).toBe(first.get('a'))
    expect(next.get('x')).not.toBe(first.get('x'))
  })

  it('reuses the objects of unchanged documents only', () => {
    const before = [doc('a', null), doc('b', null)]
    const after = reuseUnchanged(before, [doc('a', null), doc('b', null, 'neu'), doc('c', null)])
    expect(after[0]).toBe(before[0])
    expect(after[1]).not.toBe(before[1])
    expect(after[1]!.title).toBe('neu')
    expect(after.map((d) => d.id)).toEqual(['a', 'b', 'c'])
    // Any field counts, also ones added to the schema later.
    const extended = { ...before[0]!, icon: '📄' } as Document
    expect(reuseUnchanged(before, [extended])[0]).toBe(extended)
  })
})
