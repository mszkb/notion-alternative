import type { BlockAttrs, BlockType } from './content'

export interface MarkdownBlock {
  type: BlockType
  content: string
  attrs: BlockAttrs
}

/** Block types written as Markdown list items; consecutive ones form one list. */
const LIST_TYPES = new Set<BlockType>(['list_item', 'todo', 'toggle'])

/** Longest run of backticks in `text`, so a code fence can be chosen that never closes early. */
function longestBacktickRun(text: string): number {
  return Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
}

export interface BlocksToMarkdownOptions {
  /** Link target of an attachment; default `attachment:<id>`. */
  attachmentHref?: (attachmentId: string) => string
}

/**
 * Serialises blocks as Markdown (block content already is Markdown inline, ADR 0008).
 * Consecutive list items form one list; ordered items are numbered per indent level.
 * Page links stay `[Title](page:<id>)`; the export (ADR 0004) rewrites them separately.
 */
export function blocksToMarkdown(
  blocks: MarkdownBlock[],
  options: BlocksToMarkdownOptions = {},
): string {
  const attachmentHref = options.attachmentHref ?? ((id: string) => `attachment:${id}`)
  const parts: string[] = []
  const counters: number[] = []
  let previousWasList = false

  for (const block of blocks) {
    const indent = block.attrs.indent ?? 0
    let text: string
    if (block.type === 'list_item') {
      counters.length = indent + 1
      let marker = '-'
      if (block.attrs.list === 'ordered') {
        counters[indent] = (counters[indent] ?? 0) + 1
        marker = `${counters[indent]}.`
      } else {
        counters[indent] = 0
      }
      text = `${'  '.repeat(indent)}${marker} ${block.content}`
    } else if (block.type === 'todo') {
      // GitHub/CommonMark task list (ADR 0019). Numbering of outer levels continues after it.
      counters.length = Math.min(counters.length, indent)
      text = `${'  '.repeat(indent)}- [${block.attrs.checked ? 'x' : ' '}] ${block.content}`
    } else if (block.type === 'toggle') {
      // A list item; its children follow indented (ADR 0019).
      counters.length = Math.min(counters.length, indent)
      text = `${'  '.repeat(indent)}- ${block.content}`
    } else {
      counters.length = Math.min(counters.length, indent)
      switch (block.type) {
        case 'heading':
          text = `${'#'.repeat(block.attrs.level ?? 1)} ${block.content}`
          break
        case 'quote':
          text = block.content
            .split('\n')
            .map((line) => (line ? `> ${line}` : '>'))
            .join('\n')
          break
        case 'callout': {
          const lines = `${block.attrs.icon ?? '💡'} ${block.content}`.split('\n')
          text = lines.map((line) => (line ? `> ${line}` : '>')).join('\n')
          break
        }
        case 'divider':
          text = '---'
          break
        case 'code': {
          const fence = '`'.repeat(Math.max(3, longestBacktickRun(block.content) + 1))
          text = `${fence}${block.attrs.language ?? ''}\n${block.content}\n${fence}`
          break
        }
        case 'image':
          text = `![${block.content || 'Bild'}](${attachmentHref(block.attrs.attachmentId ?? '')})`
          break
        case 'file':
          text = `[${block.content || 'Datei'}](${attachmentHref(block.attrs.attachmentId ?? '')})`
          break
        default:
          text = block.content
      }
      // Children of a toggle keep their depth as indentation.
      if (indent > 0) {
        text = text
          .split('\n')
          .map((line) => (line ? `${'  '.repeat(indent)}${line}` : line))
          .join('\n')
      }
    }
    const isList = LIST_TYPES.has(block.type)
    parts.push(parts.length === 0 ? text : `${isList && previousWasList ? '\n' : '\n\n'}${text}`)
    previousWasList = isList
  }
  return parts.join('')
}
