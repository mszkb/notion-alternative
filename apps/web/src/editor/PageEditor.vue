<script setup lang="ts">
import {
  type Block,
  type BlockAttrs,
  type BlockType,
  inlineToPlainText,
  MAX_LIST_INDENT,
  newId,
  serializeInline,
} from '@notion-alt/shared'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useLiveQuery } from '../composables/live-query'
import { displayTitle, useWorkspace } from '../composables/workspace'
import {
  getCaretOffset,
  isCaretAtEnd,
  isCaretAtStart,
  isCaretOnEdgeLine,
  setCaretOffset,
  textLength,
} from './caret'
import { renderInline, serializeDom } from './inline-dom'
import PagePicker, { type PickerChoice } from './PagePicker.vue'

const props = defineProps<{ documentId: string }>()

const SAVE_DELAY_MS = 400

const { store, workspaceId, documentsById } = useWorkspace()
const router = useRouter()

const stored = useLiveQuery<Block[] | null>(
  () => store.listBlocks(props.documentId),
  null,
  () => props.documentId,
)

/**
 * Blocks as shown. Structural edits (split, merge, move, type change) apply here synchronously so
 * the next keystroke already lands in the right block; the write follows, then the list is
 * re-read from the database. While such writes are pending, live-query results are ignored.
 */
const blocks = shallowRef<Block[] | null>(null)
let structuralWrites = 0
watch(stored, (value) => {
  if (structuralWrites === 0) blocks.value = value
})

async function structural<T>(
  id: string,
  apply: (list: Block[]) => Block[],
  persist: () => Promise<T>,
): Promise<T | undefined> {
  structuralWrites += 1
  blocks.value = apply([...(blocks.value ?? [])])
  try {
    return await track(id, persist())
  } finally {
    structuralWrites -= 1
    if (structuralWrites === 0) {
      const fresh = await store.listBlocks(props.documentId)
      if (structuralWrites === 0) blocks.value = fresh
    }
  }
}

function replaceBlock(list: Block[], id: string, patch: Partial<Block>): Block[] {
  return list.map((b) => (b.id === id ? { ...b, ...patch } : b))
}

function insertAfter(list: Block[], afterId: string | null, block: Block): Block[] {
  const index = afterId === null ? -1 : list.findIndex((b) => b.id === afterId)
  return [...list.slice(0, index + 1), block, ...list.slice(index + 1)]
}

function draftBlock(input: Pick<Block, 'type' | 'attrs' | 'content'>): Block {
  return {
    id: newId(),
    documentId: props.documentId,
    sortKey: '~',
    revision: null,
    deletedAt: null,
    ...input,
  }
}

const blockById = computed(() => new Map((blocks.value ?? []).map((b) => [b.id, b])))

/** Editable element per block: contenteditable div, or textarea for code. */
const elements = new Map<string, HTMLElement>()
/** Content currently shown in each element, to tell own saves from external changes. */
const rendered = new Map<string, string>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const inFlight = new Map<string, Promise<unknown>>()
const saving = ref(0)
const error = ref<string | null>(null)
let pendingFocus: { id: string; offset: number | 'end' } | null = null

const renderOptions = {
  resolvePage: (id: string) => {
    const document = documentsById.value.get(id)
    return document ? { title: displayTitle(document) } : undefined
  },
  pageHref: (id: string) =>
    router.resolve({ name: 'page', params: { workspaceId: workspaceId.value, documentId: id } })
      .href,
}

// ------------------------------------------------------------------ DOM sync

function isTextarea(el: HTMLElement): el is HTMLTextAreaElement {
  return el.tagName === 'TEXTAREA'
}

function renderBlock(block: Block, el: HTMLElement, content = block.content) {
  if (isTextarea(el)) {
    el.value = content
    autosize(el)
  } else {
    renderInline(el, content, renderOptions)
    el.classList.toggle('is-empty', textLength(el) === 0)
  }
  rendered.set(block.id, content)
}

function readContent(block: Block, el: HTMLElement): string {
  return isTextarea(el) ? el.value : serializeDom(el)
}

/** Code does not wrap, so the line count gives the height without measuring layout. */
function autosize(el: HTMLTextAreaElement) {
  el.rows = Math.max(1, el.value.split('\n').length)
}

function isBusy(id: string): boolean {
  const el = elements.get(id)
  return (
    timers.has(id) ||
    inFlight.has(id) ||
    picker.value?.blockId === id ||
    linking.value === id ||
    (!!el && el === document.activeElement)
  )
}

/** Applies stored content to elements that are not being edited (own saves, other tabs). */
function syncDom(force = false) {
  for (const block of blocks.value ?? []) {
    const el = elements.get(block.id)
    if (!el || isBusy(block.id)) continue
    const linksPages = block.content.includes('](page:')
    if ((force && linksPages) || rendered.get(block.id) !== block.content) renderBlock(block, el)
  }
  applyPendingFocus()
}

function setElement(block: Block, el: unknown) {
  if (el instanceof HTMLElement) {
    if (elements.get(block.id) === el) return
    elements.set(block.id, el)
    renderBlock(block, el)
    applyPendingFocus()
  } else {
    // Vue may call the old element's ref with null after the new element (e.g. div → textarea)
    // has registered; only forget the block once its registered element is really gone.
    queueMicrotask(() => {
      const current = elements.get(block.id)
      if (current && !current.isConnected) {
        elements.delete(block.id)
        rendered.delete(block.id)
      }
    })
  }
}

watch(blocks, () => syncDom(), { flush: 'post' })
// Linked page titles changed: re-render idle blocks.
watch(documentsById, () => syncDom(true), { flush: 'post' })

// ------------------------------------------------------------------ focus

function focusBlock(id: string, offset: number | 'end') {
  pendingFocus = { id, offset }
  applyPendingFocus()
}

function applyPendingFocus() {
  if (!pendingFocus) return
  const el = elements.get(pendingFocus.id)
  if (!el || !el.isConnected) return
  const { offset } = pendingFocus
  pendingFocus = null
  el.focus()
  if (isTextarea(el)) {
    const position = offset === 'end' ? el.value.length : Math.min(offset, el.value.length)
    el.setSelectionRange(position, position)
  } else {
    setCaretOffset(el, offset === 'end' ? textLength(el) : offset)
  }
}

function caretOf(el: HTMLElement): number {
  return isTextarea(el) ? el.selectionStart : (getCaretOffset(el) ?? 0)
}

// ------------------------------------------------------------------ saving

function track<T>(id: string, promise: Promise<T>): Promise<T | undefined> {
  saving.value += 1
  const tracked = promise
    .then((value) => {
      error.value = null
      return value
    })
    .catch((e: unknown) => {
      console.error(e)
      error.value = 'Änderung konnte nicht gespeichert werden.'
      return undefined
    })
    .finally(() => {
      saving.value -= 1
      if (inFlight.get(id) === tracked) inFlight.delete(id)
    })
  inFlight.set(id, tracked)
  return tracked
}

function cancelTimer(id: string) {
  const timer = timers.get(id)
  if (timer) clearTimeout(timer)
  timers.delete(id)
}

function scheduleSave(id: string) {
  cancelTimer(id)
  timers.set(
    id,
    setTimeout(() => void flush(id), SAVE_DELAY_MS),
  )
}

async function flush(id: string) {
  cancelTimer(id)
  const block = blockById.value.get(id)
  const el = elements.get(id)
  if (!block || !el) return
  const content = readContent(block, el)
  rendered.set(id, content)
  await track(id, store.updateBlock(id, { content }))
}

function flushAll() {
  for (const id of [...timers.keys()]) void flush(id)
}

function onVisibilityChange() {
  if (document.visibilityState === 'hidden') flushAll()
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', flushAll)
  document.addEventListener('mousedown', closeMenuOnOutsideClick)
})

onBeforeUnmount(() => {
  flushAll()
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.removeEventListener('pagehide', flushAll)
  document.removeEventListener('mousedown', closeMenuOnOutsideClick)
})

// ------------------------------------------------------------------ structure helpers

function neighbour(id: string, delta: -1 | 1): Block | undefined {
  const list = blocks.value ?? []
  const index = list.findIndex((b) => b.id === id)
  return index === -1 ? undefined : list[index + delta]
}

/** Current (possibly unsaved) content of a block. */
function currentContent(block: Block): string {
  const el = elements.get(block.id)
  return el ? readContent(block, el) : block.content
}

/** Converts content between inline Markdown and raw code text. */
function convertContent(content: string, from: BlockType, to: BlockType): string {
  if ((from === 'code') === (to === 'code')) return content
  return to === 'code'
    ? inlineToPlainText(content)
    : serializeInline([{ type: 'text', text: content }])
}

async function setType(block: Block, type: BlockType, attrs: BlockAttrs, offset?: number) {
  const el = elements.get(block.id)
  const caret = offset ?? (el ? caretOf(el) : 0)
  const content = convertContent(currentContent(block), block.type, type)
  cancelTimer(block.id)
  rendered.set(block.id, content)
  pendingFocus = { id: block.id, offset: caret }
  await structural(
    block.id,
    (list) => replaceBlock(list, block.id, { type, attrs, content }),
    () => store.updateBlock(block.id, { type, attrs, content }),
  )
}

async function splitAtCaret(block: Block, el: HTMLElement) {
  const selection = document.getSelection()
  if (!selection?.rangeCount) return
  const range = selection.getRangeAt(0)
  if (!el.contains(range.startContainer) && range.startContainer !== el) return

  // Enter on an empty list item or quote leaves the list/quote.
  if ((block.type === 'list_item' || block.type === 'quote') && textLength(el) === 0) {
    await setType(block, 'paragraph', {}, 0)
    return
  }
  range.deleteContents()
  const tailRange = document.createRange()
  tailRange.setStart(range.startContainer, range.startOffset)
  tailRange.setEnd(el, el.childNodes.length)
  const tail = serializeDom(tailRange.extractContents())
  const head = serializeDom(el)
  el.classList.toggle('is-empty', textLength(el) === 0)
  cancelTimer(block.id)
  rendered.set(block.id, head)
  const created = draftBlock({
    type: block.type === 'list_item' ? 'list_item' : 'paragraph',
    attrs: block.type === 'list_item' ? { ...block.attrs } : {},
    content: tail,
  })
  pendingFocus = { id: created.id, offset: 0 }
  await structural(
    block.id,
    (list) => insertAfter(replaceBlock(list, block.id, { content: head }), block.id, created),
    () => store.splitBlock(block.id, head, created),
  )
}

async function backspaceAtStart(block: Block, el: HTMLElement) {
  if (block.type === 'list_item' && (block.attrs.indent ?? 0) > 0) {
    await setIndent(block, -1)
    return
  }
  if (block.type !== 'paragraph') {
    await setType(block, 'paragraph', {}, 0)
    return
  }
  const previous = neighbour(block.id, -1)
  const previousEl = previous && elements.get(previous.id)
  if (!previous || !previousEl) return
  const before = readContent(previous, previousEl)
  const own = readContent(block, el)
  const merged = before + convertContent(own, block.type, previous.type)
  const offset = isTextarea(previousEl) ? before.length : textLength(previousEl)
  cancelTimer(block.id)
  cancelTimer(previous.id)
  renderBlock(previous, previousEl, merged)
  focusBlock(previous.id, offset)
  await structural(
    previous.id,
    (list) => replaceBlock(list, previous.id, { content: merged }).filter((b) => b.id !== block.id),
    () => store.mergeBlocks(previous.id, block.id, merged),
  )
}

async function mergeNext(block: Block, el: HTMLElement) {
  const next = neighbour(block.id, 1)
  if (!next || block.type === 'code') return
  const own = readContent(block, el)
  const offset = textLength(el)
  const merged = own + convertContent(currentContent(next), next.type, block.type)
  cancelTimer(block.id)
  cancelTimer(next.id)
  renderBlock(block, el, merged)
  setCaretOffset(el, offset)
  await structural(
    block.id,
    (list) => replaceBlock(list, block.id, { content: merged }).filter((b) => b.id !== next.id),
    () => store.mergeBlocks(block.id, next.id, merged),
  )
}

async function setIndent(block: Block, delta: number) {
  const indent = Math.min(MAX_LIST_INDENT, Math.max(0, (block.attrs.indent ?? 0) + delta))
  if (indent === (block.attrs.indent ?? 0)) return
  await setType(block, 'list_item', { ...block.attrs, indent })
}

async function move(block: Block, direction: -1 | 1) {
  const list = blocks.value ?? []
  const index = list.findIndex((b) => b.id === block.id)
  const target = index + direction
  if (index === -1 || target < 0 || target >= list.length) return
  const afterId = direction === -1 ? (list[target - 1]?.id ?? null) : list[target]!.id
  const el = elements.get(block.id)
  pendingFocus = { id: block.id, offset: el ? caretOf(el) : 0 }
  void flush(block.id)
  await structural(
    block.id,
    (current) => {
      const rest = current.filter((b) => b.id !== block.id)
      return insertAfter(rest, afterId, current[index]!)
    },
    () => store.moveBlock(block.id, { afterId }),
  )
}

async function remove(block: Block) {
  const previous = neighbour(block.id, -1) ?? neighbour(block.id, 1)
  cancelTimer(block.id)
  if (previous) pendingFocus = { id: previous.id, offset: 'end' }
  await structural(
    block.id,
    (list) => list.filter((b) => b.id !== block.id),
    () => store.deleteBlock(block.id),
  )
}

async function appendParagraph() {
  const list = blocks.value ?? []
  const last = list[list.length - 1]
  if (last && last.type === 'paragraph' && !currentContent(last)) {
    focusBlock(last.id, 0)
    return
  }
  await insertParagraphAfter(last?.id ?? null)
}

async function insertParagraphAfter(afterId: string | null) {
  const created = draftBlock({ type: 'paragraph', attrs: {}, content: '' })
  pendingFocus = { id: created.id, offset: 0 }
  await structural(
    created.id,
    (list) => insertAfter(list, afterId, created),
    () => store.createBlock(props.documentId, created, { afterId }),
  )
}

// ------------------------------------------------------------------ inline editing

const SHORTCUTS: [RegExp, BlockType, BlockAttrs][] = [
  [/^### /, 'heading', { level: 3 }],
  [/^## /, 'heading', { level: 2 }],
  [/^# /, 'heading', { level: 1 }],
  [/^[-*] /, 'list_item', { list: 'bullet', indent: 0 }],
  [/^1[.)] /, 'list_item', { list: 'ordered', indent: 0 }],
  [/^> /, 'quote', {}],
  [/^```/, 'code', {}],
]

/** Removes the first `count` characters (a typed shortcut prefix) from the element's text. */
function deleteLeadingText(el: HTMLElement, count: number) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let remaining = count
  while (remaining > 0 && walker.nextNode()) {
    const node = walker.currentNode as Text
    const take = Math.min(remaining, node.data.length)
    node.deleteData(0, take)
    remaining -= take
  }
}

function applyShortcut(block: Block, el: HTMLElement): boolean {
  if (block.type !== 'paragraph') return false
  const text = el.textContent ?? ''
  for (const [pattern, type, attrs] of SHORTCUTS) {
    const match = pattern.exec(text)
    if (!match || getCaretOffset(el) !== match[0].length) continue
    deleteLeadingText(el, match[0].length)
    void setType({ ...block, content: serializeDom(el) }, type, attrs, 0)
    return true
  }
  return false
}

function onInput(block: Block, event: Event) {
  const el = event.currentTarget as HTMLElement
  if (isTextarea(el)) {
    autosize(el)
  } else {
    el.classList.toggle('is-empty', textLength(el) === 0)
    if (applyShortcut(block, el)) return
    const input = event as InputEvent
    if (input.inputType === 'insertText' && input.data === '[' && textBeforeCaret(2) === '[[') {
      openPicker(block, el, 'page', 2)
    }
  }
  scheduleSave(block.id)
}

function textBeforeCaret(length: number): string {
  const selection = document.getSelection()
  const node = selection?.anchorNode
  if (!selection || !node || node.nodeType !== 3) return ''
  const offset = selection.anchorOffset
  return (node.textContent ?? '').slice(Math.max(0, offset - length), offset)
}

function toggleInlineCode(el: HTMLElement) {
  const selection = document.getSelection()
  if (!selection?.rangeCount) return
  const range = selection.getRangeAt(0)
  if (range.collapsed || !el.contains(range.commonAncestorContainer)) return
  const container = range.commonAncestorContainer
  const existing = (
    container.nodeType === 3 ? container.parentElement : (container as Element)
  )?.closest('code')
  if (existing && el.contains(existing)) {
    existing.replaceWith(document.createTextNode(existing.textContent ?? ''))
    return
  }
  const code = document.createElement('code')
  code.textContent = range.toString()
  range.deleteContents()
  range.insertNode(code)
  range.setStartAfter(code)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

function onKeydown(block: Block, event: KeyboardEvent) {
  const el = event.currentTarget as HTMLElement
  if (event.isComposing) return
  const mod = event.metaKey || event.ctrlKey

  if (event.altKey && event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
    event.preventDefault()
    void move(block, event.key === 'ArrowUp' ? -1 : 1)
    return
  }
  if (isTextarea(el)) {
    onCodeKeydown(block, el, event, mod)
    return
  }
  if (mod && !event.altKey && !event.shiftKey) {
    const key = event.key.toLowerCase()
    if (key === 'b' || key === 'i') {
      event.preventDefault()
      document.execCommand(key === 'b' ? 'bold' : 'italic')
      scheduleSave(block.id)
      return
    }
    if (key === 'e') {
      event.preventDefault()
      toggleInlineCode(el)
      scheduleSave(block.id)
      return
    }
    if (key === 'k') {
      event.preventDefault()
      openPicker(block, el, 'link', 0)
      return
    }
  }
  switch (event.key) {
    case 'Enter':
      if (event.shiftKey) return
      event.preventDefault()
      void splitAtCaret(block, el)
      return
    case 'Backspace':
      if (isCaretAtStart(el)) {
        event.preventDefault()
        void backspaceAtStart(block, el)
      }
      return
    case 'Delete':
      if (isCaretAtEnd(el) && neighbour(block.id, 1)) {
        event.preventDefault()
        void mergeNext(block, el)
      }
      return
    case 'Tab':
      if (block.type === 'list_item') {
        event.preventDefault()
        void setIndent(block, event.shiftKey ? -1 : 1)
      }
      return
    case 'ArrowUp':
    case 'ArrowDown': {
      const up = event.key === 'ArrowUp'
      const target = neighbour(block.id, up ? -1 : 1)
      if (target && isCaretOnEdgeLine(el, up ? 'first' : 'last')) {
        event.preventDefault()
        focusBlock(target.id, up ? 'end' : 0)
      }
      return
    }
    case 'Escape':
      el.blur()
  }
}

function onCodeKeydown(block: Block, el: HTMLTextAreaElement, event: KeyboardEvent, mod: boolean) {
  const atStart = el.selectionStart === 0 && el.selectionEnd === 0
  const atEnd = el.selectionStart === el.value.length
  if (event.key === 'Enter' && mod) {
    // Leave the code block: new paragraph below.
    event.preventDefault()
    void flush(block.id)
    void insertParagraphAfter(block.id)
  } else if (event.key === 'Tab' && !event.shiftKey) {
    event.preventDefault()
    document.execCommand('insertText', false, '  ')
  } else if (event.key === 'Backspace' && atStart && el.value === '') {
    event.preventDefault()
    void setType(block, 'paragraph', {}, 0)
  } else if (event.key === 'ArrowUp' && atStart) {
    const previous = neighbour(block.id, -1)
    if (previous) {
      event.preventDefault()
      focusBlock(previous.id, 'end')
    }
  } else if (event.key === 'ArrowDown' && atEnd) {
    const next = neighbour(block.id, 1)
    if (next) {
      event.preventDefault()
      focusBlock(next.id, 0)
    }
  } else if (event.key === 'Escape') {
    el.blur()
  }
}

function onBlur(block: Block) {
  if (timers.has(block.id)) void flush(block.id)
}

function onPaste(event: ClipboardEvent) {
  // Only plain text enters the editor; foreign HTML never reaches the DOM.
  event.preventDefault()
  const text = event.clipboardData?.getData('text/plain') ?? ''
  if (text) document.execCommand('insertText', false, text.replace(/\r\n?/g, '\n'))
}

function onDrop(event: DragEvent) {
  // Like paste: dropped HTML never reaches the DOM, only its plain text.
  event.preventDefault()
  const text = event.dataTransfer?.getData('text/plain') ?? ''
  if (!text) return
  const el = event.currentTarget as HTMLElement
  const range = document.caretRangeFromPoint?.(event.clientX, event.clientY)
  if (range && el.contains(range.startContainer)) {
    const selection = document.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  } else {
    el.focus()
    setCaretOffset(el, textLength(el))
  }
  document.execCommand('insertText', false, text.replace(/\r\n?/g, '\n'))
}

function onClick(event: MouseEvent) {
  const link = (event.target as Element | null)?.closest?.('a')
  if (!link) return
  event.preventDefault()
  if (link.dataset.pageId) {
    void router.push(link.getAttribute('href') ?? '/')
  } else {
    window.open(link.href, '_blank', 'noopener,noreferrer')
  }
}

// ------------------------------------------------------------------ link picker

const picker = ref<{
  blockId: string
  mode: 'page' | 'link'
  range: Range
  remove: number
  position: { top: number; left: number }
} | null>(null)

function openPicker(block: Block, el: HTMLElement, mode: 'page' | 'link', remove: number) {
  const selection = document.getSelection()
  if (!selection?.rangeCount) return
  const range = selection.getRangeAt(0).cloneRange()
  if (!el.contains(range.startContainer) && range.startContainer !== el) return
  const rect = range.getBoundingClientRect()
  const box = el.getBoundingClientRect()
  picker.value = {
    blockId: block.id,
    mode,
    range,
    remove,
    position: {
      top: (rect.bottom || box.bottom) + 6,
      left: Math.min(rect.left || box.left, window.innerWidth - 320),
    },
  }
}

function closePicker(refocus: boolean) {
  const state = picker.value
  picker.value = null
  if (state && refocus) elements.get(state.blockId)?.focus()
}

/** Block whose saved range is in use while a chosen link is inserted (keeps it from re-rendering). */
const linking = ref<string | null>(null)

async function choose(choice: PickerChoice) {
  const state = picker.value
  picker.value = null
  if (!state) return
  linking.value = state.blockId
  try {
    await insertLink(state, choice)
  } finally {
    linking.value = null
  }
}

async function insertLink(
  state: { blockId: string; range: Range; remove: number },
  choice: PickerChoice,
) {
  const block = blockById.value.get(state.blockId)
  const el = elements.get(state.blockId)
  if (!block || !el) return

  let pageId: string | null = null
  let title = ''
  if (choice.kind === 'page') {
    pageId = choice.documentId
    title = choice.title
  } else if (choice.kind === 'new-page') {
    const created = await store.createDocument({
      workspaceId: workspaceId.value,
      parentId: props.documentId,
      title: choice.title,
    })
    pageId = created.id
    title = displayTitle(created)
  }

  el.focus()
  const range = state.range
  if (state.remove && range.startContainer.nodeType === 3 && range.startOffset >= state.remove) {
    range.setStart(range.startContainer, range.startOffset - state.remove)
  }
  const anchor = document.createElement('a')
  if (pageId) {
    anchor.className = 'page-link'
    anchor.dataset.pageId = pageId
    anchor.href = renderOptions.pageHref(pageId)
    anchor.contentEditable = 'false'
    anchor.textContent = title
    range.deleteContents()
  } else if (choice.kind === 'url') {
    anchor.href = choice.href
    anchor.rel = 'noopener noreferrer'
    anchor.target = '_blank'
    if (range.collapsed) anchor.textContent = choice.href
    else anchor.append(range.extractContents())
  }
  range.insertNode(anchor)
  const spacer = document.createTextNode(' ')
  anchor.after(spacer)
  const selection = document.getSelection()
  const caret = document.createRange()
  caret.setStart(spacer, 1)
  caret.collapse(true)
  selection?.removeAllRanges()
  selection?.addRange(caret)
  el.classList.remove('is-empty')
  await flush(block.id)
}

// ------------------------------------------------------------------ block menu

const menuFor = ref<string | null>(null)

const TYPE_OPTIONS: { label: string; type: BlockType; attrs: BlockAttrs }[] = [
  { label: 'Text', type: 'paragraph', attrs: {} },
  { label: 'Überschrift 1', type: 'heading', attrs: { level: 1 } },
  { label: 'Überschrift 2', type: 'heading', attrs: { level: 2 } },
  { label: 'Überschrift 3', type: 'heading', attrs: { level: 3 } },
  { label: 'Aufzählung', type: 'list_item', attrs: { list: 'bullet', indent: 0 } },
  { label: 'Nummerierte Liste', type: 'list_item', attrs: { list: 'ordered', indent: 0 } },
  { label: 'Zitat', type: 'quote', attrs: {} },
  { label: 'Code', type: 'code', attrs: {} },
]

function closeMenuOnOutsideClick(event: MouseEvent) {
  if (!(event.target as Element | null)?.closest?.('.block-menu, .block-handle')) {
    menuFor.value = null
  }
}

async function menuAction(action: () => Promise<void>) {
  menuFor.value = null
  await action()
}

// ------------------------------------------------------------------ presentation

/** Numbers for ordered list items, restarting after any other block and per indent level. */
const listNumbers = computed(() => {
  const numbers = new Map<string, number>()
  const counters: number[] = []
  for (const block of blocks.value ?? []) {
    if (block.type !== 'list_item') {
      counters.length = 0
      continue
    }
    const indent = block.attrs.indent ?? 0
    counters.length = indent + 1
    if (block.attrs.list === 'ordered') {
      counters[indent] = (counters[indent] ?? 0) + 1
      numbers.set(block.id, counters[indent]!)
    } else {
      counters[indent] = 0
    }
  }
  return numbers
})

function blockClass(block: Block) {
  return [
    `block-${block.type.replace('_', '-')}`,
    block.type === 'heading' ? `level-${block.attrs.level ?? 1}` : null,
    block.type === 'list_item' ? `list-${block.attrs.list ?? 'bullet'}` : null,
  ]
}

function blockLabel(block: Block): string {
  switch (block.type) {
    case 'heading':
      return `Überschrift ${block.attrs.level ?? 1}`
    case 'list_item':
      return block.attrs.list === 'ordered' ? 'Nummerierter Listenpunkt' : 'Listenpunkt'
    case 'quote':
      return 'Zitat'
    case 'code':
      return 'Code'
    default:
      return 'Text'
  }
}
</script>

<template>
  <div class="editor">
    <p class="save-state muted" aria-live="polite">
      <span v-if="error" class="error" role="alert">{{ error }}</span>
      <span v-else-if="saving > 0">Speichert…</span>
      <span v-else data-testid="saved">Lokal gespeichert</span>
    </p>

    <div
      v-for="block in blocks ?? []"
      :key="block.id"
      class="block"
      :class="blockClass(block)"
      :style="{ '--indent': block.attrs.indent ?? 0 }"
      :data-block-id="block.id"
    >
      <button
        type="button"
        class="block-handle"
        aria-label="Blockmenü"
        title="Blockmenü"
        @click="menuFor = menuFor === block.id ? null : block.id"
      >
        ⋮⋮
      </button>
      <span v-if="block.type === 'list_item'" class="list-marker" aria-hidden="true">{{
        block.attrs.list === 'ordered' ? `${listNumbers.get(block.id)}.` : '•'
      }}</span>
      <textarea
        v-if="block.type === 'code'"
        :ref="(el) => setElement(block, el)"
        class="block-input code-input"
        spellcheck="false"
        rows="1"
        :aria-label="blockLabel(block)"
        @input="onInput(block, $event)"
        @keydown="onKeydown(block, $event)"
        @blur="onBlur(block)"
      ></textarea>
      <div
        v-else
        :ref="(el) => setElement(block, el)"
        class="block-input"
        contenteditable="true"
        role="textbox"
        aria-multiline="true"
        :aria-label="blockLabel(block)"
        :data-placeholder="
          block.type === 'paragraph'
            ? 'Schreiben … (# Überschrift, - Liste, [[ Seitenlink)'
            : blockLabel(block)
        "
        @input="onInput(block, $event)"
        @keydown="onKeydown(block, $event)"
        @blur="onBlur(block)"
        @paste="onPaste"
        @drop="onDrop"
        @click="onClick"
      ></div>

      <ul v-if="menuFor === block.id" class="block-menu" role="menu">
        <li v-for="option in TYPE_OPTIONS" :key="option.label">
          <button
            type="button"
            role="menuitem"
            @click="menuAction(() => setType(block, option.type, option.attrs))"
          >
            {{ option.label }}
          </button>
        </li>
        <li class="separator" role="separator"></li>
        <li>
          <button type="button" role="menuitem" @click="menuAction(() => move(block, -1))">
            Nach oben
          </button>
        </li>
        <li>
          <button type="button" role="menuitem" @click="menuAction(() => move(block, 1))">
            Nach unten
          </button>
        </li>
        <li>
          <button
            type="button"
            role="menuitem"
            class="danger"
            @click="menuAction(() => remove(block))"
          >
            Block löschen
          </button>
        </li>
      </ul>
    </div>

    <button type="button" class="add-block" @click="appendParagraph">+ Block hinzufügen</button>

    <PagePicker
      v-if="picker"
      :mode="picker.mode"
      :position="picker.position"
      :exclude-id="documentId"
      @select="choose"
      @close="closePicker(true)"
      @dismiss="closePicker(false)"
    />
  </div>
</template>
