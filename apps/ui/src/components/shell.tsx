import { itemsList, projectsGet, projectsList, settingsUpdate } from "@citegeist/ops";
import { useQueries } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  useNavigate,
  useRouter,
  useRouterState,
  useSearch,
} from "@tanstack/react-router";
import {
  BookOpen,
  ChevronLeft,
  FileInput,
  FolderOpen,
  Inbox,
  MessageSquare,
  Monitor,
  Moon,
  Network,
  NotebookPen,
  PanelLeft,
  Search,
  Settings,
  Sun,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { LANGS, type Lang, type MessageKey, useI18n } from "../i18n";
import { useCore, useOp } from "../lib/hooks";
import { FOCUS_SEARCH_EVENT } from "../lib/search-focus";
import { type ThemeChoice, useTheme } from "../lib/theme";
import { cn } from "../lib/utils";
import { JobStatus } from "./job-status";
import { LayoutProvider, RightColumn, useHeaderRef, useLayout } from "./layout";

const RAIL_KEY = "citegeist.rail";

function useRailOpen() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(RAIL_KEY) === "open";
    } catch {
      return false;
    }
  });
  const set = useCallback((next: boolean) => {
    try {
      localStorage.setItem(RAIL_KEY, next ? "open" : "closed");
    } catch {
      // storage unavailable, the state still holds for this session
    }
    setOpen(next);
  }, []);
  return [open, set] as const;
}

function navClass(open: boolean, active: boolean): string {
  return cn(
    "relative flex items-center text-ink",
    open ? "h-11 gap-3 px-[18px]" : "size-11 justify-center",
    active ? "bg-ink text-bg" : "hover:bg-sunken",
    active && open && "font-medium",
  );
}

/** Label and counter of a rail entry. Collapsed, the label becomes the accessible name. */
function NavBody({
  open,
  icon,
  label,
  count,
  badge,
  badgeLabel,
}: {
  open: boolean;
  icon: ReactNode;
  label: string;
  count?: number | undefined;
  /** Count drawn as an inverted block (inbox) instead of a mono number. */
  badge?: number | undefined;
  badgeLabel?: string | undefined;
}) {
  return (
    <>
      {icon}
      {open ? <span>{label}</span> : <span className="sr-only">{badgeLabel ?? label}</span>}
      {open ? <span className="flex-1" /> : null}
      {open && count !== undefined ? (
        <span className="font-mono text-[11px] opacity-80">{count}</span>
      ) : null}
      {badge ? (
        <span
          className={cn(
            "bg-ink px-1 font-mono text-[10px] leading-[14px] text-bg",
            open ? "" : "absolute right-1.5 top-1.5 outline outline-1 outline-bg",
          )}
          aria-hidden={open ? undefined : "true"}
        >
          {badge}
        </span>
      ) : null}
    </>
  );
}

const ICON = "size-5 shrink-0";

const THEME_CYCLE: readonly ThemeChoice[] = ["light", "dark", "system"];
const THEME_ICON = { light: Sun, dark: Moon, system: Monitor } as const;

function ThemeButton({ open }: { open: boolean }) {
  const { t } = useI18n();
  const [choice, setChoice] = useTheme();
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(choice) + 1) % THEME_CYCLE.length] ?? "light";
  const Icon = THEME_ICON[choice];
  const label = t(`theme.mode.${next}` as MessageKey);
  return (
    <button
      type="button"
      aria-label={label}
      title={`${t("theme.label")}: ${t(`theme.${choice}` as MessageKey)}`}
      onClick={() => setChoice(next)}
      className={cn(navClass(open, false), "w-full")}
    >
      <Icon className={ICON} />
      {open ? <span>{label}</span> : null}
    </button>
  );
}

/** UI language switch. Also tells the core, so the choice survives a restart; the mock has no settings. */
function LanguageButton({ open }: { open: boolean }) {
  const { t, lang, setLang } = useI18n();
  const core = useCore();
  const next: Lang = LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length] ?? "de";
  const pick = () => {
    setLang(next);
    core.call(settingsUpdate, { patch: { uiLanguage: next } }).catch(() => {});
  };
  return (
    <button
      type="button"
      aria-label={t(`lang.${next}`)}
      title={t("lang.label")}
      onClick={pick}
      className={cn(navClass(open, false), "w-full")}
    >
      <span className="flex size-5 shrink-0 items-center justify-center font-mono text-[11px] font-semibold">
        {lang.toUpperCase()}
      </span>
      {open ? <span>{t("lang.label")}</span> : null}
    </button>
  );
}

/** The project list under "Bibliothek" in the expanded rail: each entry filters the library. */
function ProjectList({ activeProject, onLibrary }: { activeProject?: string; onLibrary: boolean }) {
  const { t } = useI18n();
  const core = useCore();
  const projects = useOp(projectsList, {});
  const list = projects.data?.projects ?? [];
  const counts = useQueries({
    queries: list.map((p) => ({
      queryKey: ["op", projectsGet.name, { slug: p.slug }],
      queryFn: () => core.call(projectsGet, { slug: p.slug }),
    })),
  });
  const row = (active: boolean) =>
    cn(
      "flex h-9 items-center pl-[50px] pr-[18px]",
      active
        ? "font-medium text-ink shadow-[inset_3px_0_0_var(--ink)]"
        : "text-muted hover:text-ink",
    );
  return (
    <div className="flex flex-col border-b border-line bg-sunken" data-testid="rail-projects">
      <Link to="/" search={{}} className={row(onLibrary && !activeProject)}>
        <span>{t("nav.allSources")}</span>
      </Link>
      {list.map((p, i) => (
        <Link
          key={p.slug}
          to="/"
          search={{ project: p.slug }}
          className={row(onLibrary && activeProject === p.slug)}
        >
          <span className="min-w-0 flex-1 truncate">{p.title}</span>
          {counts[i]?.data ? (
            <span className="font-mono text-[11px]">{counts[i].data.items}</span>
          ) : null}
        </Link>
      ))}
    </div>
  );
}

const FALLBACK_TITLES: ReadonlyArray<readonly [RegExp, MessageKey]> = [
  [/^\/settings/, "nav.settings"],
  [/^\/import/, "nav.import"],
  [/^\/notes/, "nav.notes"],
  [/^\/graph/, "nav.graph"],
  [/^\/search/, "nav.search"],
  [/^\/projects\/?$/, "nav.projects"],
];

function ShellFrame() {
  const { t } = useI18n();
  const core = useCore();
  const router = useRouter();
  const navigate = useNavigate();
  const { setTab, chatOpen, setChatOpen, tab, ownColumns } = useLayout();
  const headerRef = useHeaderRef();
  const [open, setOpen] = useRailOpen();
  const inbox = useOp(itemsList, { inbox: true, limit: 500 });
  const inboxCount = inbox.data?.items.length ?? 0;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useSearch({ strict: false }) as { project?: string };
  const darwin = typeof window !== "undefined" && window.citegeist?.platform === "darwin";

  useEffect(() => window.citegeist?.onNavigate((path) => router.history.push(path)), [router]);

  const focusSearch = useCallback(() => {
    void navigate({ to: "/search", search: { q: "" } }).then(() =>
      window.dispatchEvent(new Event(FOCUS_SEARCH_EVENT)),
    );
  }, [navigate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && /^(input|textarea|select)$/i.test(target.tagName);
      const editable = target?.isContentEditable;
      if ((e.key === "/" && !typing && !editable) || ((e.metaKey || e.ctrlKey) && e.key === "k")) {
        e.preventDefault();
        if (pathname.startsWith("/search")) window.dispatchEvent(new Event(FOCUS_SEARCH_EVENT));
        else focusSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusSearch, pathname]);

  const onItem = pathname.startsWith("/items/");
  const onProject = /^\/projects\/[^/]+/.test(pathname);
  const ownColumn = ownColumns > 0;
  const onLibrary = pathname === "/";
  const fallback = FALLBACK_TITLES.find(([re]) => re.test(pathname));
  const columnVisible = ownColumn || chatOpen;

  const openChat = () => {
    if (ownColumn) {
      setTab("agent");
      return;
    }
    if (chatOpen && tab === "agent") setChatOpen(false);
    else {
      setTab("agent");
      setChatOpen(true);
    }
  };

  const libraryName = core.isMock ? t("shell.mockLibrary") : (core.label.split("/").pop() ?? "");

  return (
    <div className="flex h-full flex-col">
      <header className="drag-region flex h-topbar shrink-0 items-stretch border-b border-line">
        <div
          className={cn(
            "flex shrink-0 items-center border-r border-line",
            open ? "w-rail-open gap-3 px-4" : "w-rail justify-center",
            darwin && open && "pl-[84px]",
          )}
        >
          {open ? (
            <>
              <span
                aria-hidden="true"
                className={cn("font-serif text-[22px] font-medium", darwin && "hidden")}
              >
                c
              </span>
              <span className="text-[13px] font-semibold">citegeist</span>
              <span className="flex-1" />
              <button
                type="button"
                aria-label={t("rail.collapse")}
                onClick={() => setOpen(false)}
                className="flex size-7 items-center justify-center hover:bg-sunken"
              >
                <ChevronLeft className="size-4" />
              </button>
            </>
          ) : (
            <button
              type="button"
              aria-label={t("rail.expand")}
              onClick={() => setOpen(true)}
              className={cn(
                "flex size-full items-center justify-center font-serif text-[22px] font-medium hover:bg-sunken",
                darwin && "invisible",
              )}
            >
              c
            </button>
          )}
        </div>
        <div ref={headerRef} className="flex min-w-0 flex-1 items-center gap-4 px-8 text-[13px]">
          {fallback ? <div className="font-medium">{t(fallback[1])}</div> : null}
        </div>
        <JobStatus />
      </header>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label={t("nav.main")}
          className={cn(
            "flex shrink-0 flex-col justify-between overflow-y-auto border-r border-line py-3",
            open ? "w-rail-open" : "w-rail items-center",
          )}
        >
          <div className={cn("flex flex-col", !open && "items-center gap-1")}>
            <Link
              to="/search"
              search={{ q: "" }}
              aria-current={pathname.startsWith("/search") ? "page" : undefined}
              className={cn(
                "flex h-11 items-center border border-line text-ink",
                open ? "mx-3 mb-2 gap-3 px-[11px]" : "mb-2 w-11 justify-center",
                pathname.startsWith("/search") ? "bg-ink text-bg" : "hover:bg-sunken",
              )}
            >
              <Search className={ICON} />
              {open ? (
                <span>{t("nav.search")}</span>
              ) : (
                <span className="sr-only">{t("nav.search")}</span>
              )}
              {open ? <span className="flex-1" /> : null}
              {open ? <span className="font-mono text-[11px]">⌘K</span> : null}
            </Link>

            <Link
              to="/"
              search={{}}
              aria-current={onLibrary || onItem ? "page" : undefined}
              className={navClass(open, onLibrary || onItem)}
            >
              <NavBody open={open} icon={<BookOpen className={ICON} />} label={t("nav.library")} />
            </Link>
            {open ? (
              <ProjectList
                onLibrary={onLibrary}
                {...(search.project ? { activeProject: search.project } : {})}
              />
            ) : null}

            <Link
              to="/inbox"
              aria-current={pathname.startsWith("/inbox") ? "page" : undefined}
              className={navClass(open, pathname.startsWith("/inbox"))}
            >
              <NavBody
                open={open}
                icon={<Inbox className={ICON} />}
                label={t("nav.inbox")}
                badge={inboxCount}
                badgeLabel={inboxCount > 0 ? t("nav.inboxNew", { n: inboxCount }) : t("nav.inbox")}
              />
            </Link>
            <Link
              to="/projects"
              aria-current={pathname === "/projects" || onProject ? "page" : undefined}
              className={navClass(open, pathname === "/projects" || onProject)}
            >
              <NavBody
                open={open}
                icon={<FolderOpen className={ICON} />}
                label={t("nav.projects")}
              />
            </Link>
            <Link
              to="/notes"
              aria-current={pathname.startsWith("/notes") ? "page" : undefined}
              className={navClass(open, pathname.startsWith("/notes"))}
            >
              <NavBody open={open} icon={<NotebookPen className={ICON} />} label={t("nav.notes")} />
            </Link>
            <Link
              to="/graph"
              aria-current={pathname.startsWith("/graph") ? "page" : undefined}
              className={navClass(open, pathname.startsWith("/graph"))}
            >
              <NavBody open={open} icon={<Network className={ICON} />} label={t("nav.graph")} />
            </Link>
            <Link
              to="/import"
              aria-current={pathname.startsWith("/import") ? "page" : undefined}
              className={navClass(open, pathname.startsWith("/import"))}
            >
              <NavBody open={open} icon={<FileInput className={ICON} />} label={t("nav.import")} />
            </Link>
          </div>

          <div className={cn("flex flex-col", !open && "items-center gap-1")}>
            <button
              type="button"
              aria-label={open ? undefined : t("chat.toggle")}
              aria-controls="chat-column"
              aria-pressed={columnVisible && tab === "agent"}
              onClick={openChat}
              className={cn(navClass(open, false), "w-full", !open && "w-11")}
            >
              <MessageSquare className={ICON} />
              {open ? <span>{t("nav.chat")}</span> : null}
            </button>
            <ThemeButton open={open} />
            <LanguageButton open={open} />
            <Link
              to="/settings"
              aria-current={pathname.startsWith("/settings") ? "page" : undefined}
              className={navClass(open, pathname.startsWith("/settings"))}
            >
              <NavBody open={open} icon={<Settings className={ICON} />} label={t("nav.settings")} />
            </Link>
            {open ? (
              <div
                className="truncate px-[18px] pt-2 font-mono text-[11px] text-muted"
                title={core.label}
              >
                {libraryName}
              </div>
            ) : darwin ? (
              <button
                type="button"
                aria-label={t("rail.expand")}
                onClick={() => setOpen(true)}
                className={navClass(false, false)}
              >
                <PanelLeft className={ICON} />
              </button>
            ) : null}
          </div>
        </nav>

        <div className="flex min-h-0 min-w-0 flex-1">
          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <Outlet />
          </main>
          {chatOpen && !ownColumn ? <RightColumn label={t("nav.chat")} tabs={[]} /> : null}
        </div>
      </div>
    </div>
  );
}

export function Shell() {
  return (
    <LayoutProvider>
      <ShellFrame />
    </LayoutProvider>
  );
}
