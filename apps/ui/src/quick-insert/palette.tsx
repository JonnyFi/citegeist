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
import {
  type CitationSubject,
  type CitationTarget,
  kindFor,
  kindForKeys,
  renderCitation,
} from "../lib/citation-insert";
import { locatorText } from "../lib/format";
import { useCore } from "../lib/hooks";
import { cn, describeError } from "../lib/utils";
import type { DeliverResult, PaletteTarget, QuickInsertBridge } from "./bridge";
import { type QuickInsertKey, quickInsertText } from "./messages";
import { shiftOrAltHeld, waitForModifiersReleased } from "./modifiers";
import { type Citable, citableKey, findCitables, sourceCredit } from "./search";

type Notice =
  | { kind: "no-permission" | "unsupported" | "editor-unavailable" }
  | { kind: "error"; detail: string };

/** Which modifiers a choice was made with (Enter or click). */
interface Keys {
  shiftKey: boolean;
  altKey: boolean;
}

function subjectOf(row: Citable): CitationSubject {
  return row.type === "card"
    ? { type: "card", id: row.card.frontmatter.id }
    : { type: "source", citekey: row.item.citekey };
}

function citationTarget(target: PaletteTarget): CitationTarget {
  return target.type === "text"
    ? { type: "text", project: target.project, lang: target.lang }
    : { type: "external" };
}

export interface PaletteProps {
  bridge: QuickInsertBridge;
  /** Wait after typing before searching. Default 120 ms. */
  debounceMs?: number;
  /** How long a "copied, not pasted" message stays before the palette closes. Default 2500 ms. */
  closeDelayMs?: number;
}

/**
 * The floating search palette. Type to find a quote card or a source. Enter inserts the quote with
 * its citation, Shift+Enter the paraphrase, Alt+Enter the citation alone (a source only has the
 * citation), Escape closes. The citation goes into the open text of citegeist when the palette was
 * opened over its editor, otherwise into the app that had focus.
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
  const [results, setResults] = useState<Citable[]>([]);
  const [target, setTarget] = useState<PaletteTarget>(() => bridge.target());
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
    return bridge.onShow((next) => {
      clearCloseTimer();
      setTarget(next);
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
      findCitables(core, query).then(
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
    async (row: Citable | undefined, keys: Keys) => {
      if (!row || busy) return;
      setBusy(true);
      try {
        const subject = subjectOf(row);
        const kind = kindFor(subject, kindForKeys(keys));
        // Read now: the keys are gone from the event once the wait starts.
        keys = { shiftKey: keys.shiftKey, altKey: keys.altKey };
        const rendering = renderCitation(core, subject, kind, citationTarget(target));
        if (target.type === "text") {
          const rendered = await rendering;
          const delivered = await bridge
            .deliver({ kind: "editor", text: rendered.text })
            .catch((): DeliverResult => ({ pasted: false, reason: "editor-unavailable" }));
          if (!delivered.pasted) failWith(delivered.reason);
          return;
        }
        // The paste types Cmd+V: with Shift or Alt still down it would arrive as Cmd+Shift+V or Cmd+Alt+V.
        let held = keys.shiftKey || keys.altKey;
        const [rendered] = await Promise.all([
          rendering,
          waitForModifiersReleased(window, (event) => {
            if (event) held = shiftOrAltHeld(event);
            return held;
          }),
        ]);
        const delivered = await bridge.deliver({ html: rendered.html, text: rendered.text });
        if (!delivered.pasted) failWith(delivered.reason);
      } catch (err) {
        setNotice({ kind: "error", detail: describeError(err, qi("qi.error")).message });
      } finally {
        setBusy(false);
      }

      function failWith(reason: "no-permission" | "unsupported" | "editor-unavailable") {
        setNotice({ kind: reason });
        clearCloseTimer();
        closeTimer.current = setTimeout(() => bridge.close(), closeDelayMs);
      }
    },
    [busy, core, bridge, target, closeDelayMs, clearCloseTimer, qi],
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
      void choose(results[active], e);
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
                  key={citableKey(r)}
                  id={optionId(i)}
                  result={r}
                  selected={i === active}
                  page={
                    r.type === "card" ? locatorText(i18n, r.card.frontmatter.locator) : undefined
                  }
                  sourceTag={qi("qi.source")}
                  onHover={() => setActive(i)}
                  onChoose={(keys) => void choose(r, keys)}
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
                : notice.kind === "editor-unavailable"
                  ? qi("qi.editorGone")
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
          {(results[active]?.type === "source"
            ? [qi("qi.hintSource"), qi("qi.hintClose")]
            : [qi("qi.hintDirect"), qi("qi.hintIndirect"), qi("qi.hintCite"), qi("qi.hintClose")]
          ).join("  ·  ")}
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
  sourceTag,
  onHover,
  onChoose,
}: {
  id: string;
  result: Citable;
  selected: boolean;
  page: string | undefined;
  sourceTag: string;
  onHover: () => void;
  onChoose: (keys: Keys) => void;
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
      onClick={(e) => onChoose(e)}
      className={cn("cursor-pointer px-2.5 py-2", selected && "bg-accent-soft")}
    >
      {result.type === "card" ? (
        <>
          <p className="line-clamp-3 font-serif text-[14.5px] leading-snug">
            {result.card.body.quote}
          </p>
          <p className="mt-1 flex items-baseline gap-2 text-xs text-muted">
            <span className="min-w-0 flex-1 truncate">{result.source}</span>
            {page ? <span className="shrink-0">{page}</span> : null}
          </p>
        </>
      ) : (
        <>
          <p className="line-clamp-2 text-[14.5px] font-medium leading-snug">{result.item.title}</p>
          <p className="mt-1 flex items-baseline gap-2 text-xs text-muted">
            <span className="min-w-0 flex-1 truncate">{sourceCredit(result.item) ?? ""}</span>
            <span className="shrink-0 border border-line px-1 uppercase tracking-wide">
              {sourceTag}
            </span>
          </p>
        </>
      )}
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
