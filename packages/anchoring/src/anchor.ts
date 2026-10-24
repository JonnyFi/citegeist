import { NORM_ID } from "./normalize.js";
import type { TextStream } from "./stream.js";

export const CONTEXT_LEN = 32;

/**
 * W3C TextQuote (`exact`, `prefix`, `suffix`) plus TextPosition (`start`, `end`) and a block hint.
 * Structurally identical to the `text` anchor in `CardFrontmatter`. Offsets refer to the stream
 * the anchor was created from; they are a verified hint and never trusted alone.
 */
export interface TextAnchorRecord {
  block?: string | undefined;
  exact: string;
  prefix: string;
  suffix: string;
  start?: number | undefined;
  end?: number | undefined;
}

export { NORM_ID };

/** Trim edge whitespace of the range [start, end) in the stream text. */
export function trimRange(
  text: string,
  start: number,
  end: number,
): { start: number; end: number } {
  let s = start;
  let e = end;
  while (s < e && text[s] === " ") s++;
  while (e > s && text[e - 1] === " ") e--;
  return { start: s, end: e };
}

const isWordChar = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c);
/** Apostrophes join the word parts on both sides of them: "don't", "Luhmann's". A hyphen does not. */
const isJoiner = (c: string | undefined): boolean => c === "'" || c === "\u2019";

/**
 * True when the position between `text[i - 1]` and `text[i]` lies inside a word. A letter or digit
 * on both sides counts, and so does an apostrophe with a letter or digit on each side.
 */
function insideWord(text: string, i: number): boolean {
  if (i <= 0 || i >= text.length) return false;
  const before = text[i - 1];
  const after = text[i];
  if (isWordChar(before) && isWordChar(after)) return true;
  if (isWordChar(before) && isJoiner(after)) return isWordChar(text[i + 1]);
  if (isJoiner(before) && isWordChar(after)) return isWordChar(text[i - 2]);
  return false;
}

/**
 * Snap a selection to word boundaries: an edge that cuts through a word moves
 * outward, so the quote of a card never ends in "th" or starts in "ommunication". Edge whitespace
 * is trimmed first. A run of more than `maxExtend` word characters is left alone, because it is
 * not a word (a long URL or a string of digits).
 */
export function snapToWordBoundaries(
  text: string,
  start: number,
  end: number,
  maxExtend = 64,
): { start: number; end: number } {
  const r = trimRange(text, start, end);
  let s = r.start;
  let e = r.end;
  if (e <= s) return r;
  let n = 0;
  while (insideWord(text, s) && n < maxExtend) {
    s--;
    n++;
  }
  if (insideWord(text, s)) s = r.start;
  n = 0;
  while (insideWord(text, e) && n < maxExtend) {
    e++;
    n++;
  }
  if (insideWord(text, e)) e = r.end;
  return { start: s, end: e };
}

/**
 * Create a text anchor for a reader selection: the range is snapped to word boundaries first (see
 * {@link snapToWordBoundaries}), then handled like {@link createTextAnchor}.
 */
export function createSelectionAnchor(
  stream: TextStream,
  start: number,
  end: number,
  contextLen = CONTEXT_LEN,
): TextAnchorRecord | null {
  const r = snapToWordBoundaries(stream.text, start, end);
  return createTextAnchor(stream, r.start, r.end, contextLen);
}

/**
 * Create a text anchor from a character range of a normalised stream, taken at selection time.
 * The block hint is the unit that contains the start of the range.
 */
export function createTextAnchor(
  stream: TextStream,
  start: number,
  end: number,
  contextLen = CONTEXT_LEN,
): TextAnchorRecord | null {
  const r = trimRange(stream.text, start, end);
  if (r.end <= r.start) return null;
  const unit = unitAt(stream, r.start);
  const anchor: TextAnchorRecord = {
    exact: stream.text.slice(r.start, r.end),
    prefix: stream.text.slice(Math.max(0, r.start - contextLen), r.start),
    suffix: stream.text.slice(r.end, r.end + contextLen),
    start: r.start,
    end: r.end,
  };
  if (unit?.id) anchor.block = unit.id;
  return anchor;
}

/** The unit range that contains a stream offset. */
export function unitAt(stream: TextStream, offset: number) {
  let lo = 0;
  let hi = stream.units.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const u = stream.units[mid];
    if (!u) return undefined;
    if (offset < u.start) hi = mid - 1;
    else if (offset >= u.end + 1) lo = mid + 1;
    else return u;
  }
  return undefined;
}
