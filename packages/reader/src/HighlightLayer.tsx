import type { CSSProperties } from "react";

export interface HighlightBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PlacedHighlight {
  id: string;
  color?: string | undefined;
  boxes: HighlightBox[];
}

/** Custom highlight layer: absolutely positioned boxes, shared by the PDF and the reflow view. */
export function HighlightLayer({ highlights }: { highlights: PlacedHighlight[] }) {
  return (
    <div className="cg-hl-layer" aria-hidden="true">
      {highlights.map((h) =>
        h.boxes.map((b, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: boxes of one highlight have no identity
            key={`${h.id}:${i}`}
            className="cg-hl"
            data-highlight-id={h.id}
            style={
              {
                left: b.left,
                top: b.top,
                width: b.width,
                height: b.height,
                ...(h.color ? { "--cg-hl-color": h.color } : {}),
              } as CSSProperties
            }
          />
        )),
      )}
    </div>
  );
}

/** Id of the highlight under a client point, or null. Highlights do not take pointer events. */
export function highlightAt(root: HTMLElement, clientX: number, clientY: number): string | null {
  const els = root.querySelectorAll<HTMLElement>("[data-highlight-id]");
  for (let i = els.length - 1; i >= 0; i--) {
    const el = els[i];
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
      return el.dataset.highlightId ?? null;
    }
  }
  return null;
}
