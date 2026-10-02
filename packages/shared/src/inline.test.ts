import { describe, expect, it } from 'vitest'
import {
  extractPageLinks,
  inlineToPlainText,
  type InlineNode,
  parseInline,
  serializeInline,
} from './inline'

const PAGE = '3f2b8c1e-7d4a-4b6e-9c0f-1a2b3c4d5e6f'
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'

describe('parseInline', () => {
  it('parses formatting, links and page links', () => {
    expect(parseInline(`a **b** *c* \`d\` [e](https://x.test/) [Seite](page:${PAGE})`)).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'bold', children: [{ type: 'text', text: 'b' }] },
      { type: 'text', text: ' ' },
      { type: 'italic', children: [{ type: 'text', text: 'c' }] },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'd' },
      { type: 'text', text: ' ' },
      { type: 'link', href: 'https://x.test/', children: [{ type: 'text', text: 'e' }] },
      { type: 'text', text: ' ' },
      { type: 'page', documentId: PAGE, title: 'Seite' },
    ])
  })

  it('nests italic inside bold and bold inside italic', () => {
    expect(parseInline('**a *b* c**')).toEqual([
      {
        type: 'bold',
        children: [
          { type: 'text', text: 'a ' },
          { type: 'italic', children: [{ type: 'text', text: 'b' }] },
          { type: 'text', text: ' c' },
        ],
      },
    ])
    expect(parseInline('*a **b** c*')[0]?.type).toBe('italic')
  })

  it('keeps unmatched or invalid syntax as literal text', () => {
    for (const source of [
      '**open',
      '*open',
      '`open',
      '[text](javascript:alert(1))',
      '[text](page:not-a-uuid)',
      '[text] (https://x.test)',
      '2 * 3 * 4',
      '****',
    ]) {
      expect(inlineToPlainText(source)).toBe(source)
    }
  })

  it('does not interpret markup inside code spans', () => {
    expect(parseInline('`**x**`')).toEqual([{ type: 'code', text: '**x**' }])
  })

  it('handles escapes', () => {
    expect(parseInline('\\*not italic\\* \\[x\\]')).toEqual([
      { type: 'text', text: '*not italic* [x]' },
    ])
  })
})

describe('serializeInline', () => {
  const cases: InlineNode[][] = [
    [{ type: 'text', text: 'literal *stars* and [brackets] and `ticks` and \\' }],
    [
      { type: 'bold', children: [{ type: 'text', text: 'b' }] },
      { type: 'text', text: ' ' },
      { type: 'page', documentId: PAGE, title: 'Titel mit [Klammern]' },
    ],
    [
      {
        type: 'link',
        href: 'https://example.org/a_b?c=d',
        children: [{ type: 'italic', children: [{ type: 'text', text: 'x' }] }],
      },
    ],
  ]

  it('writes italic with underscores and keeps bold+italic unambiguous', () => {
    const nodes: InlineNode[] = [
      {
        type: 'bold',
        children: [
          { type: 'text', text: 'b ' },
          { type: 'italic', children: [{ type: 'text', text: 'c' }] },
        ],
      },
    ]
    expect(serializeInline(nodes)).toBe('**b _c_**')
    expect(parseInline('**b _c_**')).toEqual(nodes)
    expect(parseInline('_x_')).toEqual(parseInline('*x*'))
    expect(serializeInline([{ type: 'text', text: 'snake_case' }])).toBe('snake\\_case')
  })

  it('moves edge whitespace out of emphasis and flattens nested spans', () => {
    const nodes: InlineNode[] = [
      { type: 'text', text: 'a' },
      { type: 'bold', children: [{ type: 'text', text: ' b ' }] },
      { type: 'text', text: 'c' },
    ]
    expect(serializeInline(nodes)).toBe('a **b** c')
    expect(
      serializeInline([
        { type: 'bold', children: [{ type: 'bold', children: [{ type: 'text', text: 'x' }] }] },
      ]),
    ).toBe('**x**')
    expect(serializeInline([{ type: 'italic', children: [{ type: 'text', text: '  ' }] }])).toBe(
      '  ',
    )
  })

  it('round-trips nodes through markdown', () => {
    for (const nodes of cases) {
      expect(parseInline(serializeInline(nodes))).toEqual(nodes)
    }
  })

  it('is stable for arbitrary input after one normalisation', () => {
    for (const source of [
      'a * b',
      '**x',
      'x\\',
      '[a](b)',
      'a `b` **c** *d*',
      '* x *',
      '***x***',
      '**a *b***',
      '_a_b_',
    ]) {
      const once = serializeInline(parseInline(source))
      expect(serializeInline(parseInline(once))).toBe(once)
      expect(inlineToPlainText(once)).toBe(inlineToPlainText(source))
    }
  })
})

describe('extractPageLinks', () => {
  it('returns distinct linked document ids including nested ones', () => {
    expect(
      extractPageLinks(`[A](page:${PAGE}) **[B](page:${OTHER})** [A again](page:${PAGE})`),
    ).toEqual([PAGE, OTHER])
  })

  it('ignores page links inside code spans', () => {
    expect(extractPageLinks(`\`[A](page:${PAGE})\``)).toEqual([])
  })
})
