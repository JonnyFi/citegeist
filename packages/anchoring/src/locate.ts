import type { TextStream, UnitRange } from "./stream.js";
import { toSource } from "./stream.js";

/** Part of a block, in offsets into the block text (the same offsets `Span.start`/`Span.end` use). */
export interface BlockSlice {
  id: string;
  start: number;
  end: number;
}

export interface PageRef {
  /** zero-based PDF page index */
  page: number;
  /** printed page label, null when unknown */
  label: string | null;
}

export interface Location {
  /** blocks touched by the range, in order, with offsets into each block text */
  blocks: BlockSlice[];
  /** pages touched by the range, in order, without duplicates */
  pages: PageRef[];
  /** page of the first character, null when the stream carries no page information */
  first: PageRef | null;
  /** page of the last character */
  last: PageRef | null;
}

function pageOf(unit: UnitRange, local: number): PageRef | null {
  if (unit.spans.length === 0) return null;
  const sp =
    unit.spans.find((s) => local >= s.start && local < s.end) ??
    // offsets past the last span (trailing characters) belong to the nearest span before them
    [...unit.spans].reverse().find((s) => s.start <= local) ??
    unit.spans[0];
  return sp ? { page: sp.page, label: sp.label } : null;
}

function unitIndexOfSource(stream: TextStream, src: number): number {
  const us = stream.units;
  let lo = 0;
  let hi = us.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const u = us[mid];
    if (!u) break;
    if (src < u.srcBase) hi = mid - 1;
    else if (src >= u.srcEnd) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/**
 * Map a stream range to blocks and pages: which block offsets it covers, and the PDF page index and
 * printed page label of its first and last character. Used to give a new card its locator.
 */
export function locate(stream: TextStream, start: number, end: number): Location {
  const src = toSource(stream, start, end);
  const out: Location = { blocks: [], pages: [], first: null, last: null };
  if (!src) return out;
  const i0 = unitIndexOfSource(stream, src.start);
  const i1 = unitIndexOfSource(stream, src.end - 1);
  if (i0 === -1 || i1 === -1) return out;
  const seen = new Set<string>();
  for (let i = i0; i <= i1; i++) {
    const u = stream.units[i];
    if (!u) continue;
    const a = Math.max(src.start, u.srcBase) - u.srcBase;
    const b = Math.min(src.end, u.srcEnd) - u.srcBase;
    if (u.id) out.blocks.push({ id: u.id, start: a, end: b });
    for (const sp of u.spans) {
      if (sp.end <= a || sp.start >= b) continue;
      const key = `${sp.page}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.pages.push({ page: sp.page, label: sp.label });
      }
    }
    if (i === i0) out.first = pageOf(u, a);
    if (i === i1) out.last = pageOf(u, Math.max(a, b - 1));
  }
  if (!out.first && out.pages.length > 0) out.first = out.pages[0] ?? null;
  if (!out.last && out.pages.length > 0) out.last = out.pages[out.pages.length - 1] ?? null;
  return out;
}

/** CSL locator for a card (`Locator` in `@citegeist/schema`): printed page label, or null if unknown. */
export function locatorFor(
  loc: Location,
): { label: string; start: string; end?: string; confirmed: boolean } | null {
  const a = loc.first?.label;
  if (!a) return null;
  const b = loc.last?.label;
  return b && b !== a
    ? { label: "page", start: a, end: b, confirmed: false }
    : { label: "page", start: a, confirmed: false };
}

/** Page window of a resolved range, or null when the stream has no page information. */
export function pageOfRange(stream: TextStream, start: number): number | null {
  for (const p of stream.pages) if (start >= p.start && start < p.end) return p.page;
  return null;
}
