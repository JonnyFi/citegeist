import { existsSync, readFileSync } from "node:fs";
import { aggregateGraph, buildSemanticGraph, type GraphLibrary } from "@citegeist/ops";
import { type CardKind, CitegeistError, citedKeys, type NoteFrontmatter } from "@citegeist/schema";
import { MarkdownFile } from "./frontmatter.js";
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

interface NoteRow {
  id: string;
  slug: string;
  type: NoteFrontmatter["type"];
  title: string;
  frontmatter_json: string;
}

interface ResolvedRow {
  src_kind: NodeKind;
  src_ref: string;
  dst_kind: NodeKind;
  dst_ref: string;
  rel: string | null;
  status: string;
  why: string | null;
  evidence: string | null;
  actor: string | null;
  origin: string;
}

/** The rows of the index in the plain shape `buildSemanticGraph` reads. Inbox items stay out. */
export function graphLibrary(lib: Library): GraphLibrary {
  const projects = new Map<string, string[]>();
  for (const r of lib.index.all<{ ref: string; project: string }>(
    "SELECT ref, project FROM project_members WHERE kind = 'item'",
  )) {
    projects.set(r.ref, [...(projects.get(r.ref) ?? []), r.project]);
  }
  const items = lib.index
    .all<{ citekey: string; title: string; year: string | null; authors: string | null }>(
      "SELECT citekey, title, year, authors FROM items WHERE inbox = 0",
    )
    .map((r) => ({
      citekey: r.citekey,
      title: r.title,
      short: [r.authors, r.year].filter(Boolean).join(" ") || undefined,
      projects: projects.get(r.citekey) ?? [],
    }));
  const known = new Set(items.map((i) => i.citekey));
  const cards = lib.index
    .all<{ id: string; citekey: string; kind: string | null; quote: string; fm: string }>(
      "SELECT id, citekey, kind, quote, frontmatter_json AS fm FROM cards",
    )
    .filter((r) => known.has(r.citekey))
    .map((r) => {
      const fm = JSON.parse(r.fm) as { locator?: { start?: string } };
      return {
        id: r.id,
        item: r.citekey,
        kind: (r.kind ?? undefined) as CardKind | undefined,
        quote: r.quote,
        page: fm.locator?.start,
      };
    });
  const notes = lib.index
    .all<NoteRow>("SELECT id, slug, type, title, frontmatter_json FROM notes")
    .map((r) => {
      const fm = JSON.parse(r.frontmatter_json) as {
        projects?: string[];
        created?: { by?: string };
      };
      return {
        id: r.id,
        slug: r.slug,
        type: r.type,
        title: r.title,
        projects: fm.projects ?? [],
        by: fm.created?.by,
      };
    });
  const links = lib.index
    .all<ResolvedRow>(
      `SELECT src_kind, src_ref, dst_kind, dst_ref, rel, status, why, evidence, actor, origin
       FROM resolved_links WHERE dst_kind IS NOT NULL`,
    )
    .map((r) => ({
      srcKind: r.src_kind,
      src: r.src_ref,
      toKind: r.dst_kind,
      to: r.dst_ref,
      rel: r.rel,
      status: r.status,
      why: r.why,
      evidence: r.evidence,
      by: r.actor,
      origin: r.origin,
    }));
  return { items, cards, notes, links, noteBody: (id) => lib.getNote(id).body };
}

function textNotFound(project: string, text: string): CitegeistError {
  return new CitegeistError({
    code: "TEXT_NOT_FOUND",
    message: `project '${project}' has no text '${text}'`,
    fix: "Call texts.list for the texts of the project.",
    recovery: "fix-and-retry",
    sideEffects: "none",
    context: { project, text },
  });
}

/** Citekeys cited in a text of a project. */
function citedIn(lib: Library, project: string, text: string): string[] {
  const path = lib.paths.abs(`projects/${project}/texts/${text}.md`);
  if (!existsSync(path)) throw textNotFound(project, text);
  return citedKeys(MarkdownFile.parse(readFileSync(path, "utf8")).body);
}

/**
 * graph.project: the semantic graph of a project, of the library or around one node, with the
 * edges between sources (cards collapsed unless their source is in `expand`).
 */
export function projectGraph(
  lib: Library,
  input: {
    project?: string | undefined;
    text?: string | undefined;
    around?: string | undefined;
    depth: number;
    expand: readonly string[];
    proposed: boolean;
  },
) {
  if (input.project) lib.getProject(input.project);
  if (input.text && !input.project) {
    throw new CitegeistError({
      code: "INVALID_INPUT",
      message: "a text filter needs the project of the text",
      fix: "Pass project together with text.",
      recovery: "fix-and-retry",
      sideEffects: "none",
      context: { text: input.text },
    });
  }
  const cited = input.project && input.text ? citedIn(lib, input.project, input.text) : undefined;
  const graph = buildSemanticGraph(graphLibrary(lib), {
    project: input.around ? undefined : input.project,
    cited: input.around ? undefined : cited,
    around: input.around,
    depth: input.depth,
    proposed: input.proposed,
  });
  const { edges } = aggregateGraph(graph, { expanded: input.expand });
  return { ...graph, edges };
}
