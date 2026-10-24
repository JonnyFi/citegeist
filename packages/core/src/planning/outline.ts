import type { OutlineOp } from "@citegeist/ops";
import { CitegeistError, Outline, type OutlineNode } from "@citegeist/schema";
import { Document, parse } from "yaml";
import { ulid } from "../ids.js";

export const newNodeId = (): string => `k_${ulid()}`;

export interface NumberedNode extends OutlineNode {
  number: string;
  depth: number;
}

function fail(code: string, message: string, fix: string, context: Record<string, unknown> = {}) {
  return new CitegeistError({ code, message, fix, recovery: "fix-and-retry", context });
}

/** Reads outline.yaml. An empty file is an empty outline. */
export function parseOutline(text: string): Outline {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (err) {
    throw fail(
      "OUTLINE_INVALID",
      `outline.yaml is not valid YAML: ${(err as Error).message}`,
      "Fix the YAML syntax in outline.yaml.",
    );
  }
  const r = Outline.safeParse(raw ?? {});
  if (!r.success) {
    throw fail(
      "OUTLINE_INVALID",
      `outline.yaml is invalid: ${r.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
      "Fix the fields named in the message, see docs/spec/research-planning.md section 4.",
    );
  }
  return r.data;
}

/** Writes outline.yaml with one node per line, in the style of the spec. */
export function serializeOutline(outline: Outline): string {
  const doc = new Document({ nodes: outline.nodes.map(compact) });
  const nodes = doc.get("nodes", true) as { items: Array<{ flow?: boolean }> };
  for (const item of nodes.items) item.flow = true;
  return doc.toString({ lineWidth: 0, flowCollectionPadding: true });
}

function compact(n: OutlineNode): Record<string, unknown> {
  return {
    id: n.id,
    title: n.title,
    parent: n.parent,
    order: n.order,
    ...(n.purpose ? { purpose: n.purpose } : {}),
    status: n.status,
    ...(n.questions.length > 0 ? { questions: n.questions } : {}),
  };
}

function siblings(nodes: readonly OutlineNode[], parent: string | null): OutlineNode[] {
  return nodes
    .filter((n) => n.parent === parent)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** Depth-first order with computed numbers. Nodes whose parent is missing are treated as chapters. */
export function numbered(outline: Outline): NumberedNode[] {
  const ids = new Set(outline.nodes.map((n) => n.id));
  const nodes = outline.nodes.map((n) =>
    n.parent && !ids.has(n.parent) ? { ...n, parent: null } : n,
  );
  const out: NumberedNode[] = [];
  const walk = (parent: string | null, prefix: string, depth: number, seen: Set<string>): void => {
    siblings(nodes, parent).forEach((n, i) => {
      if (seen.has(n.id)) return;
      const number = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      out.push({ ...n, number, depth });
      walk(n.id, number, depth + 1, new Set([...seen, n.id]));
    });
  };
  walk(null, "", 0, new Set());
  return out;
}

/** Renumbers `order` to 1..n among siblings so that stored orders never have gaps or ties. */
export function normalize(outline: Outline): Outline {
  const order = new Map<string, number>();
  const parents = new Set(outline.nodes.map((n) => n.parent));
  for (const p of parents) {
    siblings(outline.nodes, p).forEach((n, i) => {
      order.set(n.id, i + 1);
    });
  }
  return { nodes: outline.nodes.map((n) => ({ ...n, order: order.get(n.id) ?? n.order })) };
}

export function descendants(outline: Outline, id: string): string[] {
  const out: string[] = [];
  const walk = (parent: string): void => {
    for (const n of outline.nodes) {
      if (n.parent === parent && !out.includes(n.id)) {
        out.push(n.id);
        walk(n.id);
      }
    }
  };
  walk(id);
  return out;
}

function find(outline: Outline, id: string): OutlineNode {
  const node = outline.nodes.find((n) => n.id === id);
  if (!node) {
    throw fail(
      "OUTLINE_NODE_NOT_FOUND",
      `no outline node ${id}`,
      "Call get_project to see the node ids.",
      { id },
    );
  }
  return node;
}

function place(
  nodes: OutlineNode[],
  node: OutlineNode,
  position: number | undefined,
): OutlineNode[] {
  const group = siblings(nodes, node.parent);
  const at = position === undefined ? group.length : Math.min(position - 1, group.length);
  group.splice(at, 0, node);
  const order = new Map(group.map((n, i) => [n.id, i + 1]));
  return [...nodes.filter((n) => n.id !== node.id), node].map((n) => ({
    ...n,
    order: order.get(n.id) ?? n.order,
  }));
}

export interface ApplyResult {
  outline: Outline;
  added: string[];
  /** Nodes removed by `remove` operations, including the subtrees. */
  removed: string[];
}

/** Applies operations in order to a copy. Throws on the first bad one, so a call is atomic. */
export function applyOps(
  start: Outline,
  ops: readonly OutlineOp[],
  newId: () => string = newNodeId,
): ApplyResult {
  let nodes = start.nodes.map((n) => ({ ...n }));
  const added: string[] = [];
  const removed: string[] = [];
  const view = (): Outline => ({ nodes });
  for (const op of ops) {
    switch (op.op) {
      case "add": {
        if (op.parent) find(view(), op.parent);
        const node: OutlineNode = {
          id: newId(),
          title: op.title,
          parent: op.parent,
          order: 0,
          ...(op.purpose ? { purpose: op.purpose } : {}),
          status: op.status ?? "idea",
          questions: op.questions ?? [],
        };
        nodes = place(nodes, node, op.position);
        added.push(node.id);
        break;
      }
      case "update": {
        const node = find(view(), op.id);
        const next: OutlineNode = {
          ...node,
          ...(op.title ? { title: op.title } : {}),
          ...(op.status ? { status: op.status } : {}),
          ...(op.questions ? { questions: op.questions } : {}),
        };
        if (op.purpose === null) delete next.purpose;
        else if (op.purpose !== undefined) next.purpose = op.purpose;
        nodes = nodes.map((n) => (n.id === op.id ? next : n));
        break;
      }
      case "move": {
        const node = find(view(), op.id);
        if (op.parent) {
          find(view(), op.parent);
          if (op.parent === op.id || descendants(view(), op.id).includes(op.parent)) {
            throw fail(
              "OUTLINE_CYCLE",
              `cannot move ${op.id} below itself or one of its own sections`,
              "Pick a parent outside the moved subtree.",
              { id: op.id, parent: op.parent },
            );
          }
        }
        const rest = nodes.filter((n) => n.id !== op.id);
        nodes = place(rest, { ...node, parent: op.parent }, op.position);
        break;
      }
      case "remove": {
        find(view(), op.id);
        const gone = new Set([op.id, ...descendants(view(), op.id)]);
        removed.push(...gone);
        nodes = nodes.filter((n) => !gone.has(n.id));
        break;
      }
    }
  }
  return { outline: normalize(view()), added, removed };
}

/** Resolves a node id or a computed number such as "3.1" to a node. */
export function resolveNode(outline: Outline, ref: string): NumberedNode {
  const all = numbered(outline);
  const hit = all.find((n) => n.id === ref || n.number === ref);
  if (!hit) {
    throw fail(
      "OUTLINE_NODE_NOT_FOUND",
      `no outline node '${ref}'`,
      "Call get_project and use a node id or a number from it.",
      { ref },
    );
  }
  return hit;
}
