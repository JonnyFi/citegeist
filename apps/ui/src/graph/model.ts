import Graph from "graphology";
import { circular } from "graphology-layout";
import forceAtlas2 from "graphology-layout-forceatlas2";
import {
  compareRelations,
  type GraphEdge,
  type GraphNode,
  type Neighbors,
  type NodeKind,
  relationKey,
} from "../connections/model";

export interface GraphFilters {
  /** Relation keys (see `relationKey`) that are switched off. */
  hiddenRelations: ReadonlySet<string>;
  hiddenKinds: ReadonlySet<NodeKind>;
  showProposed: boolean;
}

export const NO_FILTERS: GraphFilters = {
  hiddenRelations: new Set(),
  hiddenKinds: new Set(),
  showProposed: true,
};

/**
 * Applies the filters. The centre stays, other nodes stay only when a visible edge reaches them,
 * so switching a relation off does not leave loose dots behind.
 */
export function filterGraph(data: Neighbors, center: string, filters: GraphFilters): Neighbors {
  const kinds = new Map(data.nodes.map((n) => [n.id, n.kind]));
  const visibleNode = (id: string) => {
    const kind = kinds.get(id);
    return id === center || (kind !== undefined && !filters.hiddenKinds.has(kind));
  };
  const edges = data.edges.filter(
    (e) =>
      !filters.hiddenRelations.has(relationKey(e.rel)) &&
      (filters.showProposed || e.status !== "proposed") &&
      visibleNode(e.from) &&
      visibleNode(e.to),
  );
  const reached = new Set<string>([center]);
  for (const e of edges) {
    reached.add(e.from);
    reached.add(e.to);
  }
  return { nodes: data.nodes.filter((n) => reached.has(n.id) && visibleNode(n.id)), edges };
}

/** Relation keys present in the data with their edge counts, in vocabulary order. */
export function relationCounts(edges: readonly GraphEdge[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const e of edges) counts.set(relationKey(e.rel), (counts.get(relationKey(e.rel)) ?? 0) + 1);
  return [...counts.entries()].sort(([a], [b]) => compareRelations(a, b));
}

export function kindCounts(nodes: readonly GraphNode[]): Map<NodeKind, number> {
  const counts = new Map<NodeKind, number>();
  for (const n of nodes) counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
  return counts;
}

export interface GraphPalette {
  item: string;
  card: string;
  note: string;
  edge: string;
  proposed: string;
}

export const LIGHT_PALETTE: GraphPalette = {
  item: "#8a4b2a",
  card: "#6b7f3e",
  note: "#3f6f8f",
  edge: "#8f897d",
  proposed: "#c7bfae",
};

export const DARK_PALETTE: GraphPalette = {
  item: "#dba579",
  card: "#a8bd75",
  note: "#7fb0cf",
  edge: "#6f695e",
  proposed: "#4a463e",
};

/**
 * graphology graph for sigma: positions from a circular start refined by ForceAtlas2, the centre
 * larger than the rest. Several relations between the same two nodes stay separate edges.
 */
export function buildGraph(
  data: Neighbors,
  center: string,
  palette: GraphPalette = LIGHT_PALETTE,
): Graph {
  const graph = new Graph({ multi: true, type: "directed" });
  for (const n of data.nodes) {
    graph.addNode(n.id, {
      label: n.label.length > 44 ? `${n.label.slice(0, 43)}…` : n.label,
      kind: n.kind,
      color: palette[n.kind],
      size: n.id === center ? 14 : 9,
      x: 0,
      y: 0,
    });
  }
  for (const e of data.edges) {
    if (!graph.hasNode(e.from) || !graph.hasNode(e.to)) continue;
    graph.addEdge(e.from, e.to, {
      rel: e.rel,
      status: e.status,
      color: e.status === "proposed" ? palette.proposed : palette.edge,
      size: 1.5,
    });
  }
  if (graph.order > 1) {
    circular.assign(graph);
    if (graph.size > 0) {
      forceAtlas2.assign(graph, {
        iterations: 120,
        settings: { ...forceAtlas2.inferSettings(graph), barnesHutOptimize: false },
      });
    }
  }
  return graph;
}
