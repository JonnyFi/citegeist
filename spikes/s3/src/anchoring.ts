// Pure anchoring logic (no DOM, no pdf.js). Candidate for packages/anchoring.
//
// Text streams are "Mapped": every output character remembers an origin index
// ("item space": the index into the concatenation of all pdf.js text items, or -1
// for inserted characters). That makes ground truth computable through any chain of
// transformations (normalisation, dehyphenation, perturbation).
import search from 'approx-string-match';

export interface Mapped {
  text: string;
  src: number[];
}

export const NORM_ID = 'citegeist-norm-v1';

export function fromString(text: string, base = 0): Mapped {
  const src = new Array<number>(text.length);
  for (let i = 0; i < text.length; i++) src[i] = base + i;
  return { text, src };
}

export function concat(parts: Mapped[], sep: string): Mapped {
  let text = '';
  const src: number[] = [];
  parts.forEach((p, idx) => {
    if (idx > 0) {
      text += sep;
      for (let i = 0; i < sep.length; i++) src.push(-1);
    }
    text += p.text;
    for (const s of p.src) src.push(s);
  });
  return { text, src };
}

/** Regex replace that keeps the origin map. Replacement chars inherit the origin of the match start. */
export function replaceRegex(m: Mapped, re: RegExp, repl: (match: RegExpMatchArray) => string): Mapped {
  let text = '';
  const src: number[] = [];
  let last = 0;
  for (const match of m.text.matchAll(re)) {
    const at = match.index ?? 0;
    for (let i = last; i < at; i++) {
      text += m.text[i];
      src.push(m.src[i]);
    }
    const r = repl(match);
    for (let i = 0; i < r.length; i++) {
      text += r[i];
      src.push(r === match[0] ? m.src[at + i] : m.src[at]);
    }
    last = at + match[0].length;
  }
  for (let i = last; i < m.text.length; i++) {
    text += m.text[i];
    src.push(m.src[i]);
  }
  return { text, src };
}

const LIGATURES: Record<string, string> = {
  'ﬀ': 'ff',
  'ﬁ': 'fi',
  'ﬂ': 'fl',
  'ﬃ': 'ffi',
  'ﬄ': 'ffl',
  'ﬅ': 'st',
  'ﬆ': 'st',
};

export interface NormOptions {
  /** fold presentation-form ligatures (U+FB00..FB06) to ASCII. Not part of norm-v1 as written in the docs. */
  ligatures?: boolean;
}

/** citegeist-norm-v1: NFC, drop soft hyphens, join end-of-line hyphenation, collapse whitespace. */
export function normalize(m: Mapped, opts: NormOptions = {}): Mapped {
  let r = replaceRegex(m, /[­​‌‍﻿]/g, () => '');
  r = replaceRegex(r, /(?<=\p{L})-[ \t]*\n[ \t]*(?=\p{Ll})/gu, () => '');
  if (opts.ligatures) r = replaceRegex(r, /[ﬀ-ﬆ]/g, (x) => LIGATURES[x[0]]);
  r = replaceRegex(r, /\P{M}\p{M}+/gu, (x) => x[0].normalize('NFC'));
  r = replaceRegex(r, /[\s ]+/g, () => ' ');
  // trim
  let a = 0;
  let b = r.text.length;
  while (a < b && r.text[a] === ' ') a++;
  while (b > a && r.text[b - 1] === ' ') b--;
  return { text: r.text.slice(a, b), src: r.src.slice(a, b) };
}

// ---------------------------------------------------------------- text anchors

export interface TextAnchor {
  exact: string;
  prefix: string;
  suffix: string;
  position: { start: number; end: number };
  stream: string;
}

export const CONTEXT_LEN = 32;

export function makeTextAnchor(stream: string, start: number, end: number, ctx = CONTEXT_LEN): TextAnchor {
  return {
    exact: stream.slice(start, end),
    prefix: stream.slice(Math.max(0, start - ctx), start),
    suffix: stream.slice(end, end + ctx),
    position: { start, end },
    stream: NORM_ID,
  };
}

export type Method = 'position' | 'exact' | 'fuzzy-window' | 'fuzzy-global' | 'orphan';

export interface Anchored {
  start: number;
  end: number;
  score: number;
  quoteScore: number;
  method: Method;
  /** another non-overlapping candidate scored within 0.02 */
  ambiguous: boolean;
}

export interface ReanchorOptions {
  /** restrict the first fuzzy pass to this char range of the new stream (e.g. hinted page +- 1) */
  window?: { start: number; end: number };
  /** minimum quote similarity to accept (1 - errors / length) */
  minQuoteScore?: number;
  /** minimum combined score to accept */
  minScore?: number;
  /** disable stages for ablation */
  disable?: Array<'position' | 'exact' | 'window' | 'fuzzy'>;
}

function textMatchScore(text: string, str: string): number {
  if (str.length === 0 || text.length === 0) return 0;
  const ms = search(text, str, str.length);
  let best = str.length;
  for (const m of ms) if (m.errors < best) best = m.errors;
  return 1 - best / str.length;
}

function scoreCandidate(text: string, a: TextAnchor, start: number, end: number, errors: number) {
  const quoteScore = 1 - errors / Math.max(1, a.exact.length);
  const pre = a.prefix ? textMatchScore(text.slice(Math.max(0, start - a.prefix.length), start), a.prefix) : 1;
  const suf = a.suffix ? textMatchScore(text.slice(end, end + a.suffix.length), a.suffix) : 1;
  const hint = a.position.start;
  const posScore = 1 - Math.min(1, Math.abs(start - hint) / Math.max(1, text.length));
  const score = (50 * quoteScore + 20 * pre + 20 * suf + 2 * posScore) / 92;
  return { quoteScore, score };
}

function findAll(text: string, q: string, from = 0, to = text.length): number[] {
  const out: number[] = [];
  let i = text.indexOf(q, from);
  while (i !== -1 && i + q.length <= to) {
    out.push(i);
    i = text.indexOf(q, i + 1);
  }
  return out;
}

interface Cand {
  start: number;
  end: number;
  score: number;
  quoteScore: number;
}

function pickBest(cands: Cand[]): { best: Cand; ambiguous: boolean } | null {
  if (cands.length === 0) return null;
  const sorted = [...cands].sort((x, y) => y.score - x.score);
  const best = sorted[0];
  const ambiguous = sorted.some((c) => c !== best && (c.end <= best.start || c.start >= best.end) && best.score - c.score < 0.02);
  return { best, ambiguous };
}

/** Hypothesis-style fuzzy search of the anchor's exact quote inside text[from, to). */
function fuzzy(text: string, a: TextAnchor, from: number, to: number): Cand[] {
  const slice = text.slice(from, to);
  const maxErrors = Math.min(256, Math.floor(a.exact.length / 2));
  const matches = search(slice, a.exact, maxErrors);
  // keep a bounded number of cheapest, spatially distinct matches to bound scoring cost
  matches.sort((x, y) => x.errors - y.errors);
  const kept: typeof matches = [];
  for (const m of matches) {
    if (kept.length >= 12) break;
    if (kept.some((k) => Math.abs(k.start - m.start) < Math.max(4, a.exact.length / 4))) continue;
    kept.push(m);
  }
  return kept.map((m) => {
    const start = from + m.start;
    const end = from + m.end;
    return { start, end, ...scoreCandidate(text, a, start, end, m.errors) };
  });
}

/**
 * Re-anchor a TextQuote/TextPosition anchor in a (possibly re-converted) text stream.
 * Order: position hint verified by quote, exact quote (ranked by context), fuzzy in the
 * hinted window, fuzzy over the whole stream. Below the thresholds the result is "orphan".
 */
export function reanchor(text: string, a: TextAnchor, opts: ReanchorOptions = {}): Anchored | null {
  const minQuote = opts.minQuoteScore ?? 0.75;
  const minScore = opts.minScore ?? 0.7;
  const off = new Set(opts.disable ?? []);
  const q = a.exact;
  if (!q) return null;

  const accept = (cands: Cand[], method: Method): Anchored | null => {
    const p = pickBest(cands);
    if (!p) return null;
    if (p.best.quoteScore < minQuote || p.best.score < minScore) return null;
    return { ...p.best, method, ambiguous: p.ambiguous };
  };

  // 1. position hint, verified against quote and both contexts
  if (!off.has('position')) {
    const { start, end } = a.position;
    if (text.slice(start, end) === q && text.slice(Math.max(0, start - a.prefix.length), start) === a.prefix && text.slice(end, end + a.suffix.length) === a.suffix) {
      return { start, end, score: 1, quoteScore: 1, method: 'position', ambiguous: false };
    }
  }

  // 2. exact quote anywhere; several hits are ranked by context
  if (!off.has('exact')) {
    const hits = findAll(text, q);
    if (hits.length > 0) {
      const cands = hits.map((s) => ({ start: s, end: s + q.length, ...scoreCandidate(text, a, s, s + q.length, 0) }));
      // a long exact quote is evidence enough even when its context changed
      const r = q.length >= 30 ? ((p) => (p ? ({ ...p.best, method: 'exact', ambiguous: p.ambiguous } as Anchored) : null))(pickBest(cands)) : accept(cands, 'exact');
      if (r) return r;
    }
  }

  if (off.has('fuzzy')) return null;
  // 3. fuzzy, first inside the hinted window, then globally
  if (opts.window && !off.has('window')) {
    const r = accept(fuzzy(text, a, Math.max(0, opts.window.start), Math.min(text.length, opts.window.end)), 'fuzzy-window');
    if (r) return r;
  }
  return accept(fuzzy(text, a, 0, text.length), 'fuzzy-global');
}

/** Overlap / union of two half-open ranges. */
export function iou(a0: number, a1: number, b0: number, b1: number): number {
  const inter = Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  const uni = Math.max(a1, b1) - Math.min(a0, b0);
  return uni <= 0 ? 0 : inter / uni;
}

/** Range of output indices whose origin lies in [rs, re) (item space), as half-open range. */
export function truthRange(src: number[], rs: number, re: number): { start: number; end: number } | null {
  let lo = -1;
  let hi = -1;
  for (let i = 0; i < src.length; i++) {
    if (src[i] >= rs && src[i] < re) {
      if (lo === -1) lo = i;
      hi = i;
    }
  }
  return lo === -1 ? null : { start: lo, end: hi + 1 };
}

/** Similarity of two strings ignoring whitespace: 1 - best edit distance / length. */
export function looseSimilarity(a: string, b: string): number {
  const x = a.replace(/\s+/g, '');
  const y = b.replace(/\s+/g, '');
  if (!x || !y) return 0;
  const [pat, txt] = x.length <= y.length ? [x, y] : [y, x];
  const ms = search(txt, pat, pat.length);
  let best = pat.length;
  for (const m of ms) if (m.errors < best) best = m.errors;
  return 1 - best / Math.max(x.length, y.length);
}
