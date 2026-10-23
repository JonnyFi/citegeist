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
 */
export function useSelection<T>(
  rootRef: RefObject<HTMLElement | null>,
  compute: (range: Range) => T | null,
  onChange?: (value: T | null) => void,
  delayMs = 120,
): PendingSelection<T> | null {
  const [pending, setPending] = useState<PendingSelection<T> | null>(null);
  const computeRef = useRef(compute);
  const onChangeRef = useRef(onChange);
  computeRef.current = compute;
  onChangeRef.current = onChange;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      const root = rootRef.current;
      const sel = window.getSelection();
      let next: PendingSelection<T> | null = null;
      if (root && sel && sel.rangeCount > 0 && !sel.isCollapsed) {
        const range = sel.getRangeAt(0);
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
    document.addEventListener("selectionchange", schedule);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", schedule);
    };
  }, [rootRef, delayMs]);

  return pending;
}
