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

  it('reuses the objects of unchanged documents only', () => {
    const before = [doc('a', null), doc('b', null)]
    const after = reuseUnchanged(before, [doc('a', null), doc('b', null, 'neu'), doc('c', null)])
    expect(after[0]).toBe(before[0])
    expect(after[1]).not.toBe(before[1])
    expect(after[1]!.title).toBe('neu')
    expect(after.map((d) => d.id)).toEqual(['a', 'b', 'c'])
  })
})
