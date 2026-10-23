export const RRF_K = 60;

export interface RankedList<T> {
  items: T[];
  /** Weight of this list in the fusion. Default 1. */
  weight?: number;
}

/**
 * Reciprocal rank fusion: an item scores the sum of weight / (k + rank) over every list it
 * appears in (rank starts at 1). Lists need not share a score scale, only an order. When an item
 * appears in several lists, the version from the earliest list is kept.
 */
export function reciprocalRankFusion<T>(
  lists: RankedList<T>[],
  keyOf: (item: T) => string,
  k = RRF_K,
): { item: T; score: number }[] {
  const fused = new Map<string, { item: T; score: number }>();
  for (const list of lists) {
    const weight = list.weight ?? 1;
    for (const [rank, item] of list.items.entries()) {
      const key = keyOf(item);
      const entry = fused.get(key) ?? { item, score: 0 };
      entry.score += weight / (k + rank + 1);
      fused.set(key, entry);
    }
  }
  // Array.prototype.sort is stable, so equal scores keep the order of first appearance.
  return [...fused.values()].sort((a, b) => b.score - a.score);
}
