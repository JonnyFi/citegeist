import { stemmer as stemEn } from "@orama/stemmers/english";
import { stemmer as stemDe } from "@orama/stemmers/german";

const WORD = /[\p{L}\p{N}]+/gu;
const CACHE_LIMIT = 200_000;
const cache = new Map<string, string[]>();

/** German and English Snowball stems of one word, deduplicated. Words are lowercased first. */
export function stems(word: string): string[] {
  const w = word.toLowerCase();
  const hit = cache.get(w);
  if (hit) return hit;
  const out = [...new Set([stemDe(w), stemEn(w)])];
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(w, out);
  return out;
}

export function words(text: string): string[] {
  return text.match(WORD) ?? [];
}

/** Text for the stemmed FTS table: every word replaced by its German and English stem. */
export function stemmedText(text: string): string {
  const out: string[] = [];
  for (const w of words(text)) out.push(...stems(w));
  return out.join(" ");
}

function quote(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

/** FTS5 query over the stemmed table: every query word must match (by either stem). */
export function wordsQuery(q: string): string | null {
  const parts = words(q).map((w) => `(${stems(w).map(quote).join(" OR ")})`);
  return parts.length > 0 ? parts.join(" AND ") : null;
}

/** FTS5 query over the trigram table: every query word of three or more characters as a phrase. */
export function trigramQuery(q: string): string | null {
  const parts = words(q)
    .filter((w) => [...w].length >= 3)
    .map((w) => quote(w.toLowerCase()));
  return parts.length > 0 ? parts.join(" AND ") : null;
}

/** A window of `text` around the first word that matches the query, whitespace collapsed. */
export function snippet(text: string, q: string, width = 160): string {
  const wanted = new Set(words(q).flatMap(stems));
  const lowered = words(q).map((w) => w.toLowerCase());
  let at = -1;
  for (const m of text.matchAll(WORD)) {
    const w = m[0];
    if (stems(w).some((s) => wanted.has(s))) {
      at = m.index ?? 0;
      break;
    }
  }
  if (at < 0) {
    const low = text.toLowerCase();
    for (const w of lowered) {
      const idx = low.indexOf(w);
      if (idx >= 0 && (at < 0 || idx < at)) at = idx;
    }
  }
  const start = Math.max(0, at < 0 ? 0 : at - Math.floor(width / 3));
  const slice = text
    .slice(start, start + width)
    .replace(/\s+/g, " ")
    .trim();
  return `${start > 0 ? "..." : ""}${slice}${start + width < text.length ? "..." : ""}`;
}
