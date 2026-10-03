import type { BlockAttrs, BlockType } from './content'

export interface MarkdownBlock {
  type: BlockType
  content: string
  attrs: BlockAttrs
}

/** Longest run of backticks in `text`, so a code fence can be chosen that never closes early. */
function longestBacktickRun(text: string): number {
  return Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
}

/**
 * Serialises blocks as Markdown (block content already is Markdown inline, ADR 0008).
 * Consecutive list items form one list; ordered items are numbered per indent level.
 * Page links stay `[Title](page:<id>)`; the export (ADR 0004) rewrites them separately.
 */
export function blocksToMarkdown(blocks: MarkdownBlock[]): string {
  const parts: string[] = []
  const counters: number[] = []
  let previousWasList = false

  for (const block of blocks) {
    let text: string
    if (block.type === 'list_item') {
      const indent = block.attrs.indent ?? 0
      counters.length = indent + 1
      let marker = '-'
      if (block.attrs.list === 'ordered') {
        counters[indent] = (counters[indent] ?? 0) + 1
        marker = `${counters[indent]}.`
      } else {
        counters[indent] = 0
      }
      text = `${'  '.repeat(indent)}${marker} ${block.content}`
    } else {
      counters.length = 0
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
        case 'code': {
          const fence = '`'.repeat(Math.max(3, longestBacktickRun(block.content) + 1))
          text = `${fence}${block.attrs.language ?? ''}\n${block.content}\n${fence}`
          break
        }
        default:
          text = block.content
      }
    }
    const isList = block.type === 'list_item'
    parts.push(parts.length === 0 ? text : `${isList && previousWasList ? '\n' : '\n\n'}${text}`)
    previousWasList = isList
  }
  return parts.join('')
}
