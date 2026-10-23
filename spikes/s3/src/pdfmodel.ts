// pdf.js-facing model: text items, the PDF text stream, the reflow view and geometry helpers.
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PageViewport } from 'pdfjs-dist';
import type { TextContent } from 'pdfjs-dist/types/src/display/api';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { type Mapped, concat, fromString, normalize, truthRange, type NormOptions } from './anchoring.ts';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface Item {
  str: string;
  x: number;
  y: number; // baseline, PDF user space (y up)
  w: number;
  h: number;
  hasEOL: boolean;
  /** index of the first char of this item in item space */
  base: number;
}

export interface PageModel {
  index: number;
  content: TextContent;
  items: Item[];
  /** item-space range [start, end) of this page */
  start: number;
  end: number;
}

export interface DocModel {
  pdf: PDFDocumentProxy;
  pages: PageModel[];
  totalChars: number;
}

export async function loadDoc(url: string): Promise<DocModel> {
  const pdf = await pdfjs.getDocument({ url }).promise;
  const pages: PageModel[] = [];
  let base = 0;
  for (let i = 0; i < pdf.numPages; i++) {
    const page = await pdf.getPage(i + 1);
    const content = await page.getTextContent();
    const start = base;
    const items: Item[] = [];
    for (const it of content.items) {
      if (!('str' in it)) continue; // marked content markers, same filter as pdf.js TextLayer
      const t = it.transform as number[];
      items.push({ str: it.str, x: t[4], y: t[5], w: it.width, h: it.height || Math.hypot(t[2], t[3]), hasEOL: it.hasEOL, base });
      base += it.str.length;
    }
    pages.push({ index: i, content, items, start, end: base });
  }
  return { pdf, pages, totalChars: base };
}

export function pageOfSrc(doc: DocModel, src: number): number {
  for (const p of doc.pages) if (src >= p.start && src < p.end) return p.index;
  return -1;
}

function lineBreakAfter(items: Item[], i: number): boolean {
  if (i === items.length - 1) return true;
  if (items[i].hasEOL) return true;
  return Math.abs(items[i + 1].y - items[i].y) > 0.5 * Math.max(items[i].h, 1);
}

/** The text stream as the PDF text layer presents it: items concatenated, "\n" at line ends. */
export function pdfStream(doc: DocModel): Mapped {
  const parts: Mapped[] = [];
  for (const p of doc.pages) {
    let text = '';
    const src: number[] = [];
    p.items.forEach((it, i) => {
      for (let k = 0; k < it.str.length; k++) {
        text += it.str[k];
        src.push(it.base + k);
      }
      if (lineBreakAfter(p.items, i)) {
        text += '\n';
        src.push(-1);
      }
    });
    parts.push({ text, src });
  }
  return concat(parts, '');
}

export interface Reflow {
  paragraphs: Mapped[];
  paraPage: number[];
}

/** Reflow view: lines -> paragraphs (by vertical gap), end-of-line hyphenation removed. */
export function buildReflow(doc: DocModel): Reflow {
  const paragraphs: Mapped[] = [];
  const paraPage: number[] = [];
  for (const p of doc.pages) {
    // lines
    const lines: { m: Mapped; y: number; h: number }[] = [];
    let cur: Item[] = [];
    p.items.forEach((it, i) => {
      cur.push(it);
      if (lineBreakAfter(p.items, i)) {
        const m = concat(
          cur.filter((c) => c.str.length > 0).map((c) => fromString(c.str, c.base)),
          '',
        );
        if (m.text.trim().length > 0) lines.push({ m, y: cur[0].y, h: Math.max(...cur.map((c) => c.h), 1) });
        cur = [];
      }
    });
    // leading
    const gaps: number[] = [];
    for (let i = 1; i < lines.length; i++) {
      const g = lines[i - 1].y - lines[i].y;
      if (g > 0 && g < 3 * lines[i].h) gaps.push(g);
    }
    gaps.sort((a, b) => a - b);
    const lead = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 12;
    // paragraphs
    let acc: Mapped | null = null;
    const flush = () => {
      if (acc) {
        paragraphs.push(acc);
        paraPage.push(p.index);
      }
      acc = null;
    };
    for (let i = 0; i < lines.length; i++) {
      const gap = i === 0 ? 0 : lines[i - 1].y - lines[i].y;
      const newPara = i === 0 || gap < -0.5 * lines[i].h || gap > 1.5 * lead;
      if (newPara) flush();
      if (!acc) {
        acc = lines[i].m;
        continue;
      }
      const prev: Mapped = acc;
      if (/\p{L}-\s*$/u.test(prev.text) && /^\s*\p{Ll}/u.test(lines[i].m.text)) {
        // dehyphenate: drop the hyphen and join without space
        const t = prev.text.replace(/\s+$/, '');
        const cut = t.length - 1;
        acc = concat([{ text: prev.text.slice(0, cut), src: prev.src.slice(0, cut) }, lines[i].m], '');
      } else {
        acc = concat([prev, lines[i].m], ' ');
      }
    }
    flush();
  }
  return { paragraphs, paraPage };
}

export interface Stream {
  m: Mapped;
  /** char range of each page in the normalised stream */
  pageRanges: { start: number; end: number }[];
  /** start offset of each paragraph (when built from paragraphs) */
  paraStarts: number[];
}

export function buildStream(doc: DocModel, paragraphs: Mapped[], norm: NormOptions | null): Stream {
  // normalise per paragraph (equivalent to normalising the joined text, but keeps paragraph offsets)
  const parts = paragraphs.map((p) => (norm ? normalize(p, norm) : p)).filter((p) => p.text.length > 0);
  const paraStarts: number[] = [];
  let at = 0;
  for (const p of parts) {
    paraStarts.push(at);
    at += p.text.length + 1;
  }
  const m = concat(parts, ' ');
  const pageRanges = doc.pages.map((p) => truthRange(m.src, p.start, p.end) ?? { start: 0, end: 0 });
  return { m, pageRanges, paraStarts };
}

// -------------------------------------------------------------------- geometry

export type Rect = [number, number, number, number]; // x1,y1,x2,y2 PDF user space, y up

/** Rects (one per line) covering item-space range [rs, re) on one page. */
export function itemRangeToRects(page: PageModel, rs: number, re: number): Rect[] {
  const rects: Rect[] = [];
  for (const it of page.items) {
    const a = Math.max(rs, it.base);
    const b = Math.min(re, it.base + it.str.length);
    if (b <= a || it.str.length === 0) continue;
    const x0 = it.x + (it.w * (a - it.base)) / it.str.length;
    const x1 = it.x + (it.w * (b - it.base)) / it.str.length;
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

/** Text of the characters whose centres fall inside any of the rects. */
export function textInRects(page: PageModel, rects: Rect[]): string {
  let out = '';
  const pad = 0.5;
  let prev: Item | null = null;
  for (const it of page.items) {
    const n = it.str.length;
    if (n === 0) continue;
    const yc = it.y + 0.3 * it.h;
    let took = '';
    for (let k = 0; k < n; k++) {
      const xc = it.x + (it.w * (k + 0.5)) / n;
      if (rects.some((r) => xc >= r[0] - pad && xc <= r[2] + pad && yc >= r[1] - pad && yc <= r[3] + pad)) took += it.str[k];
    }
    if (!took) continue;
    // separate items only when the line changes or a visible gap separates them
    if (prev && (Math.abs(prev.y - it.y) > 0.5 * it.h || it.x - (prev.x + prev.w) > 0.15 * it.h)) out += ' ';
    out += took;
    prev = it;
  }
  return out.trim();
}

/** Merge DOM client rects into one rect per visual line, then convert to PDF user space. */
export function domRectsToPdfRects(clientRects: DOMRect[], origin: { left: number; top: number }, viewport: PageViewport): Rect[] {
  const rs = clientRects.filter((r) => r.width > 0.5 && r.height > 0.5).sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: { l: number; t: number; r: number; b: number }[] = [];
  for (const r of rs) {
    const hit = lines.find((ln) => Math.min(ln.b, r.bottom) - Math.max(ln.t, r.top) > 0.6 * Math.min(ln.b - ln.t, r.height));
    if (hit) {
      hit.l = Math.min(hit.l, r.left);
      hit.r = Math.max(hit.r, r.right);
      hit.t = Math.min(hit.t, r.top);
      hit.b = Math.max(hit.b, r.bottom);
    } else lines.push({ l: r.left, t: r.top, r: r.right, b: r.bottom });
  }
  return lines.map((ln) => {
    const [x1, y1] = viewport.convertToPdfPoint(ln.l - origin.left, ln.t - origin.top);
    const [x2, y2] = viewport.convertToPdfPoint(ln.r - origin.left, ln.b - origin.top);
    return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)] as Rect;
  });
}
