import search from "approx-string-match";
import type { TextAnchorRecord } from "./anchor.js";
import type { TextStream } from "./stream.js";

/** Automatic acceptance line, supported by the S3 negative control (98.5 % correctly orphaned). */
export const MIN_QUOTE_SCORE = 0.9;
export const MIN_SCORE = 0.8;

export type ResolveMethod = "position" | "exact" | "fuzzy-window" | "fuzzy-global";

export interface Anchored {
  status: "anchored";
  start: number;
  end: number;
  /** Hypothesis-style combined score, 0..1 */
  score: number;
  /** 1 - errors / quote length */
  quoteScore: number;
  method: ResolveMethod;
  /** another, non-overlapping candidate scored within 0.02 */
  ambiguous: boolean;
}

export interface Orphaned {
  status: "orphaned";
}

export type Resolved = Anchored | Orphaned;

export interface ResolveOptions {
  /** Page index the anchor was made on. The first fuzzy pass covers this page plus and minus one. */
  pageHint?: number | undefined;
  /** Explicit first fuzzy window in stream offsets. Overrides `pageHint`. */
  window?: { start: number; end: number } | undefined;
  minQuoteScore?: number;
  minScore?: number;
  /** Switch stages off, for ablation tests. */
  disable?: Array<"position" | "exact" | "window" | "fuzzy" | "snap">;
}

interface Cand {
  start: number;
  end: number;
  score: number;
  quoteScore: number;
}

function textMatchScore(text: string, str: string): number {
  if (str.length === 0 || text.length === 0) return 0;
  let best = str.length;
  for (const m of search(text, str, str.length)) if (m.errors < best) best = m.errors;
  return 1 - best / str.length;
}

function scoreCandidate(
  text: string,
  a: TextAnchorRecord,
  start: number,
  end: number,
  errors: number,
): Pick<Cand, "score" | "quoteScore"> {
  const quoteScore = 1 - errors / Math.max(1, a.exact.length);
  const pre = a.prefix
    ? textMatchScore(text.slice(Math.max(0, start - a.prefix.length), start), a.prefix)
    : 1;
  const suf = a.suffix ? textMatchScore(text.slice(end, end + a.suffix.length), a.suffix) : 1;
  const posScore =
    a.start === undefined
      ? 1
      : 1 - Math.min(1, Math.abs(start - a.start) / Math.max(1, text.length));
  return { quoteScore, score: (50 * quoteScore + 20 * pre + 20 * suf + 2 * posScore) / 92 };
}

function findAll(text: string, q: string): number[] {
  const out: number[] = [];
  let i = text.indexOf(q);
  while (i !== -1) {
    out.push(i);
    i = text.indexOf(q, i + 1);
  }
  return out;
}

function pickBest(cands: Cand[]): { best: Cand; ambiguous: boolean } | null {
  const best = cands.reduce<Cand | null>((b, c) => (!b || c.score > b.score ? c : b), null);
  if (!best) return null;
  const ambiguous = cands.some(
    (c) =>
      c !== best && (c.end <= best.start || c.start >= best.end) && best.score - c.score < 0.02,
  );
  return { best, ambiguous };
}

/** Hypothesis-style fuzzy search of the quote inside text[from, to). */
function fuzzy(text: string, a: TextAnchorRecord, from: number, to: number): Cand[] {
  const slice = text.slice(from, to);
  const qLen = a.exact.length;
  const maxErrors = Math.min(256, Math.floor(qLen / 2));
  const matches = search(slice, a.exact, maxErrors);
  // Cheapest first; among equally cheap candidates the one closest in length to the quote.
  matches.sort(
    (x, y) =>
      x.errors - y.errors || Math.abs(x.end - x.start - qLen) - Math.abs(y.end - y.start - qLen),
  );
  const kept: typeof matches = [];
  for (const m of matches) {
    if (kept.length >= 12) break;
    if (kept.some((k) => Math.abs(k.start - m.start) < Math.max(4, qLen / 4))) continue;
    kept.push(m);
  }
  return kept.map((m) => {
    const start = from + m.start;
    const end = from + m.end;
    return { start, end, ...scoreCandidate(text, a, start, end, m.errors) };
  });
}

const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/**
 * Move range edges outward to word boundaries, so a changed word at the edge of a fuzzy match is
 * covered completely. Bounded, so a runaway token cannot swallow the surroundings.
 */
export function snapToWords(
  text: string,
  start: number,
  end: number,
  maxExtend = 24,
): { start: number; end: number } {
  let s = start;
  let n = 0;
  while (s > 0 && n < maxExtend && isWordChar(text[s - 1]) && isWordChar(text[s])) {
    s--;
    n++;
  }
  if (n >= maxExtend) s = start;
  let e = end;
  n = 0;
  while (e < text.length && n < maxExtend && isWordChar(text[e]) && isWordChar(text[e - 1])) {
    e++;
    n++;
  }
  if (n >= maxExtend) e = end;
  return { start: s, end: e };
}

function windowFor(stream: TextStream, opts: ResolveOptions, anchor: TextAnchorRecord) {
  if (opts.window) return opts.window;
  let page = opts.pageHint;
  if (page === undefined && anchor.block) {
    page = stream.units.find((u) => u.id === anchor.block)?.page;
  }
  if (page === undefined) return undefined;
  const near = stream.pages.filter((p) => Math.abs(p.page - (page as number)) <= 1);
  if (near.length === 0) return undefined;
  return {
    start: Math.min(...near.map((p) => p.start)),
    end: Math.max(...near.map((p) => p.end)),
  };
}

/**
 * Re-anchor a text anchor in a (possibly re-converted) stream. Order, stopping at the first hit:
 * verified position, exact quote ranked by context, fuzzy in the hinted page plus and minus one,
 * fuzzy over the whole stream. Below the thresholds the result is `orphaned`.
 */
export function resolveAnchor(
  stream: TextStream,
  anchor: TextAnchorRecord,
  opts: ResolveOptions = {},
): Resolved {
  const text = stream.text;
  const minQuote = opts.minQuoteScore ?? MIN_QUOTE_SCORE;
  const minScore = opts.minScore ?? MIN_SCORE;
  const off = new Set(opts.disable ?? []);
  const q = anchor.exact;
  const orphan: Orphaned = { status: "orphaned" };
  if (!q) return orphan;

  const accept = (cands: Cand[], method: ResolveMethod, snap: boolean): Anchored | null => {
    const p = pickBest(cands);
    if (!p || p.best.quoteScore < minQuote || p.best.score < minScore) return null;
    const range =
      snap && !off.has("snap")
        ? snapToWords(text, p.best.start, p.best.end)
        : { start: p.best.start, end: p.best.end };
    return {
      status: "anchored",
      ...range,
      score: p.best.score,
      quoteScore: p.best.quoteScore,
      method,
      ambiguous: p.ambiguous,
    };
  };

  // 1. position hint, verified against quote and both contexts
  if (!off.has("position") && anchor.start !== undefined) {
    const start = anchor.start;
    const end = anchor.end ?? start + q.length;
    if (
      text.slice(start, end) === q &&
      text.slice(Math.max(0, start - anchor.prefix.length), start) === anchor.prefix &&
      text.slice(end, end + anchor.suffix.length) === anchor.suffix
    ) {
      return {
        status: "anchored",
        start,
        end,
        score: 1,
        quoteScore: 1,
        method: "position",
        ambiguous: false,
      };
    }
  }

  // 2. exact quote anywhere, several hits ranked by context
  if (!off.has("exact")) {
    const hits = findAll(text, q);
    if (hits.length > 0) {
      // an explicit page hint prefers hits on that page plus and minus one
      const explicit =
        opts.window ?? (opts.pageHint !== undefined ? windowFor(stream, opts, anchor) : undefined);
      const inWin = explicit
        ? hits.filter((h) => h >= explicit.start && h + q.length <= explicit.end)
        : [];
      for (const set of inWin.length > 0 && inWin.length < hits.length ? [inWin, hits] : [hits]) {
        const cands = set.map((s) => ({
          start: s,
          end: s + q.length,
          ...scoreCandidate(text, anchor, s, s + q.length, 0),
        }));
        // a long exact quote is evidence enough even when its context changed
        const r = q.length >= 30 ? exactLong(cands) : accept(cands, "exact", false);
        if (r) return r;
      }
    }
  }

  if (off.has("fuzzy")) return orphan;

  // 3. fuzzy, first in the hinted window, then globally
  const win = off.has("window") ? undefined : windowFor(stream, opts, anchor);
  if (win) {
    const r = accept(
      fuzzy(text, anchor, Math.max(0, win.start), Math.min(text.length, win.end)),
      "fuzzy-window",
      true,
    );
    if (r) return r;
  }
  return accept(fuzzy(text, anchor, 0, text.length), "fuzzy-global", true) ?? orphan;
}

function exactLong(cands: Cand[]): Anchored | null {
  const p = pickBest(cands);
  if (!p) return null;
  return {
    status: "anchored",
    start: p.best.start,
    end: p.best.end,
    score: p.best.score,
    quoteScore: 1,
    method: "exact",
    ambiguous: p.ambiguous,
  };
}

/**
 * Find a bare quote (no context) in a stream, for example the text selected in a PDF text layer.
 * `pageHint` narrows the search the same way as for stored anchors.
 */
export function findQuote(stream: TextStream, quote: string, opts: ResolveOptions = {}): Resolved {
  return resolveAnchor(stream, { exact: quote, prefix: "", suffix: "" }, opts);
}
