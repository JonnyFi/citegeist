import type { NumberedNode } from "@citegeist/ops";
import type { OutlineNode } from "@citegeist/schema";

/**
 * Pure outline logic: numbering, tree shape and the move that a drop means. The core computes the
 * same numbers (docs/spec/research-planning.md section 4); the mock core and the tests use this
 * module, and the UI uses it to place a dropped node.
 */

type Flat = Pick<OutlineNode, "id" | "parent" | "order">;

/** Children of a node (or the chapters for `null`), by position. */
export function childrenOf<T extends Flat>(nodes: readonly T[], parent: string | null): T[] {
  return nodes.filter((n) => n.parent === parent).sort((a, b) => a.order - b.order);
}

/** Depth-first list with a computed number such as "2.1" and the depth. Never stored. */
export function numberNodes<T extends Flat>(
  nodes: readonly T[],
): Array<T & { number: string; depth: number }> {
  const out: Array<T & { number: string; depth: number }> = [];
  const walk = (parent: string | null, prefix: string, depth: number) => {
    childrenOf(nodes, parent).forEach((node, i) => {
      const number = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      out.push({ ...node, number, depth });
      walk(node.id, number, depth + 1);
    });
  };
  walk(null, "", 0);
  return out;
}

/** Rewrites `order` to 1..n among the siblings of every parent. */
export function normalizeOrder<T extends Flat>(nodes: readonly T[]): T[] {
  const next = new Map<string, number>();
  const parents = new Set(nodes.map((n) => n.parent));
  for (const parent of parents) {
    for (const [i, n] of childrenOf(nodes, parent).entries()) next.set(n.id, i + 1);
  }
  return nodes.map((n) => ({ ...n, order: next.get(n.id) ?? n.order }));
}

/** Ids of the node and everything below it. */
export function subtreeIds(nodes: readonly Flat[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) {
      if (n.parent && out.has(n.parent) && !out.has(n.id)) {
        out.add(n.id);
        grew = true;
      }
    }
  }
  return out;
}

export type DropPlace = "before" | "after" | "inside";

/** Where a drop lands, from the vertical offset in the row: top quarter, bottom quarter, middle. */
export function dropPlace(offset: number, height: number): DropPlace {
  if (!(height > 0)) return "after";
  const ratio = offset / height;
  if (ratio < 0.25) return "before";
  if (ratio > 0.75) return "after";
  return "inside";
}

export interface MoveTarget {
  parent: string | null;
  /** 1-based position among the new siblings once the node has left its old place. */
  position: number;
}

/**
 * The `move` operation for dropping `drag` before, after or inside `target`. Returns null when the
 * drop changes nothing or would put a node below itself.
 */
export function planMove(
  nodes: readonly Flat[],
  drag: string,
  target: string,
  place: DropPlace,
): MoveTarget | null {
  if (drag === target) return null;
  const dragged = nodes.find((n) => n.id === drag);
  const dropOn = nodes.find((n) => n.id === target);
  if (!dragged || !dropOn) return null;
  if (subtreeIds(nodes, drag).has(target)) return null;

  let move: MoveTarget;
  if (place === "inside") {
    const siblings = childrenOf(nodes, target).filter((n) => n.id !== drag);
    move = { parent: target, position: siblings.length + 1 };
  } else {
    const siblings = childrenOf(nodes, dropOn.parent).filter((n) => n.id !== drag);
    const at = siblings.findIndex((n) => n.id === target);
    move = { parent: dropOn.parent, position: at + 1 + (place === "after" ? 1 : 0) };
  }
  const unchanged =
    move.parent === dragged.parent &&
    childrenOf(nodes, dragged.parent).findIndex((n) => n.id === drag) + 1 === move.position;
  return unchanged ? null : move;
}

/** The moves behind the row buttons: up, down, indent (below the previous sibling), outdent. */
export type Step = "up" | "down" | "indent" | "outdent";

export function stepMove(nodes: readonly Flat[], id: string, step: Step): MoveTarget | null {
  const node = nodes.find((n) => n.id === id);
  if (!node) return null;
  const siblings = childrenOf(nodes, node.parent);
  const at = siblings.findIndex((n) => n.id === id);
  if (step === "up") return at > 0 ? { parent: node.parent, position: at } : null;
  if (step === "down") {
    return at < siblings.length - 1 ? { parent: node.parent, position: at + 2 } : null;
  }
  if (step === "indent") {
    const previous = siblings[at - 1];
    if (!previous) return null;
    return { parent: previous.id, position: childrenOf(nodes, previous.id).length + 1 };
  }
  if (node.parent === null) return null;
  const parent = nodes.find((n) => n.id === node.parent);
  if (!parent) return null;
  const uncles = childrenOf(nodes, parent.parent);
  return {
    parent: parent.parent,
    position: uncles.findIndex((n) => n.id === parent.id) + 2,
  };
}

/** "2.1 Anschlusskommunikation": how a link to a node reads. */
export function nodeLabel(node: Pick<NumberedNode, "number" | "title">): string {
  return `${node.number} ${node.title}`;
}

export const STATUS_ORDER = ["idea", "draft", "solid", "done"] as const;

export function nextStatus(status: (typeof STATUS_ORDER)[number]): (typeof STATUS_ORDER)[number] {
  const at = STATUS_ORDER.indexOf(status);
  return STATUS_ORDER[(at + 1) % STATUS_ORDER.length] ?? "idea";
}

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "plan";
}
