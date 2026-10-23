import { itemsList, projectsList } from "@citegeist/ops";
import { Link, Outlet, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { BookOpen, FolderOpen, Inbox, Monitor, Moon, Search, Sun } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useCore, useOp } from "../lib/hooks";
import { type ThemeChoice, useTheme } from "../lib/theme";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const NAV_ITEM =
  "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-muted hover:bg-sunken hover:text-ink";
const NAV_ACTIVE = "bg-sunken text-ink font-medium";

function SearchBar() {
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
          aria-label="Search"
          placeholder="Search items, cards and notes"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="pl-8"
        />
      </form>
    </search>
  );
}

const THEMES: Array<{ value: ThemeChoice; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
  { value: "dark", label: "Dark", icon: Moon },
];

function ThemeToggle() {
  const [choice, setChoice] = useTheme();
  return (
    <fieldset aria-label="Theme" className="m-0 inline-flex min-w-0 gap-0.5 border-0 p-0">
      {THEMES.map(({ value, label, icon: Icon }) => (
        <Button
          key={value}
          variant="ghost"
          size="icon"
          aria-label={label}
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

export function Shell() {
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
        <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-2">
          <Link
            to="/"
            className={NAV_ITEM}
            activeProps={{ className: NAV_ACTIVE }}
            activeOptions={{ exact: true }}
          >
            <BookOpen className="size-4" />
            Library
          </Link>
          <Link to="/inbox" className={NAV_ITEM} activeProps={{ className: NAV_ACTIVE }}>
            <Inbox className="size-4" />
            Inbox
            {inboxCount > 0 ? (
              <span className="ml-auto text-xs tabular-nums text-accent">{inboxCount}</span>
            ) : null}
          </Link>
          <Link
            to="/projects"
            className={NAV_ITEM}
            activeProps={{ className: NAV_ACTIVE }}
            activeOptions={{ exact: true }}
          >
            <FolderOpen className="size-4" />
            Projects
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
        <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2">
          <span className="min-w-0 truncate text-xs text-muted" title={core.label}>
            {core.isMock ? "Mock library" : core.label.split("/").pop()}
          </span>
          <ThemeToggle />
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
