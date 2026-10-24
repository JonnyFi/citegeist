import { type RefObject, useEffect, useRef, useState } from "react";

export interface PendingSelection<T> {
  value: T;
  /** clone of the DOM range, for the popover position */
  range: Range;
}

/**
 * Tracks the document selection inside `rootRef`. `compute` turns the live selection range into the
 * view's value (anchors) or null when the selection is not usable. Updates are debounced, because
 * `selectionchange` fires on every pointer move while the user drags.
 *
 * `snap` returns the range with its edges moved to word boundaries, or null when the range is
 * already on word boundaries. Once the pointer is up, the live selection is replaced by that
 * range, so what the reader sees selected is what the card will quote. While the pointer is down
 * the selection is left alone, because replacing it mid-drag would fight the user's hand.
 */
export function useSelection<T>(
  rootRef: RefObject<HTMLElement | null>,
  compute: (range: Range) => T | null,
  onChange?: (value: T | null) => void,
  delayMs = 120,
  snap?: (range: Range) => Range | null,
): PendingSelection<T> | null {
  const [pending, setPending] = useState<PendingSelection<T> | null>(null);
  const computeRef = useRef(compute);
  const onChangeRef = useRef(onChange);
  const snapRef = useRef(snap);
  snapRef.current = snap;
  computeRef.current = compute;
  onChangeRef.current = onChange;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pointerDown = false;
    // the range this hook set last, so that a snap that does not settle cannot loop
    let applied: Range | null = null;
    const same = (a: Range, b: Range) =>
      a.startContainer === b.startContainer &&
      a.startOffset === b.startOffset &&
      a.endContainer === b.endContainer &&
      a.endOffset === b.endOffset;
    const run = () => {
      const root = rootRef.current;
      const sel = window.getSelection();
      let next: PendingSelection<T> | null = null;
      if (root && sel && sel.rangeCount > 0 && !sel.isCollapsed) {
        let range = sel.getRangeAt(0);
        if (!pointerDown && snapRef.current && root.contains(range.commonAncestorContainer)) {
          const snapped = snapRef.current(range);
          if (snapped && !(applied && same(applied, snapped))) {
            applied = snapped;
            sel.setBaseAndExtent(
              snapped.startContainer,
              snapped.startOffset,
              snapped.endContainer,
              snapped.endOffset,
            );
            range = sel.getRangeAt(0);
          }
        }
        if (root.contains(range.commonAncestorContainer)) {
          const value = computeRef.current(range);
          if (value !== null) next = { value, range: range.cloneRange() };
        }
      }
      setPending((prev) => (prev === null && next === null ? prev : next));
      onChangeRef.current?.(next ? next.value : null);
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(run, delayMs);
    };
    const down = () => {
      pointerDown = true;
    };
    const up = () => {
      pointerDown = false;
      schedule();
    };
    document.addEventListener("selectionchange", schedule);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", up, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", schedule);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", up, true);
    };
  }, [rootRef, delayMs]);

  return pending;
}
