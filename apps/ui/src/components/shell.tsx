import { itemsList, projectsList, settingsUpdate } from "@citegeist/ops";
import { Link, Outlet, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import {
  BookOpen,
  FolderOpen,
  Inbox,
  Monitor,
  Moon,
  NotebookPen,
  Search,
  Settings,
  Sun,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { LANGS, type Lang, type MessageKey, useI18n } from "../i18n";
import { useCore, useOp } from "../lib/hooks";
import { type ThemeChoice, useTheme } from "../lib/theme";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const NAV_ITEM =
  "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-muted hover:bg-sunken hover:text-ink";
const NAV_ACTIVE = "bg-sunken text-ink font-medium";

function SearchBar() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // The menu entry "Search" navigates to /search; put the cursor in the bar.
  useEffect(() => {
    if (pathname === "/search") ref.current?.focus();
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && /^(input|textarea|select)$/i.test(target.tagName);
      if ((e.key === "/" && !typing) || ((e.metaKey || e.ctrlKey) && e.key === "k")) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = value.trim();
    if (q) void navigate({ to: "/search", search: { q } });
  };

  return (
    <search className="no-drag block w-full max-w-md">
      <form onSubmit={submit} className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted" />
        <Input
          ref={ref}
          type="search"
          aria-label={t("search.label")}
          placeholder={t("search.placeholder")}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="pl-8"
        />
      </form>
    </search>
  );
}

const THEMES = [
  { value: "light", label: "theme.light", icon: Sun },
  { value: "system", label: "theme.system", icon: Monitor },
  { value: "dark", label: "theme.dark", icon: Moon },
] as const satisfies ReadonlyArray<{ value: ThemeChoice; label: MessageKey; icon: typeof Sun }>;

function ThemeToggle() {
  const { t } = useI18n();
  const [choice, setChoice] = useTheme();
  return (
    <fieldset
      aria-label={t("theme.label")}
      className="m-0 inline-flex min-w-0 gap-0.5 border-0 p-0"
    >
      {THEMES.map(({ value, label, icon: Icon }) => (
        <Button
          key={value}
          variant="ghost"
          size="icon"
          aria-label={t(label)}
          aria-pressed={choice === value}
          onClick={() => setChoice(value)}
          className={cn("size-7", choice === value ? "bg-sunken" : "text-muted")}
        >
          <Icon className="size-3.5" />
        </Button>
      ))}
    </fieldset>
  );
}

/** UI language switch. Also tells the core, so the choice survives a restart; the mock has no settings. */
function LanguageToggle() {
  const { t, lang, setLang } = useI18n();
  const core = useCore();
  const pick = (next: Lang) => {
    setLang(next);
    core.call(settingsUpdate, { patch: { uiLanguage: next } }).catch(() => {});
  };
  return (
    <fieldset aria-label={t("lang.label")} className="m-0 inline-flex min-w-0 gap-0.5 border-0 p-0">
      {LANGS.map((value) => (
        <Button
          key={value}
          variant="ghost"
          size="icon"
          aria-label={t(`lang.${value}`)}
          aria-pressed={lang === value}
          onClick={() => pick(value)}
          className={cn(
            "size-7 text-xs font-semibold",
            lang === value ? "bg-sunken" : "text-muted",
          )}
        >
          {value.toUpperCase()}
        </Button>
      ))}
    </fieldset>
  );
}

export function Shell() {
  const { t } = useI18n();
  const core = useCore();
  const router = useRouter();
  const projects = useOp(projectsList, {});
  const inbox = useOp(itemsList, { inbox: true, limit: 500 });
  const inboxCount = inbox.data?.items.length ?? 0;

  useEffect(() => window.citegeist?.onNavigate((path) => router.history.push(path)), [router]);

  return (
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-sunken/50">
        <div className="drag-region flex h-12 shrink-0 items-end px-4 pb-1.5 pl-20">
          <span className="font-serif text-base font-semibold tracking-tight">citegeist</span>
        </div>
        <nav
          aria-label={t("nav.main")}
          className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-2"
        >
          <Link
            to="/"
            className={NAV_ITEM}
            activeProps={{ className: NAV_ACTIVE }}
            activeOptions={{ exact: true }}
          >
            <BookOpen className="size-4" />
            {t("nav.library")}
          </Link>
          <Link to="/inbox" className={NAV_ITEM} activeProps={{ className: NAV_ACTIVE }}>
            <Inbox className="size-4" />
            {t("nav.inbox")}
            {inboxCount > 0 ? (
              <span className="ml-auto text-xs tabular-nums text-accent">{inboxCount}</span>
            ) : null}
          </Link>
          <Link to="/notes" className={NAV_ITEM} activeProps={{ className: NAV_ACTIVE }}>
            <NotebookPen className="size-4" />
            {t("nav.notes")}
          </Link>
          <Link
            to="/projects"
            className={NAV_ITEM}
            activeProps={{ className: NAV_ACTIVE }}
            activeOptions={{ exact: true }}
          >
            <FolderOpen className="size-4" />
            {t("nav.projects")}
          </Link>
          <div className="ml-4 flex flex-col gap-0.5 border-l border-line pl-2">
            {(projects.data?.projects ?? []).map((p) => (
              <Link
                key={p.slug}
                to="/projects/$slug"
                params={{ slug: p.slug }}
                className="truncate rounded px-2 py-1 text-muted hover:text-ink"
                activeProps={{ className: "text-ink font-medium" }}
              >
                {p.title}
              </Link>
            ))}
          </div>
        </nav>
        <div className="flex flex-col gap-1.5 border-t border-line px-3 py-2">
          <Link to="/settings" className={NAV_ITEM} activeProps={{ className: NAV_ACTIVE }}>
            <Settings className="size-4" />
            {t("nav.settings")}
          </Link>
          <span className="min-w-0 truncate text-xs text-muted" title={core.label}>
            {core.isMock ? t("shell.mockLibrary") : core.label.split("/").pop()}
          </span>
          <div className="flex items-center justify-between gap-1.5">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="drag-region flex h-12 shrink-0 items-center border-b border-line px-6">
          <SearchBar />
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
