import type { graphNeighbors } from "@citegeist/ops";
import { AutoRelation, Relation } from "@citegeist/schema";
import type { z } from "zod";

export type Neighbors = z.output<typeof graphNeighbors.output>;
export type GraphNode = Neighbors["nodes"][number];
export type GraphEdge = Neighbors["edges"][number];
export type NodeKind = GraphNode["kind"];

/** Typed relations first in the order of the vocabulary, then the automatic ones. */
export const RELATION_ORDER: readonly string[] = [...Relation.options, ...AutoRelation.options];

/** Group key for edges without a typed relation, such as plain wiki links. */
export const UNTYPED = "untyped";

export const NODE_KINDS: readonly NodeKind[] = ["item", "card", "note"];

/** Relation of an edge as a group key: vocabulary members stay, anything else is untyped. */
export function relationKey(rel: string | null | undefined): string {
  return rel && RELATION_ORDER.includes(rel) ? rel : UNTYPED;
}

/** Order of groups in lists and filters: vocabulary order, untyped last. */
export function compareRelations(a: string, b: string): number {
  const rank = (k: string) => (k === UNTYPED ? RELATION_ORDER.length : RELATION_ORDER.indexOf(k));
  return rank(a) - rank(b);
}

export function groupBy<T>(items: readonly T[], key: (item: T) => string): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = groups.get(k);
    if (list) list.push(item);
    else groups.set(k, [item]);
  }
  return [...groups.entries()].sort(([a], [b]) => compareRelations(a, b));
}

/** Target of a wiki link value such as `[[luhmann1984soziale|Luhmann]]`. */
export function linkTarget(value: string): string {
  const m = /^\[\[([^\]|#]+)/.exec(value.trim());
  return (m?.[1] ?? value).trim();
}

export function nodeIndex(neighbors: Neighbors | undefined): Map<string, GraphNode> {
  return new Map((neighbors?.nodes ?? []).map((n) => [n.id, n]));
}
