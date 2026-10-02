import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'

/**
 * Fractional index between two neighbours (`null` = list start/end). Keys compare as plain
 * strings (code unit order), never with `localeCompare`.
 */
export function sortKeyBetween(before: string | null, after: string | null): string {
  // Neighbours with equal keys (concurrent inserts, resolved by id) leave no room in between;
  // append after `before` instead of throwing. The id tie-break keeps the order deterministic.
  if (before !== null && after !== null && before >= after) return generateKeyBetween(before, null)
  return generateKeyBetween(before, after)
}

export function sortKeysBetween(before: string | null, after: string | null, count: number) {
  return generateNKeysBetween(before, after, count)
}

/**
 * Orders by sort key; equal keys (concurrent inserts on two devices) are tie-broken by id so every
 * device shows the same order.
 */
export function compareBySortKey(
  a: { sortKey: string; id: string },
  b: { sortKey: string; id: string },
): number {
  if (a.sortKey !== b.sortKey) return a.sortKey < b.sortKey ? -1 : 1
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}
