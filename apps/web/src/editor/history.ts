import type { BlockState } from '../local/store'

function sameState(a: BlockState[], b: BlockState[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Undo/redo across blocks as a stack of document snapshots (issue #45, ADR 0008).
 *
 * A snapshot is recorded before each undoable step; undo hands back the snapshot to restore and
 * keeps the current state for redo. Restoring happens through `LocalStore`, so every undo is a
 * set of ordinary operations in the offline queue.
 */
export class EditHistory {
  private past: BlockState[][] = []
  private future: BlockState[][] = []

  constructor(private readonly limit = 200) {}

  /** Records `state` as the state before the next change. Clears redo. */
  record(state: BlockState[]): void {
    const last = this.past[this.past.length - 1]
    if (!last || !sameState(last, state)) {
      this.past.push(state)
      if (this.past.length > this.limit) this.past.shift()
    }
    this.future = []
  }

  /** The state to restore, or null if nothing differs from `current`. */
  undo(current: BlockState[]): BlockState[] | null {
    return this.step(this.past, this.future, current)
  }

  redo(current: BlockState[]): BlockState[] | null {
    return this.step(this.future, this.past, current)
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  /** Blocks recreated under a new id (tombstones are final): follow them in all snapshots. */
  rename(ids: Map<string, string>): void {
    if (ids.size === 0) return
    const apply = (stack: BlockState[][]) =>
      stack.map((state) => state.map((b) => (ids.has(b.id) ? { ...b, id: ids.get(b.id)! } : b)))
    this.past = apply(this.past)
    this.future = apply(this.future)
  }

  clear(): void {
    this.past = []
    this.future = []
  }

  private step(
    from: BlockState[][],
    to: BlockState[][],
    current: BlockState[],
  ): BlockState[] | null {
    // Skip snapshots equal to the current state (a recorded step that changed nothing).
    while (from.length > 0 && sameState(from[from.length - 1]!, current)) from.pop()
    const target = from.pop()
    if (!target) return null
    to.push(current)
    return target
  }
}
