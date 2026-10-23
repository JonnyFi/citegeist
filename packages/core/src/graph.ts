import type { Library } from "./library.js";

type NodeKind = "item" | "card" | "note";

interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
}

interface GraphEdge {
  from: string;
  to: string;
  rel: string;
  status: string;
}

interface LinkRow {
  src_kind: NodeKind;
  src_ref: string;
  dst_kind: NodeKind;
  dst_ref: string;
  rel: string | null;
  status: string;
}

/** Relation shown for a plain `[[wiki link]]`, which carries no relation of its own. */
export const WIKI_RELATION = "mentions";

function describe(lib: Library, kind: NodeKind, ref: string): GraphNode | undefined {
  if (kind === "item") {
    const row = lib.index.get<{ title: string }>("SELECT title FROM items WHERE citekey = ?", ref);
    return row ? { id: ref, kind, label: row.title } : undefined;
  }
  if (kind === "card") {
    const row = lib.index.get<{ quote: string }>("SELECT quote FROM cards WHERE id = ?", ref);
    return row ? { id: ref, kind, label: row.quote.replace(/\s+/g, " ").slice(0, 80) } : undefined;
  }
  const row = lib.index.get<{ title: string }>("SELECT title FROM notes WHERE id = ?", ref);
  return row ? { id: ref, kind, label: row.title } : undefined;
}

/** Item citekey, card id, note id or note slug to the node it names. */
function resolveNode(lib: Library, node: string): { kind: NodeKind; ref: string } | undefined {
  if (lib.index.get("SELECT 1 AS found FROM items WHERE citekey = ?", node)) {
    return { kind: "item", ref: node };
  }
  if (lib.index.get("SELECT 1 AS found FROM cards WHERE id = ?", node)) {
    return { kind: "card", ref: node };
  }
  const note = lib.index.get<{ id: string }>(
    "SELECT id FROM notes WHERE id = ? OR slug = ?",
    node,
    node,
  );
  return note ? { kind: "note", ref: note.id } : undefined;
}

/**
 * graph.neighbors: walks the resolved links of the index (wiki links, typed links of notes and
 * the automatic card to item link) in both directions, breadth first, up to `depth` steps.
 * A node that does not exist gives an empty graph.
 */
export function neighbors(
  lib: Library,
  input: { node: string; depth: number; rel?: readonly string[] | undefined },
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const start = resolveNode(lib, input.node);
  const startNode = start ? describe(lib, start.kind, start.ref) : undefined;
  if (!start || !startNode) return { nodes: [], edges: [] };

  const nodes = new Map<string, GraphNode>([[`${start.kind}:${start.ref}`, startNode]]);
  const edges = new Map<string, GraphEdge>();
  let frontier = [start];
  for (let step = 0; step < input.depth && frontier.length > 0; step++) {
    const next: Array<{ kind: NodeKind; ref: string }> = [];
    for (const here of frontier) {
      const rows = lib.index.all<LinkRow>(
        `SELECT src_kind, src_ref, dst_kind, dst_ref, rel, status FROM resolved_links
         WHERE dst_kind IS NOT NULL
           AND ((src_kind = ? AND src_ref = ?) OR (dst_kind = ? AND dst_ref = ?))`,
        here.kind,
        here.ref,
        here.kind,
        here.ref,
      );
      for (const r of rows) {
        const rel = r.rel ?? WIKI_RELATION;
        if (input.rel && !input.rel.includes(rel)) continue;
        if (r.src_kind === r.dst_kind && r.src_ref === r.dst_ref) continue;
        const edgeKey = `${r.src_kind}:${r.src_ref}>${r.dst_kind}:${r.dst_ref}:${rel}`;
        if (edges.has(edgeKey)) continue;
        const ends = [
          { kind: r.src_kind, ref: r.src_ref },
          { kind: r.dst_kind, ref: r.dst_ref },
        ];
        const described = ends.map(
          (e) => nodes.get(`${e.kind}:${e.ref}`) ?? describe(lib, e.kind, e.ref),
        );
        if (described.some((d) => d === undefined)) continue;
        ends.forEach((e, i) => {
          const key = `${e.kind}:${e.ref}`;
          if (nodes.has(key)) return;
          nodes.set(key, described[i] as GraphNode);
          next.push(e);
        });
        edges.set(edgeKey, { from: r.src_ref, to: r.dst_ref, rel, status: r.status });
      }
    }
    frontier = next;
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
