// Pure model of the text pdf.js delivers: items, page texts, the PDF text stream and geometry.
// No DOM and no pdf.js imports, so it is unit-testable in Node.
import { buildStream, type TextStream } from "@citegeist/anchoring";

/** The part of a pdf.js `TextItem` the reader needs. */
export interface RawTextItem {
  str: string;
  /** [a, b, c, d, e, f]: e and f are the baseline origin in PDF user space (y up) */
  transform: number[];
  width: number;
  height: number;
  hasEOL: boolean;
}

export interface PdfTextItem {
  str: string;
  x: number;
  /** baseline, PDF user space (y up) */
  y: number;
  w: number;
  h: number;
  /** offset of the first character in the page text */
  start: number;
}

export interface PdfPageText {
  index: number;
  /** items joined, with "\n" at the end of every visual line */
  text: string;
  items: PdfTextItem[];
  /** offset of the page text in the concatenation of all page texts (the stream's source space) */
  base: number;
}

export type Rect = [number, number, number, number];

function lineBreakAfter(raw: RawTextItem[], i: number): boolean {
  const it = raw[i];
  const next = raw[i + 1];
  if (!it || !next) return true;
  if (it.hasEOL) return true;
  const h = Math.max(heightOf(it), 1);
  return Math.abs((next.transform[5] ?? 0) - (it.transform[5] ?? 0)) > 0.5 * h;
}

function heightOf(it: RawTextItem): number {
  return it.height || Math.hypot(it.transform[2] ?? 0, it.transform[3] ?? 0);
}

/** Build page texts from the text items of each page (marked-content entries already filtered). */
export function buildPageTexts(pages: RawTextItem[][]): PdfPageText[] {
  const out: PdfPageText[] = [];
  let base = 0;
  pages.forEach((raw, index) => {
    let text = "";
    const items: PdfTextItem[] = [];
    raw.forEach((it, i) => {
      items.push({
        str: it.str,
        x: it.transform[4] ?? 0,
        y: it.transform[5] ?? 0,
        w: it.width,
        h: heightOf(it),
        start: text.length,
      });
      text += it.str;
      if (lineBreakAfter(raw, i)) text += "\n";
    });
    out.push({ index, text, items, base });
    base += text.length;
  });
  return out;
}

/** The normalised PDF text stream, one unit per page. */
export function buildPdfStream(
  pages: readonly PdfPageText[],
  labels: readonly (string | null)[] = [],
): TextStream {
  return buildStream(
    pages.map((p) => ({
      text: p.text,
      spans: [{ page: p.index, label: labels[p.index] ?? null, start: 0, end: p.text.length }],
      srcBase: p.base,
    })),
  );
}

/** Page and in-page offset of a source-space offset. */
export function pageOfSource(
  pages: readonly PdfPageText[],
  src: number,
): { page: PdfPageText; offset: number } | null {
  for (const p of pages)
    if (src >= p.base && src < p.base + p.text.length) return { page: p, offset: src - p.base };
  return null;
}

/** One rect per visual line covering the page-text range [a, b), in PDF user space. */
export function textRangeToRects(page: PdfPageText, a: number, b: number): Rect[] {
  const rects: Rect[] = [];
  for (const it of page.items) {
    const s = Math.max(a, it.start);
    const e = Math.min(b, it.start + it.str.length);
    if (e <= s || it.str.length === 0) continue;
    const x0 = it.x + (it.w * (s - it.start)) / it.str.length;
    const x1 = it.x + (it.w * (e - it.start)) / it.str.length;
    const y0 = it.y - 0.2 * it.h;
    const y1 = it.y + 0.85 * it.h;
    const last = rects[rects.length - 1];
    if (last && Math.abs(last[1] - y0) < 0.4 * it.h) {
      last[0] = Math.min(last[0], x0);
      last[2] = Math.max(last[2], x1);
    } else rects.push([x0, y0, x1, y1]);
  }
  return rects;
}

/** Viewport-like object: the conversions pdf.js provides on `PageViewport`. */
export interface ViewportLike {
  convertToPdfPoint(x: number, y: number): number[];
  convertToViewportPoint(x: number, y: number): number[];
}

/** Merge DOM client rects into one rect per visual line, then convert to PDF user space. */
export function domRectsToPdfRects(
  clientRects: readonly {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  }[],
  origin: { left: number; top: number },
  viewport: ViewportLike,
): Rect[] {
  const rs = clientRects
    .filter((r) => r.width > 0.5 && r.height > 0.5)
    .sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: { l: number; t: number; r: number; b: number }[] = [];
  for (const r of rs) {
    const hit = lines.find(
      (ln) =>
        Math.min(ln.b, r.bottom) - Math.max(ln.t, r.top) > 0.6 * Math.min(ln.b - ln.t, r.height),
    );
    if (hit) {
      hit.l = Math.min(hit.l, r.left);
      hit.r = Math.max(hit.r, r.right);
      hit.t = Math.min(hit.t, r.top);
      hit.b = Math.max(hit.b, r.bottom);
    } else lines.push({ l: r.left, t: r.top, r: r.right, b: r.bottom });
  }
  return lines.map((ln) => {
    const [x1 = 0, y1 = 0] = viewport.convertToPdfPoint(ln.l - origin.left, ln.t - origin.top);
    const [x2 = 0, y2 = 0] = viewport.convertToPdfPoint(ln.r - origin.left, ln.b - origin.top);
    return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
  });
}

/** PDF user space rect to a CSS box on the page, using the viewport conversion. */
export function pdfRectToBox(
  r: Rect,
  viewport: ViewportLike,
): { left: number; top: number; width: number; height: number } {
  const [x1 = 0, y1 = 0] = viewport.convertToViewportPoint(r[0], r[1]);
  const [x2 = 0, y2 = 0] = viewport.convertToViewportPoint(r[2], r[3]);
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}
