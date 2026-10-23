import type { Block } from "@citegeist/schema";
import { concat, fromString, type Mapped } from "./mapped.js";
import { normalize } from "./normalize.js";

/** Part of a unit that lies on one page. Offsets are into the unit text, before normalisation. */
export interface UnitSpan {
  page: number;
  label: string | null;
  start: number;
  end: number;
}

/** One block (or one DOM block element, or one PDF page) of source text. */
export interface StreamUnit {
  id?: string | undefined;
  text: string;
  spans?: UnitSpan[];
  /**
   * Offset of the unit text in the caller's source space. Defaults to the running sum of the
   * previous unit lengths. The reader passes DOM text offsets here.
   */
  srcBase?: number;
  /** Explicit origin map for `text`. Overrides `srcBase` + index; tests use it for perturbed text. */
  src?: number[];
}

export interface UnitRange {
  id: string | undefined;
  /** range in the normalised stream, half-open */
  start: number;
  end: number;
  /** source space range of the unit text */
  srcBase: number;
  srcEnd: number;
  spans: UnitSpan[];
  /** page of the first span, when known */
  page: number | undefined;
}

export interface PageRange {
  page: number;
  label: string | null;
  start: number;
  end: number;
}

/** A normalised, document-wide text with its origin map. Offsets of anchors refer to `text`. */
export interface TextStream {
  text: string;
  /** origin in source space for each character, -1 for separators */
  src: number[];
  units: UnitRange[];
  /** page ranges in the normalised stream, ascending by page */
  pages: PageRange[];
}

/** Compressed index of the real (non-negative) origins, for binary search. */
const compressedCache = new WeakMap<TextStream, { idx: number[]; src: number[] }>();

function compressed(stream: TextStream): { idx: number[]; src: number[] } {
  let c = compressedCache.get(stream);
  if (!c) {
    const idx: number[] = [];
    const src: number[] = [];
    for (let i = 0; i < stream.src.length; i++) {
      const s = stream.src[i] ?? -1;
      if (s >= 0) {
        idx.push(i);
        src.push(s);
      }
    }
    c = { idx, src };
    compressedCache.set(stream, c);
  }
  return c;
}

/** Smallest position in the sorted array whose value is >= x. */
function lowerBound(a: number[], x: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((a[mid] ?? 0) < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Build a stream from units. Each unit is normalised on its own (so unit offsets survive), the
 * units are joined with one space, and page ranges are derived from the unit spans.
 */
export function buildStream(units: StreamUnit[]): TextStream {
  const parts: Mapped[] = [];
  const meta: Omit<UnitRange, "start" | "end">[] = [];
  const localMaps: number[][] = [];
  let running = 0;
  for (const u of units) {
    const base = u.srcBase ?? running;
    running = base + u.text.length;
    // normalise on local offsets first, so span offsets stay valid whatever the source space is
    const local = normalize(fromString(u.text, 0));
    if (local.text.length === 0) continue;
    const src = local.src.map((l) => (l < 0 ? -1 : u.src ? (u.src[l] ?? -1) : base + l));
    parts.push({ text: local.text, src });
    localMaps.push(local.src);
    const spans = u.spans ?? [];
    meta.push({
      id: u.id,
      srcBase: base,
      srcEnd: base + u.text.length,
      spans,
      page: spans[0]?.page,
    });
  }
  const joined = concat(parts, " ");
  const ranges: UnitRange[] = [];
  const byPage = new Map<number, PageRange>();
  let at = 0;
  parts.forEach((p, i) => {
    const mi = meta[i];
    const lm = localMaps[i];
    if (!mi || !lm) return;
    ranges.push({ ...mi, start: at, end: at + p.text.length });
    for (const sp of mi.spans) {
      let lo = -1;
      let hi = -1;
      for (let k = 0; k < lm.length; k++) {
        const l = lm[k] ?? -1;
        if (l >= sp.start && l < sp.end) {
          if (lo === -1) lo = k;
          hi = k;
        }
      }
      if (lo === -1) continue;
      const cur = byPage.get(sp.page);
      if (cur) {
        cur.start = Math.min(cur.start, at + lo);
        cur.end = Math.max(cur.end, at + hi + 1);
        if (cur.label === null) cur.label = sp.label;
      } else {
        byPage.set(sp.page, { page: sp.page, label: sp.label, start: at + lo, end: at + hi + 1 });
      }
    }
    at += p.text.length + 1;
  });
  return {
    text: joined.text,
    src: joined.src,
    units: ranges,
    pages: [...byPage.values()].sort((a, b) => a.page - b.page),
  };
}

/**
 * Stream of a converted document: the text of every block that is not page furniture, in order.
 * Block ids, spans and page labels are kept so that a found range maps back to blocks and pages.
 */
export function buildBlockStream(blocks: readonly Block[]): TextStream {
  return buildStream(
    blocks
      .filter((b) => b.flow !== "furniture")
      .map((b) => ({
        id: b.id,
        text: b.text,
        spans: b.spans.map((s) => ({
          page: s.page,
          label: s.label,
          start: s.start,
          end: s.end,
        })),
      })),
  );
}

/** Stream of plain page texts, for example the text layer of a PDF. Page index is the array index. */
export function buildPageStream(pageTexts: readonly string[]): TextStream {
  return buildStream(
    pageTexts.map((text, page) => ({
      text,
      spans: [{ page, label: null, start: 0, end: text.length }],
    })),
  );
}

/**
 * Range of stream characters whose origin lies in the source range [a, b), or null.
 * Separators and characters without origin are skipped at the edges.
 */
export function rangeFromSource(
  stream: TextStream,
  a: number,
  b: number,
): { start: number; end: number } | null {
  const c = compressed(stream);
  const lo = lowerBound(c.src, a);
  const hi = lowerBound(c.src, b); // first position with src >= b
  if (lo >= hi) return null;
  const first = c.idx[lo];
  const last = c.idx[hi - 1];
  if (first === undefined || last === undefined) return null;
  return { start: first, end: last + 1 };
}

/** Source range [first origin, last origin + 1) of the stream range, or null for pure separators. */
export function toSource(
  stream: TextStream,
  start: number,
  end: number,
): { start: number; end: number } | null {
  let first = -1;
  let last = -1;
  for (let i = Math.max(0, start); i < Math.min(end, stream.src.length); i++) {
    const s = stream.src[i] ?? -1;
    if (s < 0) continue;
    if (first === -1) first = s;
    last = s;
  }
  return first === -1 ? null : { start: first, end: last + 1 };
}
