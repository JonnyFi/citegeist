import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useI18n } from "../i18n";
import { cn } from "../lib/utils";

export const ASIDE_WIDTH_KEY = "citegeist.asideWidth";
export const ASIDE_DEFAULT = 360;
export const ASIDE_MIN = 280;
/** The main area never gets narrower than this. */
export const MAIN_MIN = 480;
const MAX_SHARE = 0.6;
const STEP = 16;
const STEP_SHIFT = 64;
const CSS_VAR = "--aside-width";

/** Largest width the column may take in a window and a flex row of the given widths. */
export function asideMax(windowWidth: number, rowWidth: number): number {
  let max = Math.floor(windowWidth * MAX_SHARE);
  // jsdom and detached trees report no width: only the window share applies then
  if (rowWidth > 0) max = Math.min(max, rowWidth - MAIN_MIN);
  return Math.max(ASIDE_MIN, max);
}

export function clampAside(width: number, max: number): number {
  return Math.min(max, Math.max(ASIDE_MIN, Math.round(width)));
}

function loadWidth(): number {
  try {
    const n = Number(localStorage.getItem(ASIDE_WIDTH_KEY));
    return Number.isFinite(n) && n > 0 ? n : ASIDE_DEFAULT;
  } catch {
    return ASIDE_DEFAULT;
  }
}

function saveWidth(width: number): void {
  try {
    if (width === ASIDE_DEFAULT) localStorage.removeItem(ASIDE_WIDTH_KEY);
    else localStorage.setItem(ASIDE_WIDTH_KEY, String(width));
  } catch {
    // storage unavailable, the width still holds for this session
  }
}

/**
 * Drag handle on the left edge of the right column. The width lives in the CSS variable
 * --aside-width on the root (read by `w-aside`), so a drag only writes a style property and
 * never re-renders. The stored preference is kept as chosen and clamped on the way out, so a
 * window that grows again gives the column its width back.
 */
export function AsideResizeHandle() {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [preferred, setPreferred] = useState(loadWidth);
  const [max, setMax] = useState(() => asideMax(window.innerWidth, 0));
  const width = clampAside(preferred, max);
  const drag = useRef<{ startX: number; startWidth: number; current: number } | null>(null);

  const measure = useCallback(() => {
    const row = ref.current?.closest("aside")?.parentElement;
    setMax(asideMax(window.innerWidth, row?.clientWidth ?? 0));
  }, []);

  useLayoutEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    const row = ref.current?.closest("aside")?.parentElement;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (row) observer?.observe(row);
    return () => {
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [measure]);

  useLayoutEffect(() => {
    document.documentElement.style.setProperty(CSS_VAR, `${width}px`);
  }, [width]);

  // screens without a column leave the header slot at the default width
  // (a layout cleanup runs before the next screen's layout effects, so a swap keeps the width)
  useLayoutEffect(
    () => () => {
      document.documentElement.style.removeProperty(CSS_VAR);
    },
    [],
  );

  const commit = (next: number) => {
    const clamped = clampAside(next, max);
    setPreferred(clamped);
    saveWidth(clamped);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? STEP_SHIFT : STEP;
    let next: number;
    // the handle sits on the left edge: moving it left widens the column
    if (e.key === "ArrowLeft") next = width + step;
    else if (e.key === "ArrowRight") next = width - step;
    else if (e.key === "Home") next = ASIDE_MIN;
    else if (e.key === "End") next = max;
    else return;
    e.preventDefault();
    commit(next);
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    document.body.style.removeProperty("user-select");
    document.body.style.removeProperty("cursor");
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    commit(d.current);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { startX: e.clientX, startWidth: width, current: width };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.current = clampAside(d.startWidth + (d.startX - e.clientX), max);
    document.documentElement.style.setProperty(CSS_VAR, `${d.current}px`);
    e.currentTarget.setAttribute("aria-valuenow", String(d.current));
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a window splitter has no native element, <hr> cannot be focused or take children
    <div
      ref={ref}
      role="separator"
      aria-orientation="vertical"
      aria-label={t("aside.resize")}
      aria-valuenow={width}
      aria-valuemin={ASIDE_MIN}
      aria-valuemax={max}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => commit(ASIDE_DEFAULT)}
      data-testid="aside-resize"
      className={cn(
        "no-drag group absolute inset-y-0 -left-[3px] z-20 w-[7px] cursor-col-resize touch-none",
        "after:absolute after:inset-y-0 after:left-[3px] after:w-px after:bg-transparent",
        "hover:after:bg-line-faint active:after:bg-ink focus-visible:after:bg-ink",
        "focus-visible:outline-none",
      )}
    />
  );
}
