import { useCallback, useEffect, useState } from "react";

/**
 * Where the user stopped reading an item. Kept in localStorage per item until the core stores it
 * with the item (a contract of its own).
 */
export interface ReadingPosition {
  /** Zero-based index of the first page in view. */
  page: number;
  /** Printed page label, when the document has one. */
  label?: string;
  /** Scroll offset as a share of the scrollable height, for documents without pages. */
  ratio: number;
  at: string;
}

const KEY = "citegeist.reading.";
const EVENT = "citegeist:reading";

export function loadReadingPosition(citekey: string): ReadingPosition | null {
  try {
    const raw = localStorage.getItem(KEY + citekey);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<ReadingPosition>;
    if (typeof value.page !== "number" || typeof value.ratio !== "number") return null;
    return {
      page: value.page,
      ratio: value.ratio,
      at: typeof value.at === "string" ? value.at : "",
      ...(typeof value.label === "string" && value.label ? { label: value.label } : {}),
    };
  } catch {
    return null;
  }
}

export function saveReadingPosition(citekey: string, position: ReadingPosition): void {
  try {
    localStorage.setItem(KEY + citekey, JSON.stringify(position));
  } catch {
    // storage unavailable: the position is simply not remembered
    return;
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: citekey }));
}

/** The stored position of an item; follows saves made while this hook is mounted. */
export function useReadingPosition(citekey: string): ReadingPosition | null {
  const [position, setPosition] = useState(() => loadReadingPosition(citekey));
  const refresh = useCallback(() => setPosition(loadReadingPosition(citekey)), [citekey]);
  useEffect(() => {
    refresh();
    window.addEventListener(EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [refresh]);
  return position;
}

/** Page and offset of the first page in view in a scroll container of the reader. */
export function measureReading(
  scroller: HTMLElement,
  labelOf?: (page: number) => string | undefined,
): Omit<ReadingPosition, "at"> {
  const top = scroller.getBoundingClientRect().top;
  const pages = scroller.querySelectorAll<HTMLElement>("[data-page]");
  let page = 0;
  let label: string | undefined;
  for (const el of pages) {
    if (el.getBoundingClientRect().bottom > top + 8) {
      page = Number(el.dataset.page) || 0;
      label = el.dataset.label || labelOf?.(page) || undefined;
      break;
    }
  }
  const room = scroller.scrollHeight - scroller.clientHeight;
  return { page, ratio: room > 0 ? scroller.scrollTop / room : 0, ...(label ? { label } : {}) };
}

/**
 * Records the reading position of `host` (the container of a PDF or reflow view) while it is
 * scrolled. Scroll events do not bubble, so the listener sits on the capture phase.
 */
export function trackReading(
  host: HTMLElement,
  citekey: string,
  labelOf?: (page: number) => string | undefined,
  delayMs = 400,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onScroll = (event: Event) => {
    const scroller = event.target;
    if (!(scroller instanceof HTMLElement)) return;
    if (!scroller.matches("[data-testid=pdf-scroll], [data-testid=reflow-scroll]")) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      saveReadingPosition(citekey, {
        ...measureReading(scroller, labelOf),
        at: new Date().toISOString(),
      });
    }, delayMs);
  };
  host.addEventListener("scroll", onScroll, true);
  return () => {
    clearTimeout(timer);
    host.removeEventListener("scroll", onScroll, true);
  };
}

/**
 * Scrolls the reader to a stored position. The PDF view renders its pages a moment after it
 * mounts, so this retries for a few seconds and stops at the first success.
 */
export function restoreReading(
  host: HTMLElement,
  position: ReadingPosition,
  attempts = 20,
  intervalMs = 150,
): () => void {
  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    const scroller = host.querySelector<HTMLElement>(
      "[data-testid=pdf-scroll], [data-testid=reflow-scroll]",
    );
    const page = scroller?.querySelector<HTMLElement>(`[data-page="${position.page}"]`);
    if (scroller && page) {
      scroller.scrollTop += page.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      clearInterval(timer);
    } else if (scroller && tries >= attempts) {
      const room = scroller.scrollHeight - scroller.clientHeight;
      if (room > 0) scroller.scrollTop = position.ratio * room;
      clearInterval(timer);
    } else if (tries >= attempts) {
      clearInterval(timer);
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
