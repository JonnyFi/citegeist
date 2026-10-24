import {
  createSelectionAnchor,
  createTextAnchor,
  findQuote,
  locate,
  pageOfRange,
  type TextAnchorRecord,
  type TextStream,
} from "@citegeist/anchoring";
import type { SelectionAnchors } from "./types.js";

/**
 * Text anchor, quote and location for a character range of a view-local stream. The range is
 * snapped to word boundaries first, so a quote never ends in the middle of a word. When a canonical
 * document stream (from the converted blocks) is given, the anchor is made on that stream, so its
 * offsets and block ids match what the core stores. The quote is searched there, with the page
 * hint, and the local stream is the fallback.
 */
export function anchorsForRange(
  local: TextStream,
  start: number,
  end: number,
  canonical?: TextStream,
): Omit<SelectionAnchors, "pdfAnchor"> | null {
  const first = createSelectionAnchor(local, start, end);
  if (!first) return null;
  let stream = local;
  let anchor: TextAnchorRecord = first;
  if (canonical) {
    const r = findQuote(canonical, first.exact, {
      pageHint: pageOfRange(local, first.start ?? start) ?? undefined,
    });
    if (r.status === "anchored") {
      const made = createTextAnchor(canonical, r.start, r.end);
      if (made) {
        anchor = made;
        stream = canonical;
      }
    }
  }
  const loc = locate(stream, anchor.start ?? 0, anchor.end ?? 0);
  return { textAnchor: anchor, quote: anchor.exact, location: loc };
}
