import { settingsGet } from "@citegeist/ops";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";
import { useOp } from "../lib/hooks";
import { cn } from "../lib/utils";
import { ChatSlot } from "./chat-slot";

/** What the shell shares with the screens: the header slot and the state of the right column. */
interface LayoutState {
  headerEl: HTMLElement | null;
  setHeaderEl: (el: HTMLElement | null) => void;
  /** Id of the open tab in the right column; "agent" is the chat. */
  tab: string;
  setTab: (id: string) => void;
  /** Right column opened by the rail on screens that bring no column of their own. */
  chatOpen: boolean;
  setChatOpen: (open: boolean) => void;
  /** Number of screens that currently render their own right column. */
  ownColumns: number;
  setOwnColumns: (update: (n: number) => number) => void;
}

const LayoutContext = createContext<LayoutState | null>(null);

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [headerEl, setHeaderEl] = useState<HTMLElement | null>(null);
  const [tab, setTab] = useState("cards");
  const [chatOpen, setChatOpen] = useState(false);
  const [ownColumns, setOwnColumns] = useState(0);
  const value = useMemo(
    () => ({
      headerEl,
      setHeaderEl,
      tab,
      setTab,
      chatOpen,
      setChatOpen,
      ownColumns,
      setOwnColumns,
    }),
    [headerEl, tab, chatOpen, ownColumns],
  );
  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
}

export function useLayout(): LayoutState {
  const value = useContext(LayoutContext);
  if (!value) throw new Error("useLayout must be used inside <LayoutProvider>");
  return value;
}

/**
 * Puts content into the middle of the 48px top bar: breadcrumbs, counters, the add field. Each
 * screen decides what its bar says. Without a shell (a screen rendered alone) nothing is drawn.
 */
export function HeaderSlot({ children }: { children: ReactNode }) {
  const value = useContext(LayoutContext);
  return value?.headerEl ? createPortal(children, value.headerEl) : null;
}

/** The 44px bar under the top bar: tabs, filters and actions of one screen. */
export function SubBar({
  className,
  children,
  ...props
}: { className?: string; children: ReactNode } & Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "className" | "children"
>) {
  return (
    <div
      className={cn(
        "flex h-subbar shrink-0 items-stretch justify-between gap-4 border-b border-line px-8",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** Uppercase 11px label for panel heads, table heads and section titles. */
export function Label({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <span
      className={cn("text-label font-semibold uppercase tracking-[0.1em] text-muted", className)}
      {...props}
    />
  );
}

export interface AsideTab {
  id: string;
  label: string;
  count?: number | undefined;
  content: ReactNode;
  /** Draw the panel on the sunken ground, as the card column does. */
  sunken?: boolean;
}

/** Name of the agent shown in the switcher, from the default backend of the settings. */
function useAgentName(): string | undefined {
  const settings = useOp(settingsGet, {});
  const routing = settings.data?.settings.ai.routing;
  const id = routing?.["*"] ?? routing?.default;
  return id ? id.replace(/-(cli|exec)$/, "") : undefined;
}

/**
 * The right column, 360px: a switcher with the screen's own tabs on the left and the agent on the
 * right, and the open panel below. The agent tab is always last.
 */
export function RightColumn({
  label,
  tabs,
  className,
}: {
  label: string;
  tabs: readonly AsideTab[];
  className?: string;
}) {
  const { t } = useI18n();
  const { tab, setTab, setOwnColumns } = useLayout();
  // the shell draws its own chat-only column only while no screen brings one
  useEffect(() => {
    if (tabs.length === 0) return;
    setOwnColumns((n) => n + 1);
    return () => setOwnColumns((n) => n - 1);
  }, [tabs.length, setOwnColumns]);
  const agentName = useAgentName();
  const active = tab === "agent" || tabs.some((x) => x.id === tab) ? tab : (tabs[0]?.id ?? "agent");
  const current = tabs.find((x) => x.id === active);
  const sunken = current?.sunken ?? false;

  const base =
    "flex min-w-0 items-center justify-center overflow-hidden text-label font-semibold uppercase";
  // three tabs share 360px, so the lettering tightens a little and the agent name moves to a tooltip
  const crowded = tabs.length > 1;
  const tabClass = (on: boolean, first: boolean) =>
    cn(
      base,
      "flex-1",
      crowded ? "gap-1.5 px-1 tracking-[0.06em]" : "gap-2 px-2 tracking-[0.1em]",
      on ? "bg-ink text-bg" : "text-ink hover:bg-sunken",
      !first && !on && "border-l border-line",
    );

  return (
    <aside
      aria-label={label}
      className={cn(
        "flex min-h-0 w-aside shrink-0 flex-col border-l border-line",
        sunken ? "bg-sunken" : "bg-bg",
        className,
      )}
    >
      <div
        role="tablist"
        aria-label={label}
        className="flex h-subbar shrink-0 border-b border-line bg-bg"
      >
        {tabs.map((x, i) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            id={`aside-tab-${x.id}`}
            aria-selected={active === x.id}
            aria-controls={`aside-panel-${x.id}`}
            onClick={() => setTab(x.id)}
            className={tabClass(active === x.id, i === 0)}
          >
            {x.label}
            {x.count !== undefined ? (
              <span className="font-mono font-normal normal-case tracking-normal">{x.count}</span>
            ) : null}
          </button>
        ))}
        <button
          type="button"
          role="tab"
          id="aside-tab-agent"
          aria-selected={active === "agent"}
          aria-controls="aside-panel-agent"
          onClick={() => setTab("agent")}
          title={agentName}
          className={tabClass(active === "agent", tabs.length === 0)}
        >
          {t("agent.tab")}
          {agentName && !crowded ? (
            <span
              className={cn(
                "truncate font-mono font-normal normal-case tracking-normal",
                active === "agent" ? "" : "text-muted",
              )}
            >
              {agentName}
            </span>
          ) : null}
        </button>
      </div>
      <div
        role="tabpanel"
        id={`aside-panel-${active}`}
        aria-labelledby={`aside-tab-${active}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        {active === "agent" ? <ChatSlot /> : current?.content}
      </div>
    </aside>
  );
}

/** Callback ref that registers the top bar slot with the layout. */
export function useHeaderRef(): (el: HTMLElement | null) => void {
  const { setHeaderEl } = useLayout();
  return useCallback((el: HTMLElement | null) => setHeaderEl(el), [setHeaderEl]);
}
