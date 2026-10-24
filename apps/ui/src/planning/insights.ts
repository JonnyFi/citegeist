import { scanWikiLinks } from "@citegeist/editor";
import type { InsightHit, NumberedNode } from "@citegeist/ops";
import { subtreeIds } from "./outline";

/** Block id at the end of an insight paragraph: `^i-01JC5Q2M8T`. */
const BLOCK = /\s*\^(i-[0-9A-HJKMNP-TV-Z]{10})\s*$/;
const DATE = /^(\d{4}-\d{2}-\d{2}):\s*/;

export interface InsightParagraph {
  block: string;
  date?: string;
  /** Paragraph without the date and the block id. */
  text: string;
}

/** The insight paragraphs of a Markdown file: blank-line separated, ending in a block id. */
export function parseInsights(body: string): InsightParagraph[] {
  const out: InsightParagraph[] = [];
  for (const chunk of body.split(/\n\s*\n/)) {
    const trimmed = chunk.trim();
    const block = BLOCK.exec(trimmed);
    if (!block?.[1]) continue;
    const withoutBlock = trimmed.slice(0, block.index).trim();
    const date = DATE.exec(withoutBlock);
    out.push({
      block: block[1],
      ...(date?.[1] ? { date: date[1] } : {}),
      text: date ? withoutBlock.slice(date[0].length) : withoutBlock,
    });
  }
  return out;
}

/** What to show of a hit: the paragraph without a leading date and without the block id. */
export function insightText(hit: Pick<InsightHit, "text">): string {
  return hit.text.replace(BLOCK, "").replace(DATE, "").trim();
}

/** Targets of the wiki links in a text, once each, in order. */
export function linkTargets(text: string): string[] {
  return [...new Set(scanWikiLinks(text).map((m) => m.target))];
}

export type InsightPlace =
  | { kind: "node"; node: NumberedNode }
  | { kind: "plan" }
  | { kind: "project" };

/**
 * Where an insight lives: the node whose document holds it (a chapter document also serves its
 * sections), the planning document or the project's insights file.
 */
export function placeOf(path: string, nodes: readonly NumberedNode[]): InsightPlace {
  const node = nodes.find((n) => n.doc === path);
  if (node) return { kind: "node", node };
  if (path.endsWith("/plan.md")) return { kind: "plan" };
  return { kind: "project" };
}

/** Nodes an insight is about: its document's node plus every node it links as `[[k_...]]`. */
export function nodesOfInsight(
  hit: Pick<InsightHit, "path" | "text">,
  nodes: readonly NumberedNode[],
): NumberedNode[] {
  const out = new Map<string, NumberedNode>();
  const home = nodes.find((n) => n.doc === hit.path);
  if (home) out.set(home.id, home);
  for (const target of linkTargets(hit.text)) {
    const node = nodes.find((n) => n.id === target);
    if (node) out.set(node.id, node);
  }
  return [...out.values()];
}

export interface Gap {
  node: NumberedNode;
  noSources: boolean;
  noInsights: boolean;
}

/**
 * Nodes without sources or without insights. A node has a source when its document or the document
 * of a section below it links an item, and an insight when a paragraph sits in such a document or
 * links the node.
 */
export function findGaps(input: {
  nodes: readonly NumberedNode[];
  /** Text of the document of each node by node id; missing for nodes without a document. */
  docs: ReadonlyMap<string, string>;
  hits: readonly Pick<InsightHit, "path" | "text">[];
  /** Citekeys of the library, to tell an item link from a note or card link. */
  citekeys: ReadonlySet<string>;
}): Gap[] {
  const withInsight = new Set<string>();
  for (const hit of input.hits) {
    for (const n of nodesOfInsight(hit, input.nodes)) withInsight.add(n.id);
  }
  const out: Gap[] = [];
  for (const node of input.nodes) {
    const below = subtreeIds(input.nodes, node.id);
    const noSources = ![...below].some((id) =>
      linkTargets(input.docs.get(id) ?? "").some((t) => input.citekeys.has(t)),
    );
    const noInsights = ![...below].some((id) => withInsight.has(id));
    if (noSources || noInsights) out.push({ node, noSources, noInsights });
  }
  return out;
}
