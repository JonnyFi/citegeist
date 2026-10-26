import type { CardKind, NoteFrontmatter } from "@citegeist/schema";
import type {
  ExplanationNote,
  SemanticEdge,
  SemanticLink,
  SemanticNode,
} from "./contracts/index.js";

/**
 * The semantic graph of a project or the library (docs/decisions/0031-project-graph.md). The
 * core and the mock core of the UI gather the same plain rows and hand them to
 * `buildSemanticGraph`, so the rules for containers, explanation notes and scope live once.
 * `aggregateGraph` folds cards into their source; the UI calls it again when a source opens.
 */

/** Relation of a wiki link, and of a typed link that names no relation. */
export const MENTIONS = "mentions";

/** Notes with a thought of their own. Literature, project and daily notes are no nodes. */
export const NODE_NOTE_TYPES: readonly NoteType[] = ["permanent", "claim", "concept", "question"];

type Kind = "item" | "card" | "note";
type NoteType = NoteFrontmatter["type"];

export interface GraphLibraryItem {
  citekey: string;
  title: string;
  short?: string | undefined;
  projects: readonly string[];
}

export interface GraphLibraryCard {
  id: string;
  item: string;
  kind?: CardKind | undefined;
  quote: string;
  page?: string | undefined;
}

export interface GraphLibraryNote {
  id: string;
  slug: string;
  type: NoteType;
  title: string;
  projects: readonly string[];
  /** The body; when absent, `GraphLibrary.noteBody` reads it on demand. */
  body?: string | undefined;
  by?: string | undefined;
}

/** A link as the index holds it, with its target already resolved to an id. */
export interface GraphLibraryLink {
  srcKind: Kind;
  src: string;
  toKind: Kind;
  to: string;
  rel?: string | null | undefined;
  status: string;
  why?: string | null | undefined;
  /** Target of the `evidence` wiki link, if any. */
  evidence?: string | null | undefined;
  by?: string | null | undefined;
  /** "frontmatter" for typed links, "wiki" for body links; "auto" (card to item) is skipped. */
  origin: string;
}

export interface GraphLibrary {
  items: readonly GraphLibraryItem[];
  cards: readonly GraphLibraryCard[];
  notes: readonly GraphLibraryNote[];
  links: readonly GraphLibraryLink[];
  /** Reads a note body that the rows do not carry. Only literature and explanation notes need it. */
  noteBody?: ((id: string) => string) | undefined;
}

export interface SemanticGraphOptions {
  project?: string | undefined;
  /** Citekeys cited in the chosen text. Only these sources and their cards stay. */
  cited?: readonly string[] | undefined;
  around?: string | undefined;
  depth?: number | undefined;
  proposed?: boolean | undefined;
}

export interface SemanticGraph {
  nodes: SemanticNode[];
  links: SemanticLink[];
  explanations: ExplanationNote[];
}

const ITEM_LINE = /^Item:\s*\[\[([^\]|#]+)/m;
const WIKI = /\[\[([^\]|#]+)/g;

function collapse(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** The start of a note body as plain text: no headings, no wiki brackets, no embeds. */
export function noteExcerpt(
  body: string,
  max = 280,
  name: (target: string) => string | undefined = () => undefined,
): string {
  const text = body
    .split("\n")
    .filter((line) => !/^\s*#/.test(line) && !/^\s*!\[\[/.test(line))
    .join(" ")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, (_, target: string) => name(target.trim()) ?? target)
    .replace(/[*_`]/g, "");
  return collapse(text, max);
}

/**
 * Builds the semantic graph. Rules, in the order they apply:
 * - A literature note that names an item (on an `Item: [[citekey]]` line, else through its first
 *   wiki link to an item) is a container of that item. It is no node; its links start at the
 *   card named in `from`, else at the item.
 * - Notes of the types in NODE_NOTE_TYPES are nodes. Other notes are left out.
 * - A note explains a typed link when the link's `why` names it, or when the note's own links
 *   reach both ends (a card end also through its source). A note whose links all stay within the
 *   ends of the links it explains, and which nothing else links to, is absorbed: it is no node and
 *   shows only as the explanation of those links.
 * - Scope: the sources of the project and their cards, the project's notes and the notes that link
 *   to them. Ends outside the scope come along, marked `outside`. With `cited` the cited sources
 *   are the scope, and links keep only cited ends. With `around` the scope is everything within
 *   `depth` steps of that node, where a source and its cards count as one step.
 */
export function buildSemanticGraph(
  lib: GraphLibrary,
  opts: SemanticGraphOptions = {},
): SemanticGraph {
  const items = new Map(lib.items.map((i) => [i.citekey, i]));
  const cards = new Map(lib.cards.map((c) => [c.id, c]));
  const notes = new Map(lib.notes.map((n) => [n.id, n]));
  const noteBySlug = new Map(lib.notes.map((n) => [n.slug, n.id]));
  const bodyOf = (n: GraphLibraryNote) => n.body ?? lib.noteBody?.(n.id) ?? "";
  const cardCount = new Map<string, number>();
  for (const c of lib.cards) cardCount.set(c.item, (cardCount.get(c.item) ?? 0) + 1);

  // Containers: literature notes folded into their item.
  const container = new Map<string, string>();
  for (const n of lib.notes) {
    if (n.type !== "literature") continue;
    const named = ITEM_LINE.exec(bodyOf(n))?.[1]?.trim();
    const first = lib.links.find(
      (l) => l.srcKind === "note" && l.src === n.id && l.origin === "wiki" && l.toKind === "item",
    )?.to;
    const item = named && items.has(named) ? named : first;
    if (item) container.set(n.id, item);
  }
  const isNodeNote = (id: string) => {
    const n = notes.get(id);
    return n !== undefined && !container.has(id) && NODE_NOTE_TYPES.includes(n.type);
  };
  const kindOf = (id: string): Kind | undefined =>
    items.has(id) ? "item" : cards.has(id) ? "card" : notes.has(id) ? "note" : undefined;
  const sourceOf = (id: string) => cards.get(id)?.item;

  /** Normalizes an end: containers become their item; notes without a thought drop out. */
  const end = (kind: Kind, id: string): string | undefined => {
    if (kind === "note") {
      const item = container.get(id);
      if (item) return item;
      return isNodeNote(id) ? id : undefined;
    }
    if (kind === "item") return items.has(id) ? id : undefined;
    return cards.has(id) ? id : undefined;
  };

  // Links, normalized and merged.
  const links = new Map<string, SemanticLink>();
  /** Targets each node note reaches through its own links, before absorption. */
  const reach = new Map<string, Set<string>>();
  for (const l of lib.links) {
    if (l.origin === "auto" || l.status === "rejected") continue;
    if (l.status === "proposed" && !opts.proposed) continue;
    const from = end(l.srcKind, l.src);
    const to = end(l.toKind, l.to);
    const evidence = l.evidence && cards.has(l.evidence) ? l.evidence : undefined;
    if (from && l.srcKind === "note" && isNodeNote(from)) {
      const set = reach.get(from) ?? new Set<string>();
      if (to) set.add(to);
      if (evidence) set.add(evidence);
      reach.set(from, set);
    }
    if (!from || !to || from === to) continue;
    if (sourceOf(from) === to && (l.rel ?? MENTIONS) === MENTIONS) continue;
    const rel = l.rel ?? MENTIONS;
    const id = `${from}>${to}:${rel}`;
    const ev = [...new Set([cards.has(from) ? from : undefined, evidence].filter(isString))];
    const status = l.status === "proposed" ? "proposed" : "accepted";
    const known = links.get(id);
    if (known) {
      known.evidence = [...new Set([...known.evidence, ...ev])];
      if (status === "accepted") known.status = "accepted";
      if (!known.why && l.why) known.why = l.why;
      continue;
    }
    links.set(id, {
      id,
      from,
      to,
      rel,
      status,
      ...(l.why ? { why: l.why } : {}),
      ...(l.by ? { by: l.by } : {}),
      evidence: ev,
      notes: [],
    });
  }

  // Explanation notes.
  const sides = (id: string) => new Set([id, sourceOf(id)].filter(isString));
  const explains = new Map<string, SemanticLink[]>();
  for (const link of links.values()) {
    if (link.rel === MENTIONS) continue;
    const named = new Set<string>();
    for (const m of (link.why ?? "").matchAll(WIKI)) {
      const target = (m[1] ?? "").trim();
      const id = notes.has(target) ? target : noteBySlug.get(target);
      if (id && isNodeNote(id)) named.add(id);
    }
    const fromSide = sides(link.from);
    const toSide = sides(link.to);
    for (const [note, targets] of reach) {
      if (note === link.from || note === link.to) continue;
      const touches = (side: Set<string>) => [...side].some((s) => targets.has(s));
      if (named.has(note) || (touches(fromSide) && touches(toSide))) named.add(note);
    }
    for (const note of named) {
      link.notes.push(note);
      explains.set(note, [...(explains.get(note) ?? []), link]);
    }
  }
  const absorbed = new Set<string>();
  const linkedTo = new Set([...links.values()].map((l) => l.to));
  for (const [note, explained] of explains) {
    const allowed = new Set<string>();
    for (const l of explained) {
      for (const s of [...sides(l.from), ...sides(l.to)]) allowed.add(s);
    }
    const targets = reach.get(note) ?? new Set<string>();
    if (!linkedTo.has(note) && [...targets].every((t) => allowed.has(t))) absorbed.add(note);
  }
  for (const [id, l] of links) {
    if (absorbed.has(l.from) || absorbed.has(l.to)) links.delete(id);
  }

  // Scope.
  const inScope = new Set<string>();
  const notesInScope = (touching: (id: string) => boolean) => {
    const eligible = (id: string) => isNodeNote(id) && !absorbed.has(id);
    for (const n of lib.notes) {
      if (opts.project !== undefined && n.projects.includes(opts.project) && eligible(n.id)) {
        inScope.add(n.id);
      }
    }
    for (const l of links.values()) {
      if (eligible(l.from) && touching(l.to)) inScope.add(l.from);
      if (eligible(l.to) && touching(l.from)) inScope.add(l.to);
    }
  };
  let kept: SemanticLink[];
  if (opts.around !== undefined) {
    const startKind = kindOf(opts.around);
    const start = startKind ? end(startKind, opts.around) : undefined;
    if (!start || absorbed.has(start)) return { nodes: [], links: [], explanations: [] };
    const unit = (id: string) => sourceOf(id) ?? id;
    const reached = new Set([unit(start)]);
    let frontier = [unit(start)];
    for (let step = 0; step < (opts.depth ?? 2) && frontier.length > 0; step++) {
      const next: string[] = [];
      for (const l of links.values()) {
        for (const [a, b] of [
          [unit(l.from), unit(l.to)],
          [unit(l.to), unit(l.from)],
        ] as const) {
          if (frontier.includes(a) && !reached.has(b)) {
            reached.add(b);
            next.push(b);
          }
        }
      }
      frontier = next;
    }
    for (const id of reached) inScope.add(id);
    for (const c of lib.cards) if (reached.has(c.item)) inScope.add(c.id);
    kept = [...links.values()].filter((l) => reached.has(unit(l.from)) && reached.has(unit(l.to)));
  } else {
    const cited = opts.cited ? new Set(opts.cited) : undefined;
    for (const i of lib.items) {
      const member = opts.project === undefined || i.projects.includes(opts.project);
      // a text may cite a source that is not in the project, and it is part of the text all the same
      if (cited ? cited.has(i.citekey) : member) inScope.add(i.citekey);
    }
    for (const c of lib.cards) if (inScope.has(c.item)) inScope.add(c.id);
    if (cited) {
      const citedEnd = (id: string) => (kindOf(id) === "note" ? true : inScope.has(id));
      kept = [...links.values()].filter((l) => citedEnd(l.from) && citedEnd(l.to));
      const material = (id: string) => kindOf(id) !== "note" && inScope.has(id);
      for (const l of kept) {
        if (kindOf(l.from) === "note" && material(l.to)) inScope.add(l.from);
        if (kindOf(l.to) === "note" && material(l.from)) inScope.add(l.to);
      }
      kept = kept.filter((l) => inScope.has(l.from) && inScope.has(l.to));
    } else {
      if (opts.project === undefined) {
        for (const n of lib.notes) if (isNodeNote(n.id) && !absorbed.has(n.id)) inScope.add(n.id);
      } else {
        const material = new Set(inScope);
        notesInScope((id) => material.has(id));
      }
      kept = [...links.values()].filter((l) => inScope.has(l.from) || inScope.has(l.to));
    }
  }

  // Nodes: everything in scope, and the ends outside it.
  const nodes = new Map<string, SemanticNode>();
  const addNode = (id: string, outside: boolean) => {
    if (nodes.has(id)) return;
    const flag = outside ? { outside: true } : {};
    const item = items.get(id);
    if (item) {
      nodes.set(id, {
        id,
        kind: "item",
        label: item.title,
        ...(item.short ? { short: item.short } : {}),
        cards: cardCount.get(id) ?? 0,
        ...flag,
      });
      return;
    }
    const card = cards.get(id);
    if (card) {
      addNode(card.item, outside && !inScope.has(card.item));
      nodes.set(id, {
        id,
        kind: "card",
        label: collapse(card.quote, 240),
        item: card.item,
        ...(card.kind ? { cardKind: card.kind } : {}),
        ...(card.page ? { page: card.page } : {}),
        ...flag,
      });
      return;
    }
    const note = notes.get(id);
    if (note) {
      nodes.set(id, { id, kind: "note", label: note.title, noteType: note.type, ...flag });
    }
  };
  for (const id of inScope) addNode(id, false);
  for (const l of kept) {
    addNode(l.from, !inScope.has(l.from));
    addNode(l.to, !inScope.has(l.to));
  }

  const explanationIds = new Set(kept.flatMap((l) => l.notes));
  const explanations: ExplanationNote[] = [...explanationIds].flatMap((id) => {
    const n = notes.get(id);
    if (!n) return [];
    return [
      {
        id: n.id,
        title: n.title,
        excerpt: noteExcerpt(bodyOf(n), 280, (target) => {
          const item = items.get(target);
          if (item) return item.short ?? item.title;
          const note = notes.get(noteBySlug.get(target) ?? target);
          return note?.title;
        }),
        ...(n.by ? { by: n.by } : {}),
        absorbed: absorbed.has(n.id),
      },
    ];
  });

  return {
    nodes: sortNodes([...nodes.values()]),
    links: kept.sort((a, b) => a.id.localeCompare(b.id)),
    explanations,
  };
}

function isString(v: string | undefined): v is string {
  return typeof v === "string";
}

const KIND_ORDER: Record<SemanticNode["kind"], number> = { item: 0, note: 1, card: 2 };

function sortNodes(nodes: SemanticNode[]): SemanticNode[] {
  return nodes.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id.localeCompare(b.id));
}

export interface AggregateOptions {
  /** Sources whose cards are nodes of their own. */
  expanded?: Iterable<string> | undefined;
  /** Relations to show. Undefined shows all. */
  relations?: ReadonlySet<string> | undefined;
  /** Card kinds to show. Undefined shows all; links that rest on cards need one of these kinds. */
  kinds?: ReadonlySet<CardKind> | undefined;
}

export interface GraphView {
  nodes: SemanticNode[];
  edges: SemanticEdge[];
  /** Card to source, for the cards of expanded sources. */
  members: Array<{ card: string; item: string }>;
}

/**
 * Folds the links of a semantic graph into edges between the visible nodes. A card is visible
 * only when its source is expanded; otherwise its links attach to the source. Links between the
 * same two nodes with the same relation become one edge. Without filters every source and note
 * stays visible; with a relation or kind filter only nodes that keep an edge stay.
 */
export function aggregateGraph(
  graph: Pick<SemanticGraph, "nodes" | "links">,
  opts: AggregateOptions = {},
): GraphView {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const expanded = new Set(opts.expanded ?? []);
  const kindOk = (card: SemanticNode) =>
    !opts.kinds || (card.cardKind !== undefined && opts.kinds.has(card.cardKind));
  const endOf = (id: string): string | undefined => {
    const node = byId.get(id);
    if (!node) return undefined;
    if (node.kind !== "card" || !node.item) return id;
    return expanded.has(node.item) ? id : node.item;
  };

  const edges = new Map<string, SemanticEdge>();
  for (const l of graph.links) {
    if (opts.relations && !opts.relations.has(l.rel)) continue;
    if (opts.kinds && l.evidence.length > 0) {
      const cards = l.evidence.flatMap((id) => {
        const n = byId.get(id);
        return n ? [n] : [];
      });
      if (!cards.some(kindOk)) continue;
    }
    const from = endOf(l.from);
    const to = endOf(l.to);
    if (!from || !to || from === to) continue;
    const id = `${from}>${to}:${l.rel}`;
    const known = edges.get(id);
    if (known) {
      known.links.push(l.id);
      known.evidence = [...new Set([...known.evidence, ...l.evidence])];
      known.notes = [...new Set([...known.notes, ...l.notes])];
      if (l.status === "accepted") known.status = "accepted";
      continue;
    }
    edges.set(id, {
      id,
      from,
      to,
      rel: l.rel,
      status: l.status,
      links: [l.id],
      evidence: [...l.evidence],
      notes: [...l.notes],
    });
  }

  const filtering = opts.relations !== undefined || opts.kinds !== undefined;
  const ends = new Set<string>();
  for (const e of edges.values()) {
    ends.add(e.from);
    ends.add(e.to);
  }
  const visible = graph.nodes.filter((n) => {
    if (n.kind === "card") {
      if (!n.item || !expanded.has(n.item)) return false;
      return ends.has(n.id) || kindOk(n);
    }
    if (ends.has(n.id)) return true;
    if (n.kind === "item" && expanded.has(n.id)) return true;
    return !filtering && !n.outside;
  });
  const shown = new Set(visible.map((n) => n.id));
  const members = visible.flatMap((n) =>
    n.kind === "card" && n.item && shown.has(n.item) ? [{ card: n.id, item: n.item }] : [],
  );
  return {
    nodes: visible,
    edges: [...edges.values()].filter((e) => shown.has(e.from) && shown.has(e.to)),
    members,
  };
}
