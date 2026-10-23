import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
  useNavigate,
} from "@tanstack/react-router";
import { InboxScreen } from "./components/inbox-screen";
import { type ItemTab, ItemView } from "./components/item-view";
import { type ItemFilters, ItemsScreen } from "./components/items-screen";
import { ProjectsScreen, ProjectView } from "./components/projects";
import { SearchScreen } from "./components/search-screen";
import { Shell } from "./components/shell";
import { NotesIndex, NotesLayout, NoteView } from "./notes";
import { SettingsScreen } from "./routes/settings";

const STATUSES = ["unread", "reading", "read"] as const;

function parseFilters(search: Record<string, unknown>): ItemFilters {
  const project = typeof search.project === "string" && search.project ? search.project : undefined;
  const status = STATUSES.find((s) => s === search.status);
  return { project, status };
}

const rootRoute = createRootRoute({ component: Shell });

function Library() {
  const navigate = useNavigate();
  const search = libraryRoute.useSearch();
  return (
    <ItemsScreen
      filters={search}
      onFiltersChange={(next) =>
        void navigate({ to: "/", search: { project: next.project, status: next.status } })
      }
    />
  );
}

const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: parseFilters,
  component: Library,
});

const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/inbox",
  component: InboxScreen,
});

const itemRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/items/$citekey",
  validateSearch: (search: Record<string, unknown>): { tab?: ItemTab; card?: string } => ({
    ...(search.tab === "read" ? { tab: "read" as const } : {}),
    ...(typeof search.card === "string" && search.card ? { card: search.card } : {}),
  }),
  component: function ItemRoute() {
    const { citekey } = itemRoute.useParams();
    const { tab, card } = itemRoute.useSearch();
    const navigate = useNavigate();
    return (
      <ItemView
        citekey={citekey}
        tab={tab ?? "overview"}
        cardId={card}
        onChange={(next) =>
          void navigate({
            to: "/items/$citekey",
            params: { citekey },
            search: {
              ...(next.tab === "read" ? { tab: "read" as const } : {}),
              ...(next.card ? { card: next.card } : {}),
            },
            replace: true,
          })
        }
      />
    );
  },
});

const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects",
  component: ProjectsScreen,
});

const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$slug",
  component: function ProjectRoute() {
    const { slug } = projectRoute.useParams();
    return <ProjectView slug={slug} />;
  },
});

const notesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/notes",
  component: NotesLayout,
});

const notesIndexRoute = createRoute({
  getParentRoute: () => notesRoute,
  path: "/",
  component: NotesIndex,
});

const noteRoute = createRoute({
  getParentRoute: () => notesRoute,
  path: "$id",
  component: function NoteRoute() {
    const { id } = noteRoute.useParams();
    return <NoteView key={id} id={id} />;
  },
});

const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/search",
  validateSearch: (search: Record<string, unknown>): { q: string } => ({
    q: typeof search.q === "string" ? search.q : "",
  }),
  component: function SearchRoute() {
    const { q } = searchRoute.useSearch();
    return <SearchScreen q={q} />;
  },
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsScreen,
});

const routeTree = rootRoute.addChildren([
  libraryRoute,
  inboxRoute,
  itemRoute,
  projectsRoute,
  projectRoute,
  notesRoute.addChildren([notesIndexRoute, noteRoute]),
  searchRoute,
  settingsRoute,
]);

/**
 * Hash history keeps routing independent of the page URL, which is a file:// URL in the packaged
 * desktop app. Tests pass a memory history.
 */
export function createAppRouter(history: RouterHistory = createHashHistory()) {
  return createRouter({ routeTree, history, defaultPreload: "intent" });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
