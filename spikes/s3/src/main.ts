import 'pdfjs-dist/web/pdf_viewer.css';
import { TextLayer } from 'pdfjs-dist';
import type { PageViewport } from 'pdfjs-dist';
import {
  type Anchored,
  type NormOptions,
  type ReanchorOptions,
  type TextAnchor,
  fromString,
  iou,
  looseSimilarity,
  makeTextAnchor,
  normalize,
  reanchor,
  truthRange,
} from './anchoring.ts';
import {
  type DocModel,
  type Reflow,
  type Rect,
  type Stream,
  buildReflow,
  buildStream,
  domRectsToPdfRects,
  itemRangeToRects,
  loadDoc,
  pageOfSrc,
  pdfStream,
  textInRects,
} from './pdfmodel.ts';
import { type PerturbName, perturb, rng } from './perturb.ts';

const SCALE = 1.5;
const params = new URLSearchParams(location.search);
const pdfEl = document.getElementById('pdf')!;
const reflowEl = document.getElementById('reflow')!;
const infoEl = document.getElementById('info')!;

let doc: DocModel;
let docName = '';
let viewports: PageViewport[] = [];
let textDivs: HTMLElement[][] = [];
let pdfNorm = fromString('');
let reflow: Reflow = { paragraphs: [], paraPage: [] };

// ------------------------------------------------------------------ rendering

async function renderPdf(withCanvas: boolean) {
  pdfEl.innerHTML = '';
  viewports = [];
  textDivs = [];
  for (const pm of doc.pages) {
    const page = await doc.pdf.getPage(pm.index + 1);
    const viewport = page.getViewport({ scale: SCALE });
    viewports.push(viewport);
    const div = document.createElement('div');
    div.className = 'page';
    div.dataset.page = String(pm.index);
    div.style.width = `${viewport.width}px`;
    div.style.height = `${viewport.height}px`;
    div.style.setProperty('--scale-factor', String(SCALE));
    div.style.setProperty('--total-scale-factor', String(SCALE));
    pdfEl.append(div);
    if (withCanvas) {
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      div.append(canvas);
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport, canvas }).promise;
    }
    const layer = document.createElement('div');
    layer.className = 'textLayer';
    div.append(layer);
    const tl = new TextLayer({ textContentSource: pm.content, container: layer, viewport });
    await tl.render();
    if (tl.textDivs.length !== pm.items.length) throw new Error(`page ${pm.index}: ${tl.textDivs.length} text divs vs ${pm.items.length} items`);
    tl.textDivs.forEach((d, i) => (d.dataset.item = String(i)));
    textDivs.push(tl.textDivs);
    const hl = document.createElement('div');
    hl.className = 'hl';
    div.append(hl);
  }
}

function drawQuads(page: number, rects: Rect[], cls = 'quad') {
  const hl = pdfEl.querySelector(`.page[data-page="${page}"] .hl`)!;
  const vp = viewports[page];
  for (const r of rects) {
    const [x1, y1] = vp.convertToViewportPoint(r[0], r[1]);
    const [x2, y2] = vp.convertToViewportPoint(r[2], r[3]);
    const d = document.createElement('div');
    d.className = cls;
    d.style.cssText = `left:${Math.min(x1, x2)}px;top:${Math.min(y1, y2)}px;width:${Math.abs(x2 - x1)}px;height:${Math.abs(y2 - y1)}px`;
    hl.append(d);
  }
}

// -------------------------------------------------------------- reflow view

interface Variant {
  perturb: PerturbName[];
  norm: NormOptions | null;
  seed?: number;
}

function streamFor(v: Variant): Stream {
  const paras = v.perturb.length ? perturb(reflow.paragraphs, v.perturb, v.seed ?? 7) : reflow.paragraphs;
  return buildStream(doc, paras, v.norm);
}

function renderReflow(s: Stream, marks: { start: number; end: number; cls: string }[]) {
  reflowEl.innerHTML = '';
  const text = s.m.text;
  const bounds = [...s.paraStarts, text.length + 1];
  for (let i = 0; i < s.paraStarts.length; i++) {
    const a = bounds[i];
    const b = bounds[i + 1] - 1;
    const p = document.createElement('p');
    let at = a;
    for (const mk of marks.filter((m) => m.end > a && m.start < b).sort((x, y) => x.start - y.start)) {
      const ms = Math.max(mk.start, a);
      const me = Math.min(mk.end, b);
      p.append(text.slice(at, ms));
      const el = document.createElement('mark');
      el.className = mk.cls;
      el.textContent = text.slice(ms, me);
      p.append(el);
      at = me;
    }
    p.append(text.slice(at, b));
    reflowEl.append(p);
  }
}

// -------------------------------------------------------------------- capture

export interface PdfAnchor {
  page: number;
  quads: Rect[];
}

export interface Captured {
  pdf: PdfAnchor;
  text: TextAnchor;
  /** item-space range of the selection (ground truth for tests) */
  rs: number;
  re: number;
}

interface Boundary {
  page: number;
  item: number;
  off: number;
}

function boundary(node: Node, offset: number, isStart: boolean): Boundary | null {
  let el: Element | null = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  let span = el?.closest<HTMLElement>('span[data-item]') ?? null;
  let off = node.nodeType === Node.TEXT_NODE ? offset : offset === 0 ? 0 : -1;
  if (!span && el) {
    const child = (node.childNodes[isStart ? offset : offset - 1] ?? null) as Element | null;
    span = child ? (child.matches?.('span[data-item]') ? (child as HTMLElement) : child.querySelector<HTMLElement>('span[data-item]')) : null;
    off = isStart ? 0 : -1;
  }
  if (!span) return null;
  const page = Number(span.closest<HTMLElement>('.page')!.dataset.page);
  const item = Number(span.dataset.item);
  if (off === -1) off = doc.pages[page].items[item].str.length;
  return { page, item, off };
}

/** Compute both anchors from the current DOM selection of the PDF text layer. */
export function captureSelection(): Captured | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const a = boundary(range.startContainer, range.startOffset, true);
  const b = boundary(range.endContainer, range.endOffset, false);
  if (!a || !b || a.page !== b.page) return null; // cross-page selections are out of scope for the spike
  const items = doc.pages[a.page].items;
  const rs = items[a.item].base + a.off;
  const re = items[b.item].base + b.off;
  if (re <= rs) return null;

  const pageEl = pdfEl.querySelector<HTMLElement>(`.page[data-page="${a.page}"]`)!;
  const box = pageEl.getBoundingClientRect();
  const quads = domRectsToPdfRects([...range.getClientRects()], { left: box.left, top: box.top }, viewports[a.page]);

  // text anchor in the normalised PDF stream; trim edge whitespace
  const tr = truthRange(pdfNorm.src, rs, re);
  if (!tr) return null;
  let { start, end } = tr;
  while (start < end && pdfNorm.text[start] === ' ') start++;
  while (end > start && pdfNorm.text[end - 1] === ' ') end--;
  return { pdf: { page: a.page, quads }, text: makeTextAnchor(pdfNorm.text, start, end), rs, re };
}

// ------------------------------------------------------------ synthetic selections

function itemAt(page: number, charPos: number): { item: number; off: number } {
  const items = doc.pages[page].items;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].str.length > 0 && items[i].base <= charPos) return { item: i, off: charPos - items[i].base };
  }
  return { item: 0, off: 0 };
}

export interface Synth {
  id: string;
  doc: string;
  page: number;
  intended: { rs: number; re: number };
  cap: Captured;
  captureOk: boolean;
}

/** Create n selections via the real DOM selection API at pseudo-random word-aligned positions. */
function synthesise(n: number, seed: number): Synth[] {
  const rand = rng(seed);
  const out: Synth[] = [];
  const pages = doc.pages.filter((p) => p.end - p.start > 1500);
  let guard = 0;
  while (out.length < n && guard++ < n * 50) {
    const pm = pages[Math.floor(rand() * pages.length)];
    const pageText = pm.items.map((i) => i.str).join('');
    // word starts
    const starts: number[] = [];
    for (const m of pageText.matchAll(/(?<![\p{L}\p{N}])[\p{L}\p{N}]/gu)) starts.push(m.index!);
    if (starts.length < 60) continue;
    const si = Math.floor(rand() * (starts.length - 50));
    const nWords = 4 + Math.floor(rand() * 37);
    const startChar = starts[si];
    // end of the nWords-th word
    const rest = pageText.slice(startChar);
    const words = [...rest.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu)];
    const w = words[Math.min(nWords, words.length) - 1];
    const endChar = startChar + w.index! + w[0].length;
    const exact = pageText.slice(startChar, endChar);
    const letters = (exact.match(/\p{L}/gu) ?? []).length;
    if (exact.length < 20 || letters / exact.length < 0.6) continue; // prose-like selections only

    const s = itemAt(pm.index, pm.start + startChar);
    const e = itemAt(pm.index, pm.start + endChar - 1);
    const sn = textDivs[pm.index][s.item].firstChild!;
    const en = textDivs[pm.index][e.item].firstChild!;
    const range = document.createRange();
    range.setStart(sn, s.off);
    range.setEnd(en, e.off + 1);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    const cap = captureSelection();
    sel.removeAllRanges();
    if (!cap) continue;
    const base = pm.start;
    out.push({
      id: `${docName}-${out.length}`,
      doc: docName,
      page: pm.index,
      intended: { rs: base + startChar, re: base + endChar },
      cap,
      captureOk: cap.rs === base + startChar && cap.re === base + endChar,
    });
  }
  return out;
}

// ------------------------------------------------------------------ evaluation

export interface EvalConfig {
  perturb: PerturbName[];
  /** null: no normalisation of the target stream */
  norm: NormOptions | null;
  reanchor?: ReanchorOptions;
  /** use the page-hinted window (default true) */
  useWindow?: boolean;
  seed?: number;
}

export interface EvalRow {
  id: string;
  ok: boolean;
  found: boolean;
  wrongPlace: boolean;
  method: string;
  ambiguous: boolean;
  quoteScore: number;
  score: number;
  pageOk: boolean;
  /** found range overlaps the truth at all (right place, boundaries may drift) */
  overlaps: boolean;
  exactLen: number;
  exact: string;
  got: string;
  want: string;
}

function evaluate(items: Synth[], cfg: EvalConfig): EvalRow[] {
  const s = streamFor({ perturb: cfg.perturb, norm: cfg.norm, seed: cfg.seed });
  const text = s.m.text;
  return items.map((it) => {
    const a = it.cap.text;
    const p = it.cap.pdf.page;
    const win = cfg.useWindow === false ? undefined : { start: s.pageRanges[Math.max(0, p - 1)].start, end: s.pageRanges[Math.min(doc.pages.length - 1, p + 1)].end };
    const r: Anchored | null = reanchor(text, a, { ...cfg.reanchor, window: win });
    const truth = truthRange(s.m.src, it.cap.rs, it.cap.re);
    let ok = false;
    let pageOk = false;
    let overlaps = false;
    if (r && truth) {
      overlaps = iou(r.start, r.end, truth.start, truth.end) > 0;
      ok = iou(r.start, r.end, truth.start, truth.end) >= 0.8;
      const first = s.m.src.slice(r.start, r.end).find((x) => x >= 0) ?? -1;
      pageOk = pageOfSrc(doc, first) === p;
    }
    return {
      id: it.id,
      ok,
      found: !!r,
      wrongPlace: !!r && !ok,
      method: r?.method ?? 'orphan',
      ambiguous: !!r?.ambiguous,
      quoteScore: r?.quoteScore ?? 0,
      score: r?.score ?? 0,
      pageOk,
      overlaps,
      exactLen: a.exact.length,
      exact: a.exact,
      got: r ? text.slice(r.start, r.end) : '',
      want: truth ? text.slice(truth.start, truth.end) : '',
    };
  });
}

/** Negative control: the paragraphs holding the selection are deleted; a correct re-anchor reports an orphan. */
function negativeControl(items: Synth[], opts: ReanchorOptions) {
  return items.map((it) => {
    const paras = reflow.paragraphs.filter((p) => !p.src.some((x) => x >= it.cap.rs && x < it.cap.re));
    const s = buildStream(doc, paras, { ligatures: true });
    const p = it.cap.pdf.page;
    const win = { start: s.pageRanges[Math.max(0, p - 1)].start, end: s.pageRanges[Math.min(doc.pages.length - 1, p + 1)].end };
    const r = reanchor(s.m.text, it.cap.text, { ...opts, window: win });
    return { id: it.id, orphaned: !r, method: r?.method ?? 'orphan', quoteScore: r?.quoteScore ?? 0, score: r?.score ?? 0, exactLen: it.cap.text.exact.length, exact: it.cap.text.exact, got: r ? s.m.text.slice(r.start, r.end) : '' };
  });
}

/** PDF anchor -> text (via geometry only) -> locate in the reflow stream (no page hint, no context). */
function quadRoundTrip(items: Synth[]) {
  const s = streamFor({ perturb: [], norm: {} });
  return items.map((it) => {
    const pm = doc.pages[it.cap.pdf.page];
    const qText = normalize(fromString(textInRects(pm, it.cap.pdf.quads)), { ligatures: true }).text;
    const sim = looseSimilarity(qText, it.cap.text.exact);
    const probe: TextAnchor = { exact: qText, prefix: '', suffix: '', position: { start: Math.floor(s.m.text.length / 2), end: 0 }, stream: it.cap.text.stream };
    const r = qText ? reanchor(s.m.text, probe) : null;
    const first = r ? (s.m.src.slice(r.start, r.end).find((x) => x >= 0) ?? -1) : -1;
    const truth = truthRange(s.m.src, it.cap.rs, it.cap.re);
    return {
      id: it.id,
      textOk: sim >= 0.9,
      sim,
      pageOk: pageOfSrc(doc, first) === it.cap.pdf.page,
      spanOk: !!r && !!truth && iou(r.start, r.end, truth.start, truth.end) >= 0.8,
      ambiguous: !!r?.ambiguous,
    };
  });
}

// ------------------------------------------------------------------------- init

async function load(name: string, withCanvas = false) {
  docName = name;
  doc = await loadDoc(`/data/${name}.pdf`);
  await renderPdf(withCanvas);
  pdfNorm = normalize(pdfStream(doc), { ligatures: true });
  reflow = buildReflow(doc);
  const s = streamFor({ perturb: [], norm: {} });
  renderReflow(s, []);
  infoEl.textContent = `${name}: ${doc.pages.length} pages, ${doc.totalChars} item chars, ${reflow.paragraphs.length} paragraphs, stream ${s.m.text.length} chars`;
  return { pages: doc.pages.length, itemChars: doc.totalChars, paragraphs: reflow.paragraphs.length, streamChars: s.m.text.length, pdfStreamChars: pdfNorm.text.length };
}

// Interactive: select text in the PDF, see both anchors, re-anchor in the reflow view.
interface Saved {
  cap: Captured;
}
const saved: Saved[] = [];
const outEl = document.getElementById('out')!;
document.getElementById('save')!.addEventListener('click', () => {
  const cap = captureSelection();
  if (!cap) return void (outEl.textContent = 'no selection');
  saved.push({ cap });
  drawQuads(cap.pdf.page, cap.pdf.quads);
  outEl.textContent = JSON.stringify({ pdf: cap.pdf, text: cap.text }, null, 1);
  refresh();
});
const perturbBox = document.getElementById('perturb') as HTMLInputElement;
perturbBox.addEventListener('change', refresh);
function refresh() {
  const names: PerturbName[] = perturbBox.checked ? ['ws', 'lig', 'hyph', 'word'] : [];
  const s = streamFor({ perturb: names, norm: {} });
  const marks = saved.flatMap((sv) => {
    const p = sv.cap.pdf.page;
    const win = { start: s.pageRanges[Math.max(0, p - 1)].start, end: s.pageRanges[Math.min(doc.pages.length - 1, p + 1)].end };
    const r = reanchor(s.m.text, sv.cap.text, { window: win });
    return r ? [{ start: r.start, end: r.end, cls: r.method === 'position' || r.method === 'exact' ? 'exact' : 'fuzzy' }] : [];
  });
  renderReflow(s, marks);
}

declare global {
  interface Window {
    spike: unknown;
  }
}

window.spike = {
  load,
  synthesise,
  evaluate,
  quadRoundTrip,
  negativeControl,
  itemRangeToRects,
};

const initial = params.get('pdf');
if (initial) await load(initial, params.get('canvas') === '1');
document.body.dataset.ready = '1';
