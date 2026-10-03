import { describe, expect, it } from 'vitest'
import { diffBlocks } from './version-diff'

const b = (id: string, content: string, type: 'paragraph' | 'code' = 'paragraph') => ({
  id,
  type,
  content,
  attrs: {},
})

describe('diffBlocks', () => {
  it('marks changed, removed and added blocks in reading order', () => {
    const version = [b('1', 'Titel **alt**'), b('2', 'weg'), b('3', 'gleich')]
    const current = [b('1', 'Titel neu'), b('3', 'gleich'), b('4', 'neu dazu')]
    expect(diffBlocks(version, current)).toEqual([
      { id: '1', status: 'changed', before: 'Titel alt', after: 'Titel neu' },
      { id: '2', status: 'removed', before: 'weg', after: '' },
      { id: '3', status: 'same', before: 'gleich', after: 'gleich' },
      { id: '4', status: 'added', before: '', after: 'neu dazu' },
    ])
  })

  it('puts blocks added at the start first', () => {
    expect(diffBlocks([b('1', 'a')], [b('0', 'vorne'), b('1', 'a')]).map((d) => d.id)).toEqual([
      '0',
      '1',
    ])
  })
})
