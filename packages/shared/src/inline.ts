import { isUuid } from './ids'

/**
 * Markdown-inline subset used for `Block.content` (ADR 0008):
 * `**bold**`, `_italic_` (`*italic*` is read too), `` `code` ``, `[text](https://…)` and page links `[title](page:<uuid>)`.
 * Anything that does not form valid syntax stays literal text, so parsing never drops content.
 */
export type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'bold'; children: InlineNode[] }
  | { type: 'italic'; children: InlineNode[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: InlineNode[] }
  | { type: 'page'; documentId: string; title: string }

export const PAGE_LINK_PREFIX = 'page:'

const ALLOWED_LINK_PROTOCOLS = ['http:', 'https:', 'mailto:']

/** Only http(s) and mailto links are rendered as links; everything else stays text (no `javascript:`). */
export function isSafeHref(href: string): boolean {
  try {
    return ALLOWED_LINK_PROTOCOLS.includes(new URL(href).protocol)
  } catch {
    return false
  }
}

const ESCAPABLE = new Set(['\\', '*', '_', '`', '[', ']'])

export function parseInline(source: string): InlineNode[] {
  return normalize(parseRange(source, 0, source.length, true))
}

function parseRange(src: string, start: number, end: number, allowLinks: boolean): InlineNode[] {
  const nodes: InlineNode[] = []
  let text = ''
  const flush = () => {
    if (text) nodes.push({ type: 'text', text })
    text = ''
  }
  let i = start
  while (i < end) {
    const ch = src[i]!
    if (ch === '\\' && i + 1 < end && ESCAPABLE.has(src[i + 1]!)) {
      text += src[i + 1]
      i += 2
      continue
    }
    if (ch === '`') {
      const close = src.indexOf('`', i + 1)
      if (close !== -1 && close < end && close > i + 1) {
        flush()
        nodes.push({ type: 'code', text: src.slice(i + 1, close) })
        i = close + 1
        continue
      }
    }
    if (ch === '*' && src[i + 1] === '*') {
      const close = findClosing(src, i + 2, end, '**')
      if (close !== -1 && close > i + 2 && flanking(src, i + 2, close)) {
        flush()
        nodes.push({ type: 'bold', children: parseRange(src, i + 2, close, allowLinks) })
        i = close + 2
        continue
      }
    } else if (ch === '*' || ch === '_') {
      const close = findClosing(src, i + 1, end, ch)
      if (close !== -1 && close > i + 1 && flanking(src, i + 1, close)) {
        flush()
        nodes.push({ type: 'italic', children: parseRange(src, i + 1, close, allowLinks) })
        i = close + 1
        continue
      }
    }
    if (ch === '[' && allowLinks) {
      const link = parseLink(src, i, end)
      if (link) {
        flush()
        nodes.push(link.node)
        i = link.next
        continue
      }
    }
    text += ch
    i += 1
  }
  flush()
  return nodes
}

/** Emphasis must not start or end with whitespace (`2 * 3 * 4` stays text). */
function flanking(src: string, contentStart: number, contentEnd: number): boolean {
  return !/\s/.test(src[contentStart]!) && !/\s/.test(src[contentEnd - 1]!)
}

/** Finds the closing delimiter, skipping escapes, code spans and (for `*`) bold markers. */
function findClosing(src: string, from: number, end: number, delim: '*' | '**' | '_'): number {
  let i = from
  while (i < end) {
    const ch = src[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '`') {
      const close = src.indexOf('`', i + 1)
      if (close !== -1 && close < end) {
        i = close + 1
        continue
      }
    }
    if (delim === '_' && ch === '_') return i
    if (ch === '*' && delim !== '_') {
      const double = src[i + 1] === '*'
      if (delim === '**' && double) return i
      if (delim === '*' && !double) return i
      if (delim === '*' && double) {
        // Skip a nested bold span as a unit.
        const close = findClosing(src, i + 2, end, '**')
        i = close === -1 ? i + 2 : close + 2
        continue
      }
    }
    i += 1
  }
  return -1
}

function parseLink(
  src: string,
  start: number,
  end: number,
): { node: InlineNode; next: number } | null {
  // Find the matching `]` (no nested brackets), then `(href)`.
  let i = start + 1
  while (i < end && src[i] !== ']') {
    if (src[i] === '\\') i += 1
    else if (src[i] === '[') return null
    i += 1
  }
  if (i >= end || src[i + 1] !== '(') return null
  const textEnd = i
  const hrefStart = i + 2
  const hrefEnd = src.indexOf(')', hrefStart)
  if (hrefEnd === -1 || hrefEnd >= end) return null
  const href = src.slice(hrefStart, hrefEnd)
  if (/\s/.test(href)) return null
  const next = hrefEnd + 1
  if (href.startsWith(PAGE_LINK_PREFIX)) {
    const documentId = href.slice(PAGE_LINK_PREFIX.length)
    if (!isUuid(documentId)) return null
    return {
      node: { type: 'page', documentId, title: unescape(src.slice(start + 1, textEnd)) },
      next,
    }
  }
  if (!isSafeHref(href)) return null
  return {
    node: { type: 'link', href, children: parseRange(src, start + 1, textEnd, false) },
    next,
  }
}

function unescape(value: string): string {
  return value.replace(/\\([\\*_`[\]])/g, '$1')
}

function escapeText(value: string): string {
  return value.replace(/[\\*_`[\]]/g, '\\$&')
}

/** Merges adjacent text nodes and drops empty ones. */
export function normalize(nodes: InlineNode[]): InlineNode[] {
  const result: InlineNode[] = []
  for (const node of nodes) {
    if (node.type === 'text') {
      if (!node.text) continue
      const last = result[result.length - 1]
      if (last?.type === 'text') {
        result[result.length - 1] = { type: 'text', text: last.text + node.text }
        continue
      }
      result.push(node)
    } else if (node.type === 'bold' || node.type === 'italic') {
      // <b> inside <b> adds nothing; adjacent spans of the same kind merge.
      const children = normalize(
        node.children.flatMap((child) => (child.type === node.type ? child.children : [child])),
      )
      if (children.length === 0) continue
      const last = result[result.length - 1]
      if (last?.type === node.type) {
        result[result.length - 1] = {
          type: node.type,
          children: normalize([...last.children, ...children]),
        }
        continue
      }
      result.push({ type: node.type, children })
    } else if (node.type === 'link') {
      const children = normalize(node.children)
      if (children.length === 0) continue
      result.push({ ...node, children })
    } else if (node.type === 'code') {
      if (node.text) result.push(node)
    } else {
      result.push(node)
    }
  }
  return result
}

export function serializeInline(nodes: InlineNode[]): string {
  return normalize(nodes).map(serializeNode).join('')
}

function serializeNode(node: InlineNode): string {
  switch (node.type) {
    case 'text':
      return escapeText(node.text)
    case 'bold':
      return emphasis(node.children, '**')
    case 'italic':
      // `_` instead of `*` keeps bold+italic unambiguous (`**a _b_**` rather than `**a *b***`).
      return emphasis(node.children, '_')
    case 'code':
      // Backticks cannot be represented inside a code span; fall back to escaped plain text.
      return node.text.includes('`') ? escapeText(node.text) : `\`${node.text}\``
    case 'link':
      return `[${serializeInline(node.children)}](${node.href})`
    case 'page':
      return `[${escapeText(node.title)}](${PAGE_LINK_PREFIX}${node.documentId})`
  }
}

/** Emphasis cannot start or end with whitespace; move it outside the markers. */
function emphasis(children: InlineNode[], marker: string): string {
  const inner = serializeInline(children)
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!
  const [, lead, middle, trail] = match
  return middle ? `${lead}${marker}${middle}${marker}${trail}` : inner
}

/** Visible text without markup, e.g. for search and previews. */
export function inlineToPlainText(source: string): string {
  return nodesToPlainText(parseInline(source))
}

function nodesToPlainText(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
        case 'code':
          return node.text
        case 'page':
          return node.title
        default:
          return nodesToPlainText(node.children)
      }
    })
    .join('')
}

/** Ids of all documents linked from the content (deduplicated, in order of appearance). */
export function extractPageLinks(source: string): string[] {
  const ids: string[] = []
  const visit = (nodes: InlineNode[]) => {
    for (const node of nodes) {
      if (node.type === 'page') {
        if (!ids.includes(node.documentId)) ids.push(node.documentId)
      } else if (node.type === 'bold' || node.type === 'italic' || node.type === 'link') {
        visit(node.children)
      }
    }
  }
  visit(parseInline(source))
  return ids
}
