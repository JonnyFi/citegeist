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
import { ProjectsScreen, ProjectView, parseProjectSearch } from "./components/projects";
import { SearchScreen } from "./components/search-screen";
import { Shell } from "./components/shell";
import { type GraphDepth, GraphScreen } from "./graph";
import { ImportScreen } from "./import";
import {
  LitsearchCompareScreen,
  LitsearchNewScreen,
  LitsearchPreprintsScreen,
  LitsearchRunScreen,
  LitsearchRunsScreen,
  LitsearchWatchesScreen,
} from "./litsearch";
import { NotesIndex, NotesLayout, NoteView } from "./notes";
import { SETTINGS_SECTIONS, SettingsScreen, type SettingsSection } from "./routes/settings";

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
  validateSearch: (
    search: Record<string, unknown>,
  ): { tab?: ItemTab; card?: string; resume?: true } => ({
    ...(search.tab === "read" ? { tab: "read" as const } : {}),
    ...(typeof search.card === "string" && search.card ? { card: search.card } : {}),
    ...(search.resume === true || search.resume === "true" ? { resume: true as const } : {}),
  }),
  component: function ItemRoute() {
    const { citekey } = itemRoute.useParams();
    const { tab, card, resume } = itemRoute.useSearch();
    const navigate = useNavigate();
    return (
      <ItemView
        citekey={citekey}
        tab={tab ?? "overview"}
        cardId={card}
        resume={resume === true}
        onChange={(next) =>
          void navigate({
            to: "/items/$citekey",
            params: { citekey },
            search: {
              ...(next.tab === "read" ? { tab: "read" as const } : {}),
              ...(next.card ? { card: next.card } : {}),
              ...(next.resume ? { resume: true as const } : {}),
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
  validateSearch: parseProjectSearch,
  component: function ProjectRoute() {
    const { slug } = projectRoute.useParams();
    const search = projectRoute.useSearch();
    const navigate = useNavigate();
    return (
      <ProjectView
        slug={slug}
        search={search}
        onSearch={(next) =>
          void navigate({ to: "/projects/$slug", params: { slug }, search: next, replace: true })
        }
      />
    );
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

const graphRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/graph",
  validateSearch: (search: Record<string, unknown>): { node?: string; depth?: GraphDepth } => ({
    ...(typeof search.node === "string" && search.node ? { node: search.node } : {}),
    ...(search.depth === 2 || search.depth === 3 ? { depth: search.depth } : {}),
  }),
  component: function GraphRoute() {
    const { node, depth } = graphRoute.useSearch();
    const navigate = useNavigate();
    return (
      <GraphScreen
        node={node}
        depth={depth ?? 1}
        onChange={(next) =>
          void navigate({
            to: "/graph",
            search: {
              ...(next.node ? { node: next.node } : {}),
              ...(next.depth > 1 ? { depth: next.depth } : {}),
            },
            replace: true,
          })
        }
      />
    );
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
  validateSearch: (search: Record<string, unknown>): { section?: SettingsSection } => {
    const section = SETTINGS_SECTIONS.find((s) => s === search.section);
    return section && section !== "general" ? { section } : {};
  },
  component: function SettingsRoute() {
    const { section } = settingsRoute.useSearch();
    const navigate = useNavigate();
    return (
      <SettingsScreen
        section={section ?? "general"}
        onSection={(next) =>
          void navigate({
            to: "/settings",
            search: next === "general" ? {} : { section: next },
            replace: true,
          })
        }
      />
    );
  },
});

const importRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/import",
  component: ImportScreen,
});

const litsearchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/litsearch",
  component: LitsearchRunsScreen,
});

const litsearchNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/litsearch/new",
  component: LitsearchNewScreen,
});

const litsearchWatchesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/litsearch/watches",
  component: LitsearchWatchesScreen,
});

const litsearchPreprintsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/litsearch/preprints",
  component: LitsearchPreprintsScreen,
});

const litsearchCompareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/litsearch/compare",
  validateSearch: (search: Record<string, unknown>): { a: string; b: string } => ({
    a: typeof search.a === "string" ? search.a : "",
    b: typeof search.b === "string" ? search.b : "",
  }),
  component: function LitsearchCompare() {
    const { a, b } = litsearchCompareRoute.useSearch();
    return <LitsearchCompareScreen a={a} b={b} />;
  },
});

const litsearchRunRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/litsearch/$runId",
  component: function LitsearchRun() {
    const { runId } = litsearchRunRoute.useParams();
    return <LitsearchRunScreen key={runId} runId={runId} />;
  },
});

const routeTree = rootRoute.addChildren([
  libraryRoute,
  inboxRoute,
  litsearchRoute,
  litsearchNewRoute,
  litsearchCompareRoute,
  litsearchWatchesRoute,
  litsearchPreprintsRoute,
  litsearchRunRoute,
  itemRoute,
  projectsRoute,
  projectRoute,
  notesRoute.addChildren([notesIndexRoute, noteRoute]),
  graphRoute,
  searchRoute,
  settingsRoute,
  importRoute,
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
