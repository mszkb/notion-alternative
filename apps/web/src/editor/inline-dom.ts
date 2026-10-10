import {
  type InlineNode,
  isSafeHref,
  isUuid,
  normalize,
  parseInline,
  serializeInline,
} from '@notion-alt/shared'

/** Current title of a linked page, or undefined if it does not exist (anymore). */
export type PageResolver = (documentId: string) => { title: string } | undefined

export interface RenderOptions {
  resolvePage: PageResolver
  pageHref: (documentId: string) => string
  /** Page links as plain text without a target (read links for guests, ADR 0022). */
  plainPageLinks?: boolean
}

/**
 * Renders Markdown-inline content into a contenteditable element. Only text nodes and a fixed set
 * of elements are created (no innerHTML), so content can never inject markup.
 */
export function renderInline(el: HTMLElement, content: string, options: RenderOptions): void {
  const doc = el.ownerDocument
  el.replaceChildren(...nodesToDom(doc, parseInline(content), options))
  // A trailing line break only shows (and keeps the caret) with an extra <br>.
  if (content.endsWith('\n')) el.append(doc.createElement('br'))
}

function nodesToDom(doc: Document, nodes: InlineNode[], options: RenderOptions): Node[] {
  return nodes.map((node) => {
    switch (node.type) {
      case 'text':
        return doc.createTextNode(node.text)
      case 'bold':
      case 'italic': {
        const el = doc.createElement(node.type === 'bold' ? 'strong' : 'em')
        el.append(...nodesToDom(doc, node.children, options))
        return el
      }
      case 'code': {
        const el = doc.createElement('code')
        el.textContent = node.text
        return el
      }
      case 'link': {
        const el = doc.createElement('a')
        el.href = node.href
        el.rel = 'noopener noreferrer'
        el.target = '_blank'
        el.append(...nodesToDom(doc, node.children, options))
        return el
      }
      case 'page': {
        if (options.plainPageLinks) {
          const span = doc.createElement('span')
          span.className = 'page-link-text'
          span.textContent = node.title || 'Seite'
          return span
        }
        const el = doc.createElement('a')
        const target = options.resolvePage(node.documentId)
        el.className = target ? 'page-link' : 'page-link broken'
        el.dataset.pageId = node.documentId
        el.href = options.pageHref(node.documentId)
        // Page links are atomic tokens; the caret moves around them, Backspace removes them.
        el.contentEditable = 'false'
        el.textContent = target ? target.title || 'Unbenannt' : node.title || 'Gelöschte Seite'
        return el
      }
    }
  })
}

/** Reads a contenteditable element (or fragment) back into inline nodes. */
export function domToInline(root: Node): InlineNode[] {
  return normalize(childrenToInline(root, true))
}

export function serializeDom(root: Node): string {
  return serializeInline(domToInline(root))
}

function childrenToInline(parent: Node, isRoot: boolean): InlineNode[] {
  const result: InlineNode[] = []
  const children = Array.from(parent.childNodes)
  children.forEach((child, index) => {
    const isLast = index === children.length - 1
    result.push(...nodeToInline(child, isRoot && isLast, result.length > 0))
  })
  return result
}

function nodeToInline(node: Node, isLastOfRoot: boolean, hasPrevious: boolean): InlineNode[] {
  if (node.nodeType === 3) {
    return [{ type: 'text', text: (node.textContent ?? '').replace(/\u00a0/g, ' ') }]
  }
  if (node.nodeType !== 1) return []
  const el = node as HTMLElement
  switch (el.tagName) {
    case 'BR':
      // The trailing <br> is the browser's placeholder for the last line, not content.
      return isLastOfRoot ? [] : [{ type: 'text', text: '\n' }]
    case 'STRONG':
    case 'B':
      return [{ type: 'bold', children: childrenToInline(el, false) }]
    case 'EM':
    case 'I':
      return [{ type: 'italic', children: childrenToInline(el, false) }]
    case 'CODE':
      return [{ type: 'code', text: el.textContent ?? '' }]
    case 'A': {
      const pageId = el.dataset.pageId
      if (pageId && isUuid(pageId)) {
        return [{ type: 'page', documentId: pageId, title: el.textContent ?? '' }]
      }
      const href = el.getAttribute('href') ?? ''
      const children = childrenToInline(el, false)
      return isSafeHref(href) ? [{ type: 'link', href, children }] : children
    }
    case 'DIV':
    case 'P': {
      // Pasted or browser-generated paragraphs become line breaks inside the block.
      const children = childrenToInline(el, false)
      return hasPrevious ? [{ type: 'text', text: '\n' }, ...children] : children
    }
    default:
      return childrenToInline(el, false)
  }
}
