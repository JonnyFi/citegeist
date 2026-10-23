import { cardsExport } from "@citegeist/ops";
import { Search } from "lucide-react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useI18n } from "../i18n";
import { locatorText } from "../lib/format";
import { useCore } from "../lib/hooks";
import { cn, describeError } from "../lib/utils";
import type { QuickInsertBridge } from "./bridge";
import { type QuickInsertKey, quickInsertText } from "./messages";
import { findCards, type PaletteResult } from "./search";

type Mode = "direct" | "indirect";
type Notice = { kind: "no-permission" | "unsupported" } | { kind: "error"; detail: string };

export interface PaletteProps {
  bridge: QuickInsertBridge;
  /** Wait after typing before searching. Default 120 ms. */
  debounceMs?: number;
  /** How long a "copied, not pasted" message stays before the palette closes. Default 2500 ms. */
  closeDelayMs?: number;
}

/**
 * The floating search palette. Type to find a quote card, Enter copies the direct citation (and
 * pastes it into the app that had focus), Shift+Enter the indirect one, Escape closes.
 */
export function QuickInsertPalette({
  bridge,
  debounceMs = 120,
  closeDelayMs = 2500,
}: PaletteProps) {
  const core = useCore();
  const i18n = useI18n();
  const qi = useMemo(() => quickInsertText(i18n.lang), [i18n.lang]);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PaletteResult[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  }, []);

  // A fresh palette on every hotkey press: empty search, no message, cursor in the field.
  useEffect(() => {
    inputRef.current?.focus();
    return bridge.onShow(() => {
      clearCloseTimer();
      setQuery("");
      setNotice(null);
      setActive(0);
      setBusy(false);
      inputRef.current?.focus();
    });
  }, [bridge, clearCloseTimer]);
  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  // Search with a short debounce. A slower, older request never overwrites a newer one.
  useEffect(() => {
    let current = true;
    setState("loading");
    const timer = setTimeout(() => {
      findCards(core, query).then(
        (found) => {
          if (!current) return;
          setResults(found);
          setActive(0);
          setState("ready");
        },
        () => {
          if (!current) return;
          setResults([]);
          setState("error");
        },
      );
    }, debounceMs);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [core, query, debounceMs]);

  const choose = useCallback(
    async (result: PaletteResult | undefined, mode: Mode) => {
      if (!result || busy) return;
      setBusy(true);
      try {
        const out = await core.call(cardsExport, {
          ids: [result.card.frontmatter.id],
          mode,
          format: "html",
        });
        const delivered = await bridge.deliver({ html: out.html, text: out.text });
        if (!delivered.pasted) {
          setNotice({ kind: delivered.reason });
          clearCloseTimer();
          closeTimer.current = setTimeout(() => bridge.close(), closeDelayMs);
        }
      } catch (err) {
        setNotice({ kind: "error", detail: describeError(err, qi("qi.error")).message });
      } finally {
        setBusy(false);
      }
    },
    [busy, core, bridge, closeDelayMs, clearCloseTimer, qi],
  );

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      clearCloseTimer();
      bridge.close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      void choose(results[active], e.shiftKey ? "indirect" : "direct");
    }
  };

  const optionId = (i: number) => `${listId}-${i}`;
  const trimmed = query.trim();

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: key handling for the whole palette, the focus stays in the input
    <div
      className="flex h-full flex-col overflow-hidden border border-line bg-surface text-ink"
      onKeyDown={onKeyDown}
    >
      <div className="flex items-center gap-2 border-b border-line px-3">
        <Search className="size-4 shrink-0 text-muted" aria-hidden />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label={qi("qi.label")}
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-activedescendant={results.length > 0 ? optionId(active) : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          placeholder={qi("qi.placeholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-12 w-full bg-transparent text-[15px] outline-none placeholder:text-muted"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {results.length > 0 ? (
          <>
            <p className="px-3 pt-2 text-xs uppercase tracking-wide text-muted">
              {trimmed === "" ? qi("qi.recent") : qi("qi.results")}
            </p>
            <div id={listId} role="listbox" aria-label={qi("qi.results")} className="p-1.5">
              {results.map((r, i) => (
                <ResultRow
                  key={r.card.frontmatter.id}
                  id={optionId(i)}
                  result={r}
                  selected={i === active}
                  page={locatorText(i18n, r.card.frontmatter.locator)}
                  onHover={() => setActive(i)}
                  onChoose={(mode) => void choose(r, mode)}
                />
              ))}
            </div>
          </>
        ) : (
          <PaletteEmpty state={state} query={trimmed} qi={qi} />
        )}
      </div>

      {notice ? (
        <div
          role="status"
          className={cn(
            "flex items-center gap-3 border-t border-line px-3 py-2 text-[13px]",
            notice.kind === "error" ? "text-danger" : "bg-accent-soft",
          )}
        >
          <span className="flex-1">
            {notice.kind === "error"
              ? `${qi("qi.error")} ${notice.detail}`
              : notice.kind === "no-permission"
                ? qi("qi.noPermission")
                : qi("qi.unsupported")}
          </span>
          {notice.kind === "no-permission" ? (
            <button
              type="button"
              className="shrink-0 border border-line bg-surface px-2 py-1 text-xs"
              onClick={() => {
                clearCloseTimer();
                bridge.requestAccessibility();
              }}
            >
              {qi("qi.grant")}
            </button>
          ) : null}
        </div>
      ) : (
        <p className="border-t border-line px-3 py-1.5 text-xs text-muted">
          {[qi("qi.hintDirect"), qi("qi.hintIndirect"), qi("qi.hintClose")].join("  ·  ")}
        </p>
      )}
    </div>
  );
}

function ResultRow({
  id,
  result,
  selected,
  page,
  onHover,
  onChoose,
}: {
  id: string;
  result: PaletteResult;
  selected: boolean;
  page: string | undefined;
  onHover: () => void;
  onChoose: (mode: Mode) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  return (
    // The listbox is driven from the input (aria-activedescendant); a click is the pointer shortcut.
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard use goes through the input
    <div
      ref={ref}
      id={id}
      tabIndex={-1}
      role="option"
      aria-selected={selected}
      data-testid="palette-result"
      onMouseMove={onHover}
      onClick={(e) => onChoose(e.shiftKey ? "indirect" : "direct")}
      className={cn("cursor-pointer px-2.5 py-2", selected && "bg-accent-soft")}
    >
      <p className="line-clamp-3 font-serif text-[14.5px] leading-snug">{result.card.body.quote}</p>
      <p className="mt-1 flex items-baseline gap-2 text-xs text-muted">
        <span className="min-w-0 flex-1 truncate">{result.source}</span>
        {page ? <span className="shrink-0">{page}</span> : null}
      </p>
    </div>
  );
}

function PaletteEmpty({
  state,
  query,
  qi,
}: {
  state: "loading" | "ready" | "error";
  query: string;
  qi: (key: QuickInsertKey, vars?: Record<string, string | number>) => string;
}) {
  if (state === "loading") {
    return <p className="px-4 py-8 text-center text-muted">{qi("qi.searching")}</p>;
  }
  if (state === "error") {
    return (
      <p role="alert" className="px-4 py-8 text-center text-danger">
        {qi("qi.searchError")}
      </p>
    );
  }
  return (
    <div className="px-4 py-8 text-center">
      <p className="font-medium">{query === "" ? qi("qi.emptyTitle") : qi("qi.noneTitle")}</p>
      <p className="mt-1 text-muted">
        {query === "" ? qi("qi.emptyDescription") : qi("qi.noneDescription", { q: query })}
      </p>
    </div>
  );
}
