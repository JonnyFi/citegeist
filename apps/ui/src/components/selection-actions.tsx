import type { CardColor } from "@citegeist/schema";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { HIGHLIGHT_COLORS, highlightColor } from "../lib/cards";

// The reader draws its own popover with a single action. citegeist needs three, so the app draws
// the popover itself from the selection the reader reports, and hides the built-in one.
let hidden = false;
export function hideReaderPopover(): void {
  if (hidden || typeof document === "undefined") return;
  hidden = true;
  const el = document.createElement("style");
  el.textContent = ".cg-popover { display: none !important; }";
  document.head.append(el);
}

/** True for a key press that goes into a text field, where the digit keys must stay text. */
function typesText(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/**
 * Actions for the current text selection: "Zitat (KI)", which saves a quote card with the AI
 * paraphrase, and four colour dots that mark the passage at once, without AI (the keys 1 to 4 do
 * the same).
 */
export function SelectionActions({
  range,
  busy,
  onQuote,
  onColor,
}: {
  range: Range;
  busy: boolean;
  onQuote: () => void;
  onColor: (color: CardColor) => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0, below: false });

  const place = () => {
    const rect = range.getBoundingClientRect();
    const height = ref.current?.offsetHeight ?? 36;
    const below = rect.top < height + 16;
    setPos({
      left: Math.min(Math.max(rect.left + rect.width / 2, 120), window.innerWidth - 120),
      top: below ? rect.bottom + 8 : rect.top - 8,
      below,
    });
  };

  useLayoutEffect(place, [range]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: place reads only the range
  useEffect(() => {
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [range]);

  // keys 1 to 4 choose the colour while text is selected; the latest props stay in a ref
  const latest = useRef({ busy, onColor });
  latest.current = { busy, onColor };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || typesText(e.target)) return;
      const color = HIGHLIGHT_COLORS[Number(e.key) - 1];
      if (!color || latest.current.busy) return;
      e.preventDefault();
      latest.current.onColor(color);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const base =
    "h-7 px-2.5 text-[12px] font-medium text-bg disabled:cursor-not-allowed disabled:opacity-45";
  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={t("selection.label")}
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        transform: pos.below ? "translateX(-50%)" : "translate(-50%, -100%)",
        zIndex: 1000,
      }}
      className="flex gap-1 border border-line bg-ink p-1"
      // keep the text selection alive while a button is pressed
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        type="button"
        data-testid="selection-quote"
        disabled={busy}
        onClick={onQuote}
        className={`${base} hover:bg-bg/20`}
      >
        {t("selection.quote")}
      </button>
      <span aria-hidden="true" className="mx-0.5 w-px self-stretch bg-bg/30" />
      {HIGHLIGHT_COLORS.map((color, i) => {
        const label = t("hl.mark", { color: t(`hl.color.${color}`), key: String(i + 1) });
        return (
          <button
            key={color}
            type="button"
            data-testid={`selection-color-${color}`}
            aria-label={label}
            title={label}
            disabled={busy}
            onClick={() => onColor(color)}
            className="inline-flex size-7 items-center justify-center hover:bg-bg/20 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <span
              aria-hidden="true"
              className="size-3.5"
              style={{ background: highlightColor(color) }}
            />
          </button>
        );
      })}
    </div>
  );
}
