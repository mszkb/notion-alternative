import { isSafeHref } from '@notion-alt/shared'

/**
 * Inline Markdown typed in a block turns into formatting once it is closed, as in Notion (#194):
 * `**bold**`, `*italic*` or `_italic_`, `` `code` `` and `[text](https://…)`. Stored content
 * stays Markdown-inline (ADR 0008); only the editing DOM changes.
 */
export interface InlineShortcut {
  kind: 'bold' | 'italic' | 'code' | 'link'
  /** Index in the text where the markup starts (the opening marker). */
  start: number
  /** Visible text of the new element. */
  text: string
  href?: string
}

/** Characters that can close a shortcut; other input never converts. */
export const CLOSING_CHARACTERS = new Set(['*', '_', '`', ')'])

// The opening marker must not follow a letter, digit or backslash: `2*3*4`, `snake_case_name`
// and escaped markers (`\*`) stay text. Emphasis cannot start or end with whitespace.
const BEFORE = String.raw`(^|[^\p{L}\p{N}\\*_])`
const PATTERNS: [InlineShortcut['kind'], RegExp][] = [
  ['bold', new RegExp(String.raw`${BEFORE}\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$`, 'u')],
  ['italic', new RegExp(String.raw`${BEFORE}\*([^*\s](?:[^*]*[^*\s])?)\*$`, 'u')],
  ['italic', new RegExp(String.raw`${BEFORE}_([^_\s](?:[^_]*[^_\s])?)_$`, 'u')],
  ['code', new RegExp(String.raw`(^|[^\\\x60])\x60([^\x60]+)\x60$`, 'u')],
]
const LINK = /(^|[^\\])\[([^[\]]+)\]\(([^()\s]+)\)$/u

/** A closing marker right after an odd number of backslashes is escaped (`*foo\*`). */
function escapesClosing(inner: string): boolean {
  const backslashes = /\\*$/.exec(inner)![0].length
  return backslashes % 2 === 1
}

/** The shortcut closed at the end of `before` (the text before the caret), or null. */
export function matchInlineShortcut(before: string): InlineShortcut | null {
  const last = before[before.length - 1]
  if (!last || !CLOSING_CHARACTERS.has(last)) return null
  if (last === ')') {
    const match = LINK.exec(before)
    if (!match || escapesClosing(match[2]!) || !isSafeHref(match[3]!)) return null
    return {
      kind: 'link',
      start: match.index + match[1]!.length,
      text: match[2]!,
      href: match[3]!,
    }
  }
  for (const [kind, pattern] of PATTERNS) {
    const match = pattern.exec(before)
    if (match && !escapesClosing(match[2]!)) {
      return { kind, start: match.index + match[1]!.length, text: match[2]! }
    }
  }
  return null
}
