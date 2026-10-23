import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
  useNavigate,
} from "@tanstack/react-router";
import { ItemView } from "./components/item-view";
import { type ItemFilters, ItemsScreen } from "./components/items-screen";
import { ProjectsScreen, ProjectView } from "./components/projects";
import { SearchScreen } from "./components/search-screen";
import { Shell } from "./components/shell";

const STATUSES = ["unread", "reading", "read"] as const;

function parseFilters(search: Record<string, unknown>): ItemFilters {
  const project = typeof search.project === "string" && search.project ? search.project : undefined;
  const status = STATUSES.find((s) => s === search.status);
  return { project, status };
}

const rootRoute = createRootRoute({ component: Shell });

function FilteredItems({ mode }: { mode: "library" | "inbox" }) {
  const navigate = useNavigate();
  const search = (mode === "inbox" ? inboxRoute : libraryRoute).useSearch();
  return (
    <ItemsScreen
      mode={mode}
      filters={search}
      onFiltersChange={(next) =>
        void navigate({
          to: mode === "inbox" ? "/inbox" : "/",
          search: { project: next.project, status: next.status },
        })
      }
    />
  );
}

const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: parseFilters,
  component: () => <FilteredItems mode="library" />,
});

const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/inbox",
  validateSearch: parseFilters,
  component: () => <FilteredItems mode="inbox" />,
});

const itemRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/items/$citekey",
  component: function ItemRoute() {
    const { citekey } = itemRoute.useParams();
    return <ItemView citekey={citekey} />;
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

const routeTree = rootRoute.addChildren([
  libraryRoute,
  inboxRoute,
  itemRoute,
  projectsRoute,
  projectRoute,
  searchRoute,
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
