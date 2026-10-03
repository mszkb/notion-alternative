/**
 * Components with debounced, not yet written edits register a flush here, so a reload (e.g. to
 * apply an app update) never drops them.
 */
const flushers = new Set<() => Promise<unknown>>()

export function registerPendingEdits(flush: () => Promise<unknown>): () => void {
  flushers.add(flush)
  return () => flushers.delete(flush)
}

/** Writes all pending edits to the local database. */
export async function flushPendingEdits(): Promise<void> {
  await Promise.all([...flushers].map((flush) => flush()))
}
