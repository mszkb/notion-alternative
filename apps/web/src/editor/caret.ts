/**
 * Caret helpers for contenteditable blocks. Offsets count visible characters: text plus one per
 * <br> (except the trailing placeholder), matching the plain text of the block.
 */

function isTrailingBreak(node: Node, root: Node): boolean {
  return node.nodeName === 'BR' && node.parentNode === root && node === root.lastChild
}

function nodeLength(node: Node, root: Node): number {
  if (node.nodeType === 3) return node.textContent?.length ?? 0
  if (node.nodeName === 'BR') return isTrailingBreak(node, root) ? 0 : 1
  let length = 0
  for (const child of Array.from(node.childNodes)) length += nodeLength(child, root)
  return length
}

export function textLength(el: HTMLElement): number {
  return nodeLength(el, el)
}

function selectionRange(el: HTMLElement): Range | null {
  const selection = el.ownerDocument.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  return el.contains(range.startContainer) ? range : null
}

/** Offset of the caret (selection start) within the block, or null if the caret is elsewhere. */
export function getCaretOffset(el: HTMLElement): number | null {
  const range = selectionRange(el)
  if (!range) return null
  const before = el.ownerDocument.createRange()
  before.selectNodeContents(el)
  before.setEnd(range.startContainer, range.startOffset)
  const fragment = before.cloneContents()
  // Measured against el: a <br> before the caret is content; only el's own last <br> is the
  // placeholder.
  return Math.min(nodeLength(fragment, el), textLength(el))
}

export function hasCollapsedSelection(el: HTMLElement): boolean {
  return selectionRange(el)?.collapsed ?? false
}

export function isCaretAtStart(el: HTMLElement): boolean {
  return hasCollapsedSelection(el) && getCaretOffset(el) === 0
}

export function isCaretAtEnd(el: HTMLElement): boolean {
  return hasCollapsedSelection(el) && getCaretOffset(el) === textLength(el)
}

/** Places the caret at a character offset (clamped to the end). */
export function setCaretOffset(el: HTMLElement, offset: number): void {
  const doc = el.ownerDocument
  const range = doc.createRange()
  let remaining = Math.max(0, offset)

  const walk = (node: Node): boolean => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        const length = child.textContent?.length ?? 0
        if (remaining <= length) {
          range.setStart(child, remaining)
          return true
        }
        remaining -= length
      } else if (child.nodeName === 'BR') {
        if (isTrailingBreak(child, el)) continue
        if (remaining === 0) {
          range.setStartBefore(child)
          return true
        }
        remaining -= 1
      } else if ((child as HTMLElement).isContentEditable === false) {
        // Atomic token (page link): position before or after it.
        const length = child.textContent?.length ?? 0
        if (remaining === 0) {
          range.setStartBefore(child)
          return true
        }
        if (remaining <= length) {
          range.setStartAfter(child)
          return true
        }
        remaining -= length
      } else if (walk(child)) {
        return true
      }
    }
    return false
  }

  if (!walk(el)) {
    range.selectNodeContents(el)
    range.collapse(false)
    const last = el.lastChild
    if (last && isTrailingBreak(last, el)) range.setStartBefore(last)
  }
  range.collapse(true)
  const selection = doc.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

/** Whether ArrowUp/ArrowDown should leave the block (caret on its first/last visual line). */
export function isCaretOnEdgeLine(el: HTMLElement, edge: 'first' | 'last'): boolean {
  const range = selectionRange(el)
  if (!range || !range.collapsed) return false
  if (edge === 'first' && getCaretOffset(el) === 0) return true
  if (edge === 'last' && getCaretOffset(el) === textLength(el)) return true
  const rects = range.getClientRects()
  const rect = rects[0] ?? range.getBoundingClientRect()
  if (!rect || (rect.top === 0 && rect.bottom === 0)) return true
  const box = el.getBoundingClientRect()
  const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 24
  return edge === 'first'
    ? rect.top - box.top < lineHeight * 0.8
    : box.bottom - rect.bottom < lineHeight * 0.8
}
