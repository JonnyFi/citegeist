import type { GraphView, SemanticEdge, SemanticNode } from "@citegeist/ops";
import { MENTIONS } from "@citegeist/ops";
import type { CardKind } from "@citegeist/schema";
import Graph from "graphology";
import { circular } from "graphology-layout";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { RELATION_ORDER } from "../connections/model";

/** Relations in the order of the vocabulary, with plain wiki links last. */
export const GRAPH_RELATIONS: readonly string[] = [
  ...RELATION_ORDER.filter((r) => !["cites", "excerpt-of", "derived-from"].includes(r)),
  MENTIONS,
];

export const CARD_KINDS: readonly CardKind[] = [
  "thesis",
  "finding",
  "method",
  "definition",
  "example",
  "critique",
];

export type Dash = "solid" | "dashed" | "dotted";

/**
 * One look per relation, from the design tokens: contradiction red and dashed, support green and
 * solid. Relations of the same family share a colour and differ in the line.
 */
export const RELATION_STYLE: Record<string, { token: string; dash: Dash }> = {
  supports: { token: "--card-definition", dash: "solid" },
  opposes: { token: "--danger", dash: "dashed" },
  qualifies: { token: "--card-example", dash: "dashed" },
  addresses: { token: "--card-none", dash: "solid" },
  extends: { token: "--card-thesis", dash: "solid" },
  "uses-method-of": { token: "--card-method", dash: "solid" },
  "uses-data-from": { token: "--card-method", dash: "dashed" },
  elaborates: { token: "--muted", dash: "solid" },
  related: { token: "--muted", dash: "dashed" },
  [MENTIONS]: { token: "--line-faint", dash: "dotted" },
};

export function relationStyle(rel: string): { token: string; dash: Dash } {
  return RELATION_STYLE[rel] ?? { token: "--muted", dash: "solid" };
}

export interface GraphFilters {
  /** Relations to show; undefined shows all. */
  relations?: ReadonlySet<string> | undefined;
  kinds?: ReadonlySet<CardKind> | undefined;
  proposed: boolean;
  /** Slug of a text of the project. */
  text?: string | undefined;
}

export const NO_FILTERS: GraphFilters = { proposed: false };

/** Toggles a value in an optional set over `all`: a full set means no filter. */
export function toggleIn<T>(
  current: ReadonlySet<T> | undefined,
  all: readonly T[],
  value: T,
): Set<T> | undefined {
  const next = new Set(current ?? all);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next.size === all.length ? undefined : next;
}

export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** The short name a node carries on the canvas. */
export function nodeLabel(n: SemanticNode): string {
  if (n.kind === "item") return truncate(n.short ?? n.label, 28);
  if (n.kind === "card") return truncate(n.label, 34);
  return truncate(n.label, 30);
}

export interface Palette {
  ink: string;
  muted: string;
  faint: string;
  surface: string;
  colors: Record<string, string>;
}

const FALLBACK: Record<string, string> = {
  "--ink": "#141414",
  "--muted": "#5c5c5c",
  "--line-faint": "#c4c4c4",
  "--surface": "#ffffff",
  "--danger": "#8a2130",
  "--card-none": "#2f5fa8",
  "--card-thesis": "#5b3a9e",
  "--card-finding": "#8a2130",
  "--card-definition": "#5a6b12",
  "--card-method": "#1f6f8b",
  "--card-example": "#7a5c00",
  "--card-critique": "#141414",
};

/** The design tokens the graph uses, read from the document (they change with the theme). */
export function readPalette(read: (token: string) => string = () => ""): Palette {
  const colors: Record<string, string> = {};
  for (const token of Object.keys(FALLBACK)) colors[token] = read(token) || FALLBACK[token] || "";
  return {
    ink: colors["--ink"] ?? "#141414",
    muted: colors["--muted"] ?? "#5c5c5c",
    faint: colors["--line-faint"] ?? "#c4c4c4",
    surface: colors["--surface"] ?? "#ffffff",
    colors,
  };
}

export type Positions = Map<string, { x: number; y: number }>;

/** Positions of the visible nodes, stable between renders. */
export function layout(view: GraphView, previous: Positions = new Map()): Positions {
  const out: Positions = new Map();
  const base = view.nodes.filter((n) => n.kind !== "card");
  const graph = new Graph({ type: "undirected" });
  for (const n of base) graph.addNode(n.id, { x: 0, y: 0 });
  const itemOf = new Map(view.members.map((m) => [m.card, m.item]));
  const unit = (id: string) => itemOf.get(id) ?? id;
  for (const e of view.edges) {
    const [a, b] = [unit(e.from), unit(e.to)];
    if (a !== b && graph.hasNode(a) && graph.hasNode(b) && !graph.hasEdge(a, b))
      graph.addEdge(a, b);
  }
  const known = base.filter((n) => previous.has(n.id));
  if (graph.order > 1) {
    circular.assign(graph, { scale: 100 });
    for (const n of known) {
      const p = previous.get(n.id);
      if (p) graph.mergeNodeAttributes(n.id, { x: p.x, y: p.y, fixed: true });
    }
    // a new node starts next to the known nodes it links to, so it does not cross the map
    graph.forEachNode((id, attrs) => {
      if (attrs.fixed) return;
      const near = graph.neighbors(id).filter((m) => graph.getNodeAttribute(m, "fixed"));
      if (near.length === 0) return;
      const x = near.reduce((s, m) => s + graph.getNodeAttribute(m, "x"), 0) / near.length;
      const y = near.reduce((s, m) => s + graph.getNodeAttribute(m, "y"), 0) / near.length;
      graph.mergeNodeAttributes(id, { x: x + 12, y: y + 12 });
    });
    if (known.length < graph.order) {
      forceAtlas2.assign(graph, {
        iterations: 200,
        settings: {
          ...forceAtlas2.inferSettings(graph),
          barnesHutOptimize: false,
          gravity: 1,
          scalingRatio: 6,
          strongGravityMode: true,
        },
      });
    }
  }
  graph.forEachNode((id, attrs) => out.set(id, { x: attrs.x as number, y: attrs.y as number }));

  // cards on a ring around their source, in a fixed order
  const extent = Math.max(
    10,
    ...[...out.values()].map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))),
  );
  const byItem = new Map<string, string[]>();
  for (const m of view.members) byItem.set(m.item, [...(byItem.get(m.item) ?? []), m.card]);
  for (const [item, cards] of byItem) {
    const center = out.get(item) ?? { x: 0, y: 0 };
    const radius = extent * 0.28 * (1 + cards.length * 0.04);
    [...cards].sort().forEach((card, i) => {
      const angle = (2 * Math.PI * i) / cards.length - Math.PI / 2;
      out.set(card, {
        x: center.x + radius * Math.cos(angle),
        y: center.y + radius * Math.sin(angle),
      });
    });
  }
  return out;
}

export interface BuildOptions {
  palette: Palette;
  /** Relation and card count as a label, such as "widerspricht (1 Karte)". */
  edgeLabel: (e: SemanticEdge) => string;
  /** Edge labels stay visible only on calm graphs; otherwise they show on hover. */
  alwaysLabelled: (e: SemanticEdge) => boolean;
  selectedEdge?: string | undefined;
  focus?: string | undefined;
}

/** An open source with more cards than this names them only on hover. */
const CARD_LABEL_LIMIT = 8;

const DASH: Record<Dash, { dash: number; gap: number }> = {
  solid: { dash: 1, gap: 0 },
  dashed: { dash: 7, gap: 5 },
  dotted: { dash: 2, gap: 4 },
};

/** graphology graph for sigma: node size by card count, edges styled by relation. */
export function buildGraph(view: GraphView, positions: Positions, opts: BuildOptions): Graph {
  const { palette } = opts;
  const graph = new Graph({ multi: true, type: "directed" });
  const cardsShown = new Map<string, number>();
  for (const m of view.members) cardsShown.set(m.item, (cardsShown.get(m.item) ?? 0) + 1);
  for (const n of view.nodes) {
    const p = positions.get(n.id) ?? { x: 0, y: 0 };
    const color =
      n.kind === "card"
        ? (palette.colors[`--card-${n.cardKind ?? "none"}`] ?? palette.muted)
        : n.kind === "note"
          ? n.outside
            ? palette.faint
            : palette.muted
          : n.outside
            ? palette.faint
            : palette.ink;
    const size =
      n.kind === "item"
        ? Math.min(18, 6 + 2.4 * Math.sqrt(n.cards ?? 0))
        : n.kind === "note"
          ? 6
          : 4.5;
    graph.addNode(n.id, {
      label: nodeLabel(n),
      kind: n.kind,
      color,
      size: n.id === opts.focus ? size + 3 : size,
      // the cards of an open source are named, as long as they are few enough to read
      forceLabel: n.kind !== "card" || (cardsShown.get(n.item ?? "") ?? 0) <= CARD_LABEL_LIMIT,
      x: p.x,
      y: p.y,
    });
  }
  for (const m of view.members) {
    if (!graph.hasNode(m.card) || !graph.hasNode(m.item)) continue;
    graph.addEdge(m.card, m.item, {
      member: true,
      color: palette.faint,
      size: 0.6,
      dash: 1,
      gap: 0,
      solidColor: palette.faint,
      head: "none",
      label: "",
      hoverLabel: "",
    });
  }
  for (const e of view.edges) {
    if (!graph.hasNode(e.from) || !graph.hasNode(e.to)) continue;
    const style = relationStyle(e.rel);
    const line = DASH[style.dash];
    const selected = e.id === opts.selectedEdge;
    const weight =
      e.rel === MENTIONS ? 1.5 : Math.min(6, 3 + 0.8 * Math.max(0, e.evidence.length - 1));
    const label = opts.edgeLabel(e);
    const color = palette.colors[style.token] ?? palette.muted;
    const dash = e.status === "proposed" ? DASH.dotted : line;
    graph.addEdgeWithKey(e.id, e.from, e.to, {
      rel: e.rel,
      status: e.status,
      color,
      solidColor: dash.gap > 0 ? "rgba(0,0,0,0)" : color,
      size: selected ? weight + 1.5 : e.status === "proposed" ? 1.4 : weight,
      dash: dash.dash,
      gap: dash.gap,
      head: e.rel === MENTIONS ? "none" : "arrow",
      label: opts.alwaysLabelled(e) || selected ? label : "",
      hoverLabel: label,
    });
  }
  return graph;
}
