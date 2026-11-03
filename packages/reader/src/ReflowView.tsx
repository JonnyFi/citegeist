import { rangeFromSource, resolveAnchor, type TextStream } from "@citegeist/anchoring";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { anchorsForRange } from "./anchors.js";
import {
  buildDomStream,
  type DomStream,
  domRangesOfStreamRange,
  snapDomRangeToWords,
  sourceRangeOfDomRange,
} from "./domStream.js";
import { HighlightLayer, highlightAt, type PlacedHighlight } from "./HighlightLayer.js";
import { SelectionPopover } from "./SelectionPopover.js";
import { sanitizeHtml } from "./sanitize.js";
import { ensureReaderStyles } from "./styles.js";
import type { HighlightStatus, ReaderHighlight, SelectionAnchors } from "./types.js";
import { useSelection } from "./useSelection.js";

export interface ReflowViewProps {
  /**
   * `doc.html` of the converted document. Block elements carry the block id as element id and
   * `data-page` / `data-label` (zero-based page index, printed label). Active content is removed.
   */
  html: string;
  /** Canonical document stream (`buildBlockStream`). New text anchors are made on it when given. */
  stream?: TextStream | undefined;
  highlights?: readonly ReaderHighlight[] | undefined;
  popoverLabel?: string | undefined;
  /** Toolbar slot, for example a `ReaderToolbar`. */
  toolbar?: ReactNode;
  onCreateAnchor?: ((anchors: SelectionAnchors) => void) | undefined;
  onSelectionChange?: ((anchors: SelectionAnchors | null) => void) | undefined;
  onHighlightClick?: ((id: string) => void) | undefined;
  onHighlightsResolved?: ((status: Record<string, HighlightStatus>) => void) | undefined;
}

export function ReflowView({
  html,
  stream,
  highlights = [],
  popoverLabel = "Create card",
  toolbar,
  onCreateAnchor,
  onSelectionChange,
  onHighlightClick,
  onHighlightsResolved,
}: ReflowViewProps) {
  ensureReaderStyles();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<HTMLDivElement>(null);
  const safe = useMemo(() => sanitizeHtml(html), [html]);
  const [ds, setDs] = useState<DomStream | null>(null);
  const [layout, setLayout] = useState(0);

  // the stream is built from the rendered DOM, because that is the text the user sees and selects
  // biome-ignore lint/correctness/useExhaustiveDependencies: safe is the content of docRef
  useLayoutEffect(() => {
    if (docRef.current) setDs(buildDomStream(docRef.current));
  }, [safe]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLayout((n) => n + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { placed, status } = useMemo(() => {
    void layout;
    const out: PlacedHighlight[] = [];
    const st: Record<string, HighlightStatus> = {};
    const body = bodyRef.current;
    if (!ds || !body) return { placed: out, status: st };
    const origin = body.getBoundingClientRect();
    for (const h of highlights) {
      const text = h.anchor.text;
      const r = text
        ? resolveAnchor(ds.stream, text, { pageHint: h.anchor.pdf?.page })
        : ({ status: "orphaned" } as const);
      if (r.status !== "anchored") {
        st[h.id] = "orphaned";
        continue;
      }
      const boxes = domRangesOfStreamRange(ds, r.start, r.end).flatMap((range) =>
        [...range.getClientRects()]
          .filter((c) => c.width > 0.5 && c.height > 0.5)
          .map((c) => ({
            left: c.left - origin.left,
            top: c.top - origin.top,
            width: c.width,
            height: c.height,
          })),
      );
      if (boxes.length === 0) {
        st[h.id] = "orphaned";
        continue;
      }
      out.push({ id: h.id, color: h.color, fill: h.fill, boxes });
      st[h.id] = "text";
    }
    return { placed: out, status: st };
  }, [ds, highlights, layout]);

  const statusKey = JSON.stringify(status);
  const resolvedRef = useRef(onHighlightsResolved);
  resolvedRef.current = onHighlightsResolved;
  // biome-ignore lint/correctness/useExhaustiveDependencies: statusKey stands for status
  useEffect(() => {
    if (ds) resolvedRef.current?.(status);
  }, [statusKey, ds]);

  const compute = (range: Range): SelectionAnchors | null => {
    if (!ds) return null;
    const src = sourceRangeOfDomRange(ds, range);
    if (!src) return null;
    const r = rangeFromSource(ds.stream, src.start, src.end);
    if (!r) return null;
    return anchorsForRange(ds.stream, r.start, r.end, stream);
  };
  const snap = (range: Range): Range | null => (ds ? snapDomRangeToWords(ds, range) : null);
  const pending = useSelection(scrollRef, compute, onSelectionChange, undefined, snap);

  return (
    <div className="cg-reader cg-reflow">
      {toolbar}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: highlights are also reachable from the card list */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: click hit-testing of highlights */}
      <div
        ref={scrollRef}
        className="cg-scroll"
        data-testid="reflow-scroll"
        onClick={(e) => {
          if (!scrollRef.current || !window.getSelection()?.isCollapsed) return;
          const id = highlightAt(scrollRef.current, e.clientX, e.clientY);
          if (id) onHighlightClick?.(id);
        }}
      >
        <div ref={bodyRef} className="cg-reflow-body">
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized by sanitizeHtml */}
          <div ref={docRef} className="cg-doc" dangerouslySetInnerHTML={{ __html: safe }} />
          <HighlightLayer highlights={placed} />
        </div>
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
