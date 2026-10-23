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
