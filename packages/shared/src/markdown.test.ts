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

  it('writes to-dos, toggles with their children, callouts and dividers (ADR 0019)', () => {
    const md = blocksToMarkdown([
      { type: 'todo', content: 'offen', attrs: {} },
      { type: 'todo', content: 'erledigt', attrs: { checked: true } },
      { type: 'toggle', content: 'Mehr', attrs: {} },
      { type: 'paragraph', content: 'Kind', attrs: { indent: 1 } },
      { type: 'todo', content: 'Kind-Aufgabe', attrs: { indent: 1 } },
      { type: 'callout', content: 'Achtung\nzweite Zeile', attrs: { icon: '⚠️' } },
      { type: 'divider', content: '', attrs: {} },
      { type: 'callout', content: 'Tipp', attrs: {} },
    ])
    expect(md).toBe(
      [
        '- [ ] offen\n- [x] erledigt\n- Mehr',
        '  Kind',
        '  - [ ] Kind-Aufgabe',
        '> ⚠️ Achtung\n> zweite Zeile',
        '---',
        '> 💡 Tipp',
      ].join('\n\n'),
    )
  })

  it('keeps numbering an outer list across nested to-dos and toggle children', () => {
    const md = blocksToMarkdown([
      { type: 'list_item', content: 'A', attrs: { list: 'ordered', indent: 0 } },
      { type: 'todo', content: 'x', attrs: { indent: 1 } },
      { type: 'list_item', content: 'B', attrs: { list: 'ordered', indent: 0 } },
    ])
    expect(md).toBe('1. A\n  - [ ] x\n2. B')
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
