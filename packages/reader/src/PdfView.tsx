import {
  rangeFromSource,
  resolveAnchor,
  snapToWordBoundaries,
  type TextStream,
  toSource,
} from "@citegeist/anchoring";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { anchorsForRange } from "./anchors.js";
import { HighlightLayer, highlightAt, type PlacedHighlight } from "./HighlightLayer.js";
import {
  buildPageTexts,
  buildPdfStream,
  domRectsToPdfRects,
  itemOfSource,
  type PdfPageText,
  pdfRectToBox,
  type RawTextItem,
  textRangeToRects,
} from "./pdf/model.js";
import { loadPdfjs } from "./pdf/pdfjs.js";
import { SelectionPopover } from "./SelectionPopover.js";
import { ensureReaderStyles } from "./styles.js";
import type { HighlightStatus, ReaderHighlight, SelectionAnchors } from "./types.js";
import { useSelection } from "./useSelection.js";

type TextContent = Awaited<ReturnType<PDFPageProxy["getTextContent"]>>;

interface LoadedPage {
  proxy: PDFPageProxy;
  content: TextContent;
}

interface LoadedPdf {
  pdf: PDFDocumentProxy;
  pages: LoadedPage[];
  texts: PdfPageText[];
  labels: (string | null)[];
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; doc: LoadedPdf };

function usePdf(data: Uint8Array, labelsProp: readonly (string | null)[] | undefined): LoadState {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | undefined;
    setState({ status: "loading" });
    (async () => {
      const pdfjs = await loadPdfjs();
      // pdf.js transfers the buffer to its worker, so it gets a copy
      const task = pdfjs.getDocument({ data: data.slice() });
      destroy = () => void task.destroy();
      const pdf = await task.promise;
      const pages: LoadedPage[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const proxy = await pdf.getPage(i);
        pages.push({ proxy, content: await proxy.getTextContent() });
      }
      const texts = buildPageTexts(pages.map((p) => textItemsOf(p.content)));
      const labels = labelsProp ? [...labelsProp] : ((await pdf.getPageLabels()) ?? []);
      if (!cancelled) setState({ status: "ready", doc: { pdf, pages, texts, labels } });
    })().catch((e: unknown) => {
      if (!cancelled) setState({ status: "error", message: String(e) });
    });
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [data, labelsProp]);
  return state;
}

function textItemsOf(content: TextContent): RawTextItem[] {
  const out: RawTextItem[] = [];
  for (const it of content.items) if ("str" in it) out.push(it);
  return out;
}

export interface PdfViewProps {
  /** The PDF file. The component never fetches. */
  data: Uint8Array;
  /** Source hash of the PDF (`SourceHash`); written into new PDF anchors and checked on stored ones. */
  source: string;
  /** Printed page labels by page index. Defaults to the labels inside the PDF. */
  pageLabels?: readonly (string | null)[] | undefined;
  /** Canonical document stream (`buildBlockStream`). New text anchors are made on it when given. */
  stream?: TextStream | undefined;
  highlights?: readonly ReaderHighlight[] | undefined;
  scale?: number | undefined;
  /** Set to false to skip the canvas, for example in tests. The text layer is always drawn. */
  renderCanvas?: boolean | undefined;
  /** Label of the selection popover action. */
  popoverLabel?: string | undefined;
  /** Toolbar slot, for example a `ReaderToolbar`. */
  toolbar?: ReactNode;
  /** The user pressed the popover action. */
  onCreateAnchor?: ((anchors: SelectionAnchors) => void) | undefined;
  /** Fires with the current selection, or null when there is none. */
  onSelectionChange?: ((anchors: SelectionAnchors | null) => void) | undefined;
  onHighlightClick?: ((id: string) => void) | undefined;
  /** How every highlight was placed. Orphaned ones need a manual repair. */
  onHighlightsResolved?: ((status: Record<string, HighlightStatus>) => void) | undefined;
}

export function PdfView({
  data,
  source,
  pageLabels,
  stream,
  highlights = [],
  scale = 1.25,
  renderCanvas = true,
  popoverLabel = "Create card",
  toolbar,
  onCreateAnchor,
  onSelectionChange,
  onHighlightClick,
  onHighlightsResolved,
}: PdfViewProps) {
  ensureReaderStyles();
  const state = usePdf(data, pageLabels);
  const scrollRef = useRef<HTMLDivElement>(null);
  const doc = state.status === "ready" ? state.doc : null;

  const pdfStream = useMemo(() => (doc ? buildPdfStream(doc.texts, doc.labels) : null), [doc]);
  const viewports = useMemo(
    () => doc?.pages.map((p) => p.proxy.getViewport({ scale })) ?? [],
    [doc, scale],
  );

  const placed = useMemo(() => {
    const byPage = new Map<number, PlacedHighlight[]>();
    const status: Record<string, HighlightStatus> = {};
    if (!doc || !pdfStream) return { byPage, status };
    const add = (page: number, h: PlacedHighlight) => {
      const list = byPage.get(page) ?? [];
      list.push(h);
      byPage.set(page, list);
    };
    for (const h of highlights) {
      const { pdf, text } = h.anchor;
      const vp = (i: number) => viewports[i];
      if (pdf && pdf.file === source && vp(pdf.page)) {
        const v = vp(pdf.page);
        if (v) {
          add(pdf.page, {
            id: h.id,
            color: h.color,
            fill: h.fill,
            boxes: pdf.quads.map((q) => pdfRectToBox(q, v)),
          });
          status[h.id] = "pdf";
          continue;
        }
      }
      if (text) {
        const r = resolveAnchor(pdfStream, text, { pageHint: pdf?.page });
        const src = r.status === "anchored" ? toSource(pdfStream, r.start, r.end) : null;
        if (src) {
          const perPage = new Map<number, PlacedHighlight>();
          for (const page of doc.texts) {
            const a = Math.max(src.start, page.base) - page.base;
            const b = Math.min(src.end, page.base + page.text.length) - page.base;
            const v = vp(page.index);
            if (b <= a || !v) continue;
            const boxes = textRangeToRects(page, a, b).map((q) => pdfRectToBox(q, v));
            perPage.set(page.index, { id: h.id, color: h.color, fill: h.fill, boxes });
          }
          if (perPage.size > 0) {
            for (const [p, ph] of perPage) add(p, ph);
            status[h.id] = "text";
            continue;
          }
        }
      }
      status[h.id] = "orphaned";
    }
    return { byPage, status };
  }, [doc, pdfStream, viewports, highlights, source]);

  const statusKey = JSON.stringify(placed.status);
  const resolvedRef = useRef(onHighlightsResolved);
  resolvedRef.current = onHighlightsResolved;
  // biome-ignore lint/correctness/useExhaustiveDependencies: statusKey stands for placed.status
  useEffect(() => {
    if (doc) resolvedRef.current?.(placed.status);
  }, [statusKey, doc]);

  /** Stream range of a DOM range in the text layer, without any snapping. */
  const streamRangeOf = (range: Range): { start: number; end: number; page: number } | null => {
    if (!doc || !pdfStream) return null;
    const a = boundary(doc.texts, range.startContainer, range.startOffset, true);
    const b = boundary(doc.texts, range.endContainer, range.endOffset, false);
    if (!a || !b) return null;
    const first = doc.texts[a.page];
    const last = doc.texts[b.page];
    const startItem = first?.items[a.item];
    const endItem = last?.items[b.item];
    if (!first || !last || !startItem || !endItem) return null;
    const srcStart = first.base + startItem.start + a.offset;
    const srcEnd = last.base + endItem.start + b.offset;
    const r = rangeFromSource(pdfStream, srcStart, srcEnd);
    return r ? { ...r, page: a.page } : null;
  };

  /** DOM range in the text layer for a range of the PDF stream. */
  const domRangeOf = (start: number, end: number): Range | null => {
    if (!doc || !pdfStream) return null;
    const src = toSource(pdfStream, start, end);
    if (!src) return null;
    const a = itemOfSource(doc.texts, src.start, false);
    const b = itemOfSource(doc.texts, src.end, true);
    if (!a || !b) return null;
    const textOf = (p: { page: number; item: number }) =>
      scrollRef.current?.querySelector<HTMLElement>(
        `.cg-page[data-page="${p.page}"] span[data-item="${p.item}"]`,
      )?.firstChild;
    const na = textOf(a);
    const nb = textOf(b);
    if (!na || !nb) return null;
    const out = document.createRange();
    out.setStart(na, a.offset);
    out.setEnd(nb, b.offset);
    return out;
  };

  /** The selection with its edges on word boundaries, or null when it is already there. */
  const snap = (range: Range): Range | null => {
    const sr = streamRangeOf(range);
    if (!sr || !pdfStream) return null;
    const s = snapToWordBoundaries(pdfStream.text, sr.start, sr.end);
    if (s.start === sr.start && s.end === sr.end) return null;
    return domRangeOf(s.start, s.end);
  };

  const compute = (range: Range): SelectionAnchors | null => {
    if (!pdfStream) return null;
    const sr = streamRangeOf(range);
    if (!sr) return null;
    // The anchors always use whole words, even while the live selection has not been snapped yet.
    const s = snapToWordBoundaries(pdfStream.text, sr.start, sr.end);
    const anchors = anchorsForRange(pdfStream, s.start, s.end, stream);
    if (!anchors) return null;
    const moved = s.start !== sr.start || s.end !== sr.end;
    const effective = (moved ? domRangeOf(s.start, s.end) : null) ?? range;
    const startPage = (() => {
      const src = toSource(pdfStream, s.start, s.end);
      return (src && doc ? itemOfSource(doc.texts, src.start, false)?.page : undefined) ?? sr.page;
    })();
    const pageEl = scrollRef.current?.querySelector<HTMLElement>(
      `.cg-page[data-page="${startPage}"]`,
    );
    const vp = viewports[startPage];
    if (!pageEl || !vp) return { ...anchors };
    const box = pageEl.getBoundingClientRect();
    // quads for the part of the selection on the first page
    const onPage = [...effective.getClientRects()].filter((c) => {
      const cy = (c.top + c.bottom) / 2;
      return cy >= box.top && cy <= box.bottom && c.right >= box.left && c.left <= box.right;
    });
    const quads = domRectsToPdfRects(onPage, { left: box.left, top: box.top }, vp);
    if (quads.length === 0) return { ...anchors };
    return { ...anchors, pdfAnchor: { page: startPage, quads, file: source } };
  };

  const pending = useSelection(scrollRef, compute, onSelectionChange, undefined, snap);

  return (
    <div className="cg-reader cg-pdf">
      {toolbar}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: highlights are also reachable from the card list */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: click hit-testing of highlights */}
      <div
        ref={scrollRef}
        className="cg-scroll"
        data-testid="pdf-scroll"
        onClick={(e) => {
          if (!scrollRef.current || !window.getSelection()?.isCollapsed) return;
          const id = highlightAt(scrollRef.current, e.clientX, e.clientY);
          if (id) onHighlightClick?.(id);
        }}
      >
        {state.status === "loading" ? <div className="cg-status">Loading PDF</div> : null}
        {state.status === "error" ? (
          <div className="cg-status" role="alert">
            {state.message}
          </div>
        ) : null}
        {doc?.pages.map((p, i) => {
          const viewport = viewports[i];
          if (!viewport) return null;
          return (
            <PdfPage
              key={p.proxy.pageNumber}
              index={i}
              page={p}
              scale={scale}
              width={viewport.width}
              height={viewport.height}
              renderCanvas={renderCanvas}
              highlights={placed.byPage.get(i) ?? []}
            />
          );
        })}
      </div>
      {pending ? (
        <SelectionPopover
          range={pending.range}
          label={popoverLabel}
          onAction={() => {
            onCreateAnchor?.(pending.value);
            window.getSelection()?.removeAllRanges();
          }}
        />
      ) : null}
    </div>
  );
}

interface PdfPageProps {
  index: number;
  page: LoadedPage;
  scale: number;
  width: number;
  height: number;
  renderCanvas: boolean;
  highlights: PlacedHighlight[];
}

function PdfPage({ index, page, scale, width, height, renderCanvas, highlights }: PdfPageProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || visible) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin: "800px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const textEl = textRef.current;
    const canvas = canvasRef.current;
    if (!textEl) return;
    let cancelled = false;
    let cleanup: Array<() => void> = [];
    (async () => {
      const pdfjs = await loadPdfjs();
      const viewport = page.proxy.getViewport({ scale });
      textEl.replaceChildren();
      const layer = new pdfjs.TextLayer({
        textContentSource: page.content,
        container: textEl,
        viewport,
      });
      cleanup.push(() => layer.cancel());
      await layer.render();
      if (cancelled) return;
      const items = textItemsOf(page.content);
      if (layer.textDivs.length !== items.length) {
        console.warn(
          `reader: page ${index}: ${layer.textDivs.length} text divs for ${items.length} items`,
        );
      }
      layer.textDivs.forEach((d, i) => {
        d.dataset.item = String(i);
      });
      if (renderCanvas && canvas) {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const task = page.proxy.render({
            canvasContext: ctx,
            canvas,
            viewport,
            transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
          });
          cleanup.push(() => task.cancel());
          await task.promise;
        }
      }
    })().catch((e: unknown) => {
      // a cancelled render rejects, which is expected when the page scrolls away or rescales
      if (!cancelled && !String(e).includes("cancelled"))
        console.warn("reader: page render failed", e);
    });
    return () => {
      cancelled = true;
      for (const c of cleanup) c();
      cleanup = [];
    };
  }, [visible, page, scale, renderCanvas, index]);

  return (
    <div
      ref={rootRef}
      className="cg-page"
      data-page={index}
      style={
        {
          width,
          height,
          "--scale-factor": scale,
          "--total-scale-factor": scale,
        } as CSSProperties
      }
    >
      <canvas ref={canvasRef} style={{ width, height }} />
      <div ref={textRef} className="textLayer" />
      <HighlightLayer highlights={highlights} />
    </div>
  );
}

interface Boundary {
  page: number;
  item: number;
  offset: number;
}

/** Page, text item and character offset of a DOM range boundary inside a pdf.js text layer. */
function boundary(
  texts: readonly PdfPageText[],
  node: Node,
  offset: number,
  isStart: boolean,
): Boundary | null {
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  let span = el?.closest<HTMLElement>("span[data-item]") ?? null;
  let off = node.nodeType === Node.TEXT_NODE ? offset : offset === 0 ? 0 : -1;
  if (!span && el) {
    const child = (node.childNodes[isStart ? offset : offset - 1] ?? null) as Element | null;
    span = child
      ? child.matches?.("span[data-item]")
        ? (child as HTMLElement)
        : child.querySelector<HTMLElement>("span[data-item]")
      : null;
    off = isStart ? 0 : -1;
  }
  if (!span) return null;
  const pageEl = span.closest<HTMLElement>(".cg-page");
  if (!pageEl) return null;
  const page = Number(pageEl.dataset.page);
  const item = Number(span.dataset.item);
  const it = texts[page]?.items[item];
  if (!it) return null;
  return { page, item, offset: off === -1 ? it.str.length : Math.min(off, it.str.length) };
}
