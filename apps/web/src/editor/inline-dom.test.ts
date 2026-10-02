// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { getCaretOffset, setCaretOffset, textLength } from './caret'
import { renderInline, serializeDom } from './inline-dom'

const PAGE = '3f2b8c1e-7d4a-4b6e-9c0f-1a2b3c4d5e6f'
const titles: Record<string, string> = { [PAGE]: 'Aktueller Titel' }
const options = {
  resolvePage: (id: string) => (titles[id] !== undefined ? { title: titles[id]! } : undefined),
  pageHref: (id: string) => `/w/ws/p/${id}`,
}

function element(): HTMLElement {
  const el = document.createElement('div')
  el.contentEditable = 'true'
  document.body.append(el)
  return el
}

describe('renderInline / serializeDom', () => {
  it('round-trips formatted content', () => {
    const el = element()
    const content = 'a **b _c_** `d` [e](https://example.org/) \\*literal\\*'
    renderInline(el, content, options)
    expect(el.querySelector('strong em')?.textContent).toBe('c')
    expect(el.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer')
    expect(serializeDom(el)).toBe(content)
  })

  it('shows the current title of linked pages and stores it on save', () => {
    const el = element()
    renderInline(el, `see [Old](page:${PAGE})`, options)
    const link = el.querySelector('a.page-link') as HTMLAnchorElement
    expect(link.textContent).toBe('Aktueller Titel')
    expect(link.getAttribute('href')).toBe(`/w/ws/p/${PAGE}`)
    expect(link.contentEditable).toBe('false')
    expect(serializeDom(el)).toBe(`see [Aktueller Titel](page:${PAGE})`)
  })

  it('marks links to missing pages', () => {
    const el = element()
    renderInline(el, `[Weg](page:9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d)`, options)
    expect(el.querySelector('a')?.className).toBe('page-link broken')
    expect(el.textContent).toBe('Weg')
  })

  it('never creates elements from text that looks like HTML', () => {
    const el = element()
    renderInline(el, '<img src=x onerror=alert(1)>', options)
    expect(el.querySelector('img')).toBeNull()
    expect(serializeDom(el)).toBe('<img src=x onerror=alert(1)>')
  })

  it('reads browser markup: b/i, line breaks, divs, unsafe links and nbsp', () => {
    const el = element()
    el.innerHTML =
      '<b>x</b><i>y</i>a\u00a0b<br>c<div>d</div><a href="javascript:alert(1)">z</a><span style="color:red">s</span><br>'
    expect(serializeDom(el)).toBe('**x**_y_a b\nc\ndzs')
  })

  it('keeps a trailing line break', () => {
    const el = element()
    renderInline(el, 'line\n', options)
    expect(serializeDom(el)).toBe('line\n')
  })
})

describe('caret helpers', () => {
  it('measures and places the caret across formatting', () => {
    const el = element()
    renderInline(el, 'ab **cd** ef', options)
    expect(textLength(el)).toBe(8)
    setCaretOffset(el, 3)
    expect(getCaretOffset(el)).toBe(3)
    setCaretOffset(el, 100)
    expect(getCaretOffset(el)).toBe(8)
  })
})
