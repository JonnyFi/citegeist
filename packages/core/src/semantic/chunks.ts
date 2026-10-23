import { createHash } from "node:crypto";
import type { Index } from "../index-db.js";

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
  /** What the model reads: the title above the text. */
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

/**
 * Every searchable document of the index as embedding chunks: blocks of converted documents,
 * cards, notes and items (title, abstract, note). Order: cards, notes, items, blocks, so the
 * small and valuable material is embedded first.
 */
export function collectChunks(index: Index, modelId: string): Chunk[] {
  const rows = index.all<DocRow>(
    `SELECT d.path, d.kind, d.ref, d.citekey, d.title AS doc_title, f.title AS fts_title, f.body
     FROM docs d JOIN fts_tri f ON f.rowid = d.id
     ORDER BY CASE d.kind WHEN 'card' THEN 0 WHEN 'note' THEN 1 WHEN 'item' THEN 2 ELSE 3 END, d.id`,
  );
  const out: Chunk[] = [];
  for (const r of rows) {
    const title = (r.kind === "block" ? r.doc_title : r.fts_title).trim();
    const pieces = splitBody(r.body).slice(0, MAX_CHUNKS_PER_DOC);
    let seq = 0;
    for (const text of pieces) {
      if (text.length < MIN_CHUNK_CHARS) continue;
      const input = title && !text.startsWith(title) ? `${title}\n${text}` : text;
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
