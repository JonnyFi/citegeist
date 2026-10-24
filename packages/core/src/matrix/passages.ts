import { existsSync } from "node:fs";
import { parseDocMd, readDocument } from "../ingest/documents.js";
import type { Library } from "../library.js";
import { lexicalScores, type SemanticRank } from "../planning/service.js";
import type { SearchHit, SearchInput } from "../search.js";

/** A stretch of an item the model may read and quote. */
export interface Passage {
  /** Block id or card id. */
  ref: string;
  kind: "block" | "card";
  /** Source file hash, for blocks. */
  source?: string;
  /** Printed page label where the passage starts; null when the document has no page marks. */
  page: string | null;
  /** Plain text, without Markdown marks or block ids. The model quotes this text. */
  text: string;
  /** Where inside `text` a new printed page begins. */
  marks: Array<{ offset: number; label: string }>;
}

export interface RetrievalDeps {
  /** Hybrid search of the runtime. Default: full-text search of the index. */
  search?: ((input: SearchInput) => Promise<SearchHit[]>) | undefined;
  /** Cosine similarity of texts to a query; absent while no embedding model is ready. */
  rank?: SemanticRank | undefined;
}

export interface RetrievalOptions {
  /** Passages handed to the model. Default 6. */
  limit?: number;
  /** Longest passage in characters. Default 1500. */
  maxChars?: number;
}

const BODY_TYPES = ["paragraph", "list-item", "quote", "table", "caption"];
const MIN_BLOCK_CHARS = 40;
/** Blocks taken from the full-text side before the semantic stage ranks them. */
const LEXICAL_POOL = 40;
const SEARCH_POOL = 100;
const SEMANTIC_FLOOR = 0.2;
const CARD_BONUS = 0.15;
const INNER_MARK = /<!--\s*p:(.*?)\s*-->/g;
const BLOCK_END = /\s\^b[0-9a-z]{6,12}\s*$/;
const HEADING = /^#{1,6}\s+/;

interface Candidate {
  ref: string;
  kind: "block" | "card";
  text: string;
  page: string | null;
  score: number;
}

/** Strips the Markdown the document file adds and records where inner page marks fall. */
function cleanUnit(text: string): { text: string; marks: Passage["marks"] } {
  const marks: Passage["marks"] = [];
  const noId = text.replace(BLOCK_END, "").replace(HEADING, "");
  let out = "";
  let last = 0;
  for (const m of noId.matchAll(INNER_MARK)) {
    out += noId.slice(last, m.index);
    marks.push({ offset: out.length, label: m[1] ?? "" });
    last = (m.index ?? 0) + m[0].length;
  }
  out += noId.slice(last);
  return { text: out, marks };
}

function cut(p: Passage, maxChars: number): Passage {
  if (p.text.length <= maxChars) return p;
  const at = p.text.lastIndexOf(" ", maxChars);
  const end = at > maxChars / 2 ? at : maxChars;
  return {
    ...p,
    text: p.text.slice(0, end),
    marks: p.marks.filter((m) => m.offset < end),
  };
}

/** The printed page of the text between two offsets: one label, or "from-to" across a page break. */
export function pageOfRange(p: Passage, start: number, end: number): string | null {
  const at = (offset: number): string | null => {
    let label = p.page;
    for (const m of p.marks) if (m.offset <= offset) label = m.label;
    return label;
  };
  const a = at(start);
  const b = at(Math.max(start, end - 1));
  return a !== null && b !== null && a !== b ? `${a}-${b}` : a;
}

/**
 * Passages of one item that bear on a question. Candidates are the item's body blocks that match
 * the question in full-text search, the hits of the runtime's hybrid search and the item's cards.
 * The semantic ranker, when a model is ready, orders them; without it the word match decides. The
 * chosen blocks are then read from the converted document, which supplies the printed page labels.
 */
export async function retrievePassages(
  lib: Library,
  citekey: string,
  query: string,
  deps: RetrievalDeps = {},
  opts: RetrievalOptions = {},
): Promise<Passage[]> {
  const limit = opts.limit ?? 6;
  const maxChars = opts.maxChars ?? 1500;
  const item = lib.getItem(citekey).frontmatter;
  const source = item.sources.find((s) => existsSync(lib.paths.docMd(citekey, s.hash)))?.hash;

  const cands = new Map<string, Candidate>();
  /** The opening body blocks, for a question the word match cannot reach (another language). */
  const opening: Candidate[] = [];
  if (source) {
    const rows = lib.index.all<{ id: string; text: string; page: string | null }>(
      `SELECT id, text, page FROM blocks
       WHERE citekey = ? AND source = ? AND flow = 'body' AND type IN (${BODY_TYPES.map(() => "?").join(",")})
       ORDER BY rowid`,
      citekey,
      source,
      ...BODY_TYPES,
    );
    const usable = rows.filter((r) => r.text.length >= MIN_BLOCK_CHARS);
    for (const r of usable.slice(0, limit)) {
      opening.push({ ref: r.id, kind: "block", text: r.text, page: r.page, score: 0 });
    }
    const lexical = lexicalScores(
      query,
      usable.map((r) => r.text),
    );
    usable
      .map((r, i) => ({ r, s: lexical[i] ?? 0 }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, LEXICAL_POOL)
      .forEach(({ r, s }) => {
        cands.set(`block:${r.id}`, {
          ref: r.id,
          kind: "block",
          text: r.text,
          page: r.page,
          score: s,
        });
      });
    const byId = new Map(usable.map((r) => [r.id, r]));
    const hits = await (deps.search ?? (async (i) => lib.search(i)))({
      q: query,
      kinds: ["block"],
      limit: SEARCH_POOL,
    }).catch(() => [] as SearchHit[]);
    for (const h of hits) {
      if (h.citekey !== citekey || h.kind !== "block") continue;
      const r = byId.get(h.id);
      if (r && !cands.has(`block:${r.id}`)) {
        cands.set(`block:${r.id}`, {
          ref: r.id,
          kind: "block",
          text: r.text,
          page: r.page,
          score: 0,
        });
      }
    }
  }

  for (const c of lib.listCards({ citekey, limit: 200 }).cards) {
    const loc = c.frontmatter.locator;
    cands.set(`card:${c.frontmatter.id}`, {
      ref: c.frontmatter.id,
      kind: "card",
      text: c.body.quote,
      page: loc ? (loc.end && loc.end !== loc.start ? `${loc.start}-${loc.end}` : loc.start) : null,
      score: 0,
    });
  }

  const list = [...cands.values()];
  const texts = list.map((c) => c.text);
  const semantic =
    list.length > 0 ? await deps.rank?.(query, texts).catch(() => undefined) : undefined;
  const lexicalAll = semantic ? undefined : lexicalScores(query, texts);
  let ranked = list
    .map((c, i) => {
      const base = semantic ? (semantic[i] ?? 0) : (lexicalAll?.[i] ?? 0);
      return { c, s: base + (c.kind === "card" && base > 0 ? CARD_BONUS : 0) };
    })
    .filter((x) => x.s > (semantic ? SEMANTIC_FLOOR : 0))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit);
  // Without a semantic model the word match cannot bridge languages. Then the cards and the
  // opening of the document go to the model, which answers with nothing when they do not fit.
  if (ranked.length === 0 && !semantic) {
    const cards = list.filter((c) => c.kind === "card");
    ranked = [...cards, ...opening].slice(0, limit).map((c) => ({ c, s: 0 }));
  }
  if (ranked.length === 0) return [];

  const blockIds = ranked.filter((x) => x.c.kind === "block").map((x) => x.c.ref);
  const read = new Map<string, { text: string; marks: Passage["marks"]; page: string | null }>();
  if (source && blockIds.length > 0) {
    try {
      const doc = readDocument(lib, { citekey, blocks: blockIds, maxChars: 200_000 });
      for (const u of parseDocMd(doc.markdown)) {
        if (!u.blockId) continue;
        const clean = cleanUnit(u.text);
        read.set(u.blockId, {
          ...clean,
          page: u.page === undefined || u.page === "" ? null : u.page,
        });
      }
    } catch {
      // The document changed under us (ids move after a re-conversion): use the indexed text.
    }
  }

  return ranked.map(({ c }) => {
    const slice = c.kind === "block" ? read.get(c.ref) : undefined;
    return cut(
      {
        ref: c.ref,
        kind: c.kind,
        ...(c.kind === "block" && source ? { source } : {}),
        page: slice ? slice.page : c.page,
        text: slice ? slice.text : c.text,
        marks: slice ? slice.marks : [],
      },
      maxChars,
    );
  });
}
