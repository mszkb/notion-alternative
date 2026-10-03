import { type Block, inlineToPlainText } from '@notion-alt/shared'

export type BlockDiffStatus = 'same' | 'changed' | 'removed' | 'added'

export interface BlockDiff {
  id: string
  status: BlockDiffStatus
  /** Text in the old version (empty for blocks added since). */
  before: string
  /** Text now (empty for blocks removed since). */
  after: string
}

type DiffBlock = Pick<Block, 'id' | 'type' | 'content' | 'attrs'>

function text(block: DiffBlock): string {
  if (block.type === 'image' || block.type === 'file') return block.content || `[${block.type}]`
  return block.type === 'code' ? block.content : inlineToPlainText(block.content)
}

/**
 * Block-wise comparison of a version with the current page (by block id): what the version
 * had that is gone or different now, and what was added since. Order follows the version,
 * blocks added since come after the block they now follow.
 */
export function diffBlocks(version: DiffBlock[], current: DiffBlock[]): BlockDiff[] {
  const now = new Map(current.map((block) => [block.id, block]))
  const old = new Set(version.map((block) => block.id))
  const result: BlockDiff[] = version.map((block) => {
    const present = now.get(block.id)
    if (!present) return { id: block.id, status: 'removed', before: text(block), after: '' }
    const same =
      present.type === block.type &&
      present.content === block.content &&
      JSON.stringify(present.attrs) === JSON.stringify(block.attrs)
    return {
      id: block.id,
      status: same ? 'same' : 'changed',
      before: text(block),
      after: text(present),
    }
  })
  let previous: string | null = null
  for (const block of current) {
    if (!old.has(block.id)) {
      const index = previous === null ? -1 : result.findIndex((d) => d.id === previous)
      result.splice(index + 1, 0, { id: block.id, status: 'added', before: '', after: text(block) })
    }
    previous = block.id
  }
  return result
}
