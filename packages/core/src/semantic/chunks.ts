import { createHash } from "node:crypto";
import type { Index } from "../index-db.js";
import { HeadingTracker } from "./heading-path.js";

/** Longest chunk in characters: about 400 tokens of German text, below the 512 token limit. */
export const MAX_CHUNK_CHARS = 1600;
/** Chunks shorter than this carry too little meaning to embed (bare headings, page numbers). */
export const MIN_CHUNK_CHARS = 24;
/** A note or item body is cut after this many chunks. */
export const MAX_CHUNKS_PER_DOC = 24;

export interface Chunk {
  path: string;
  kind: string;
  ref: string;
  citekey: string | null;
  seq: number;
  /** The chunk's own text, shown as the snippet. */
  text: string;
  /**
   * What the model reads: the title of a note or item, or the path of headings above a block,
   * then the text.
   */
  input: string;
  /** Hash of `input` together with the model id; equal hashes mean the stored vector is current. */
  hash: string;
}

/** Cuts a body into pieces of at most `max` characters, at paragraph or sentence borders. */
export function splitBody(body: string, max = MAX_CHUNK_CHARS): string[] {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
  const pieces: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= max) {
      pieces.push(p);
      continue;
    }
    let rest = p;
    while (rest.length > max) {
      const window = rest.slice(0, max);
      const cut = Math.max(
        window.lastIndexOf(". "),
        window.lastIndexOf("! "),
        window.lastIndexOf("? "),
        window.lastIndexOf("\n"),
      );
      const at = cut > max / 2 ? cut + 1 : Math.max(window.lastIndexOf(" "), max / 2);
      pieces.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) pieces.push(rest);
  }
  // Merge neighbours while they fit, so a note of many short lines becomes few chunks.
  const merged: string[] = [];
  for (const p of pieces) {
    const last = merged[merged.length - 1];
    if (last !== undefined && last.length + 2 + p.length <= max) {
      merged[merged.length - 1] = `${last}\n\n${p}`;
    } else {
      merged.push(p);
    }
  }
  return merged;
}

export function chunkHash(modelId: string, input: string): string {
  return createHash("sha256").update(modelId).update("\0").update(input).digest("hex").slice(0, 32);
}

interface DocRow {
  path: string;
  kind: string;
  ref: string;
  citekey: string | null;
  doc_title: string;
  fts_title: string;
  body: string;
}

/** Path of headings for every body block, keyed by `citekey \0 source:id`. */
function headingPaths(index: Index): Map<string, string> {
  const out = new Map<string, string>();
  let group = "";
  let tracker = new HeadingTracker();
  for (const b of index.all<{
    citekey: string;
    source: string;
    id: string;
    type: string;
    sec: string | null;
    text: string;
  }>(
    "SELECT citekey, source, id, type, sec, text FROM blocks WHERE flow = 'body' ORDER BY rowid",
  )) {
    const g = `${b.citekey}\0${b.source}`;
    if (g !== group) {
      group = g;
      tracker = new HeadingTracker();
    }
    const path = tracker.next(b);
    if (path) out.set(`${b.citekey}\0${b.source}:${b.id}`, path);
  }
  return out;
}

/** The line above a chunk's text: the title of a note or item, the heading path of a block. */
function leadOf(r: DocRow, path: string, text: string): string {
  if (r.kind === "block") {
    // A heading block is the last element of its own path; it does not need to say it twice.
    const own = text.trim();
    return (path.endsWith(own) ? path.slice(0, path.length - own.length) : path).replace(
      / > $/,
      "",
    );
  }
  return r.kind === "card" ? "" : r.fts_title.trim();
}

/**
 * Every searchable document of the index as embedding chunks: blocks of converted documents,
 * cards, notes and items (title, abstract, note). Order: cards, notes, items, blocks, so the
 * small and valuable material is embedded first.
 *
 * A block is embedded together with the headings above it (like Docling's `contextualize`), so
 * a paragraph that says "the method" carries which section it belongs to. Title, authors and
 * year of the item are deliberately not added: on the golden set they lowered hit@5 from 86% to
 * 79% (see docs/decisions/0026-retrieval-benchmark.md). A change in the context changes the hash of exactly the
 * chunks it touches, so only those are embedded again.
 */
export function collectChunks(index: Index, modelId: string): Chunk[] {
  const rows = index.all<DocRow>(
    `SELECT d.path, d.kind, d.ref, d.citekey, d.title AS doc_title, f.title AS fts_title, f.body
     FROM docs d JOIN fts_tri f ON f.rowid = d.id
     ORDER BY CASE d.kind WHEN 'card' THEN 0 WHEN 'note' THEN 1 WHEN 'item' THEN 2 ELSE 3 END, d.id`,
  );
  const headings = headingPaths(index);
  const out: Chunk[] = [];
  for (const r of rows) {
    const pieces = splitBody(r.body).slice(0, MAX_CHUNKS_PER_DOC);
    let seq = 0;
    for (const text of pieces) {
      if (text.length < MIN_CHUNK_CHARS) continue;
      const lead = leadOf(r, headings.get(`${r.citekey}\0${r.ref}`) ?? "", text);
      const input = lead && !text.startsWith(lead) ? `${lead}\n${text}` : text;
      out.push({
        path: r.path,
        kind: r.kind,
        ref: r.ref,
        citekey: r.citekey,
        seq: seq++,
        text,
        input,
        hash: chunkHash(modelId, input),
      });
    }
  }
  return out;
}
