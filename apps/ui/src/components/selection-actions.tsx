import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";

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

/**
 * Actions for the current text selection. "Zitat" saves a card. "Erklären" and "Mit Notiz
 * verknüpfen" are placeholders until v0.2 and stay disabled.
 */
export function SelectionActions({
  range,
  busy,
  onQuote,
}: {
  range: Range;
  busy: boolean;
  onQuote: () => void;
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

  const base =
    "h-7 px-2.5 text-[13px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-45";
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
      className="flex gap-1 bg-[#1f1f1f] p-1"
      // keep the text selection alive while a button is pressed
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        type="button"
        data-testid="selection-quote"
        disabled={busy}
        onClick={onQuote}
        className={`${base} hover:bg-white/20`}
      >
        {t("selection.quote")}
      </button>
      <button type="button" disabled title={t("selection.soon")} className={base}>
        {t("selection.explain")}
      </button>
      <button type="button" disabled title={t("selection.soon")} className={base}>
        {t("selection.linkNote")}
      </button>
    </div>
  );
}
