/**
 * Quote verification for matrix cells. A model may only quote what the passages say, so every
 * quote is searched in the passage text after both sides are normalized. What matches is cut out
 * of the original text, which is what a cell stores.
 */

/** Shortest normalized quote that counts as evidence. */
export const MIN_QUOTE_CHARS = 8;

const SINGLE_QUOTES = /[‘’‚‛′´`]/u;
const DOUBLE_QUOTES = /[“”„‟″«»]/u;
const DASHES = /[‐-―−]/u;
const INVISIBLE = /[­​-‍⁠﻿]/u;
const HYPHEN_BREAK = /^[ \t]*\r?\n[ \t]*(?=\p{Ll})/u;

interface Normalized {
  text: string;
  /** For each character of `text`, where it starts and ends in the original string. */
  from: number[];
  to: number[];
}

/**
 * Lowercases, applies NFKC, unifies quotes and dashes, drops soft hyphens, joins words broken by a
 * hyphen at a line end and collapses whitespace. Offsets map back to the original string.
 */
export function normalizeForMatch(input: string): Normalized {
  const out: string[] = [];
  const from: number[] = [];
  const to: number[] = [];
  let i = 0;
  while (i < input.length) {
    const cp = input.codePointAt(i) ?? 0;
    const ch = String.fromCodePoint(cp);
    const end = i + ch.length;
    if (INVISIBLE.test(ch)) {
      i = end;
      continue;
    }
    if (ch === "-") {
      const m = HYPHEN_BREAK.exec(input.slice(end));
      if (m) {
        i = end + m[0].length;
        continue;
      }
    }
    let piece: string;
    if (/\s/u.test(ch)) piece = " ";
    else if (SINGLE_QUOTES.test(ch)) piece = "'";
    else if (DOUBLE_QUOTES.test(ch)) piece = '"';
    else if (DASHES.test(ch)) piece = "-";
    else piece = ch.normalize("NFKC").toLowerCase();
    for (const p of piece) {
      if (p === " " && (out.length === 0 || out[out.length - 1] === " ")) {
        // collapse runs; the run keeps the end of its last whitespace character
        if (out.length > 0) to[to.length - 1] = end;
        continue;
      }
      out.push(p);
      from.push(i);
      to.push(end);
    }
    i = end;
  }
  while (out[out.length - 1] === " ") {
    out.pop();
    from.pop();
    to.pop();
  }
  return { text: out.join(""), from, to };
}

export interface QuoteMatch {
  /** The passage text from the first to the last matched character, as stored. */
  text: string;
  /** Offsets into the original passage text. */
  start: number;
  end: number;
}

/** Finds `quote` in `passage` after normalization. Undefined when it is too short or not there. */
export function verifyQuote(passage: string, quote: string): QuoteMatch | undefined {
  const q = normalizeForMatch(quote).text;
  if ([...q].length < MIN_QUOTE_CHARS) return undefined;
  const p = normalizeForMatch(passage);
  const at = p.text.indexOf(q);
  if (at < 0) return undefined;
  const last = at + q.length - 1;
  const start = p.from[at] ?? 0;
  const end = p.to[last] ?? passage.length;
  return { text: passage.slice(start, end), start, end };
}
