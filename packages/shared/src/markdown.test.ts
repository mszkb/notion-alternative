import { describe, expect, it } from 'vitest'
import { blocksToMarkdown } from './markdown'

describe('blocksToMarkdown', () => {
  it('serialises every block type', () => {
    expect(
      blocksToMarkdown([
        { type: 'heading', content: 'Titel', attrs: { level: 2 } },
        { type: 'paragraph', content: 'Text mit **fett** und [Link](page:abc)', attrs: {} },
        { type: 'list_item', content: 'a', attrs: { list: 'bullet', indent: 0 } },
        { type: 'list_item', content: 'b', attrs: { list: 'bullet', indent: 1 } },
        { type: 'quote', content: 'zwei\nZeilen', attrs: {} },
        { type: 'code', content: 'const x = 1', attrs: { language: 'ts' } },
      ]),
    ).toBe(
      [
        '## Titel',
        '',
        'Text mit **fett** und [Link](page:abc)',
        '',
        '- a',
        '  - b',
        '',
        '> zwei\n> Zeilen',
        '',
        '```ts\nconst x = 1\n```',
      ].join('\n'),
    )
  })

  it('numbers ordered lists per level and restarts after other blocks', () => {
    const item = (content: string, indent = 0) => ({
      type: 'list_item' as const,
      content,
      attrs: { list: 'ordered' as const, indent },
    })
    expect(
      blocksToMarkdown([
        item('a'),
        item('a1', 1),
        item('b'),
        { type: 'paragraph', content: 'x', attrs: {} },
        item('c'),
      ]),
    ).toBe('1. a\n  1. a1\n2. b\n\nx\n\n1. c')
  })

  it('uses a fence longer than any backtick run in code', () => {
    expect(blocksToMarkdown([{ type: 'code', content: 'a ``` b', attrs: {} }])).toBe(
      '````\na ``` b\n````',
    )
  })
})
