import { describe, expect, it } from 'vitest'
import type { BlockState } from '../local/store'
import { EditHistory } from './history'

const s = (...contents: string[]): BlockState[] =>
  contents.map((content, i) => ({ id: `b${i}`, type: 'paragraph', content, attrs: {} }))

describe('EditHistory', () => {
  it('undoes and redoes in order', () => {
    const history = new EditHistory()
    history.record(s('a'))
    history.record(s('ab'))
    expect(history.undo(s('abc'))).toEqual(s('ab'))
    expect(history.undo(s('ab'))).toEqual(s('a'))
    expect(history.undo(s('a'))).toBeNull()
    expect(history.redo(s('a'))).toEqual(s('ab'))
    expect(history.redo(s('ab'))).toEqual(s('abc'))
    expect(history.redo(s('abc'))).toBeNull()
  })

  it('skips snapshots that equal the current state and dedupes records', () => {
    const history = new EditHistory()
    history.record(s('a'))
    history.record(s('a'))
    history.record(s('a', 'b'))
    // Nothing changed after the last record.
    expect(history.undo(s('a', 'b'))).toEqual(s('a'))
    expect(history.undo(s('a'))).toBeNull()
  })

  it('drops redo on a new change and respects the limit', () => {
    const history = new EditHistory(2)
    history.record(s('1'))
    history.record(s('2'))
    history.record(s('3'))
    expect(history.undo(s('4'))).toEqual(s('3'))
    history.record(s('3x'))
    expect(history.canRedo).toBe(false)
    expect(history.undo(s('5'))).toEqual(s('3x'))
    expect(history.undo(s('3x'))).toEqual(s('2'))
    expect(history.undo(s('2'))).toBeNull()
  })

  it('follows recreated blocks to their new id', () => {
    const history = new EditHistory()
    history.record(s('a', 'b'))
    history.rename(new Map([['b1', 'new']]))
    expect(history.undo(s('a'))![1]!.id).toBe('new')
  })
})
