import { describe, expect, it } from 'vitest'
import { matchInlineShortcut } from './inline-shortcuts'

describe('inline Markdown while typing (#194)', () => {
  it('recognises the four shortcuts when they are closed', () => {
    expect(matchInlineShortcut('Das ist **fett**')).toEqual({
      kind: 'bold',
      start: 8,
      text: 'fett',
    })
    expect(matchInlineShortcut('ganz *schräg*')).toEqual({
      kind: 'italic',
      start: 5,
      text: 'schräg',
    })
    expect(matchInlineShortcut('_kursiv_')).toEqual({ kind: 'italic', start: 0, text: 'kursiv' })
    expect(matchInlineShortcut('Aufruf `npm test`')).toEqual({
      kind: 'code',
      start: 7,
      text: 'npm test',
    })
    expect(matchInlineShortcut('Siehe [Doku](https://example.com/a?b=1)')).toEqual({
      kind: 'link',
      start: 6,
      text: 'Doku',
      href: 'https://example.com/a?b=1',
    })
  })

  it('waits until the closing marker is complete', () => {
    expect(matchInlineShortcut('**fett*')).toBeNull()
    expect(matchInlineShortcut('**fett')).toBeNull()
    expect(matchInlineShortcut('`code')).toBeNull()
    expect(matchInlineShortcut('[Doku](https://example.com')).toBeNull()
    expect(matchInlineShortcut('fett**')).toBeNull()
  })

  it('leaves text alone that only looks like markup', () => {
    // Inside words, arithmetic, identifiers and whitespace at the edges.
    expect(matchInlineShortcut('2*3*')).toBeNull()
    expect(matchInlineShortcut('snake_case_')).toBeNull()
    expect(matchInlineShortcut('a * b *')).toBeNull()
    expect(matchInlineShortcut('** fett**')).toBeNull()
    expect(matchInlineShortcut('``')).toBeNull()
    expect(matchInlineShortcut('```')).toBeNull()
  })

  it('keeps escaped markers', () => {
    expect(matchInlineShortcut('\\*\\*nicht\\*\\*')).toBeNull()
    expect(matchInlineShortcut('\\*nicht*')).toBeNull()
    expect(matchInlineShortcut('\\_nicht_')).toBeNull()
    expect(matchInlineShortcut('\\`nicht`')).toBeNull()
    expect(matchInlineShortcut('\\[nicht](https://example.com)')).toBeNull()
    // Escaped closing markers, too; an escaped backslash before it does not escape it.
    expect(matchInlineShortcut('*foo\\*')).toBeNull()
    expect(matchInlineShortcut('**foo\\**')).toBeNull()
    expect(matchInlineShortcut('_foo\\_')).toBeNull()
    expect(matchInlineShortcut('`foo\\`')).toBeNull()
    expect(matchInlineShortcut('[foo\\](https://example.com)')).toBeNull()
    expect(matchInlineShortcut('*foo\\\\*')).toEqual({ kind: 'italic', start: 0, text: 'foo\\\\' })
  })

  it('only links safe targets', () => {
    expect(matchInlineShortcut('[x](javascript:alert(1))')).toBeNull()
    expect(matchInlineShortcut('[x](javascript:void)')).toBeNull()
    expect(matchInlineShortcut('[x](relative/path)')).toBeNull()
    expect(matchInlineShortcut('[Mail](mailto:a@example.com)')?.kind).toBe('link')
  })

  it('ignores input that cannot close a shortcut', () => {
    expect(matchInlineShortcut('**fett** ')).toBeNull()
    expect(matchInlineShortcut('')).toBeNull()
  })
})
