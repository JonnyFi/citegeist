import { Menu as BaseMenu } from "@base-ui/react/menu";
import {
  aggregateGraph,
  graphProject,
  MENTIONS,
  projectsList,
  type SemanticEdge,
  type SemanticNode,
  textsList,
} from "@citegeist/ops";
import type { CardKind } from "@citegeist/schema";
import { Check, ChevronDown, Network, X } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Select } from "../components/ui/select";
import { EmptyState, ErrorState, Loading } from "../components/ui/states";
import { relationLabel } from "../connections/connections-panel";
import { useOpenNode } from "../connections/open-node";
import { useI18n } from "../i18n";
import { useOp } from "../lib/hooks";
import { cn } from "../lib/utils";
import { EdgePanel, nodeName, RelationSwatch } from "./edge-panel";
import {
  CARD_KINDS,
  GRAPH_RELATIONS,
  type GraphFilters,
  layout,
  NO_FILTERS,
  type Positions,
  toggleIn,
} from "./model";

const GraphCanvas = lazy(() => import("./graph-canvas"));

/** What the graph shows: a project (default), the whole library, or the area around one node. */
export interface GraphLocation {
  project?: string | undefined;
  library?: boolean | undefined;
  text?: string | undefined;
  node?: string | undefined;
}

const SCOPE_KEY = "citegeist.graph.scope";
const LIBRARY = "@library";
/** Above this many edges between sources their labels show only on hover. */
const LABEL_LIMIT = 12;

function rememberedScope(): string | undefined {
  try {
    return localStorage.getItem(SCOPE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function remember(scope: string) {
  try {
    localStorage.setItem(SCOPE_KEY, scope);
  } catch {
    // private mode: the choice lasts until the next start
  }
}

interface FilterOption {
  value: string;
  label: string;
  count: number;
  checked: boolean;
  rel?: string | undefined;
}

/** A compact multi-select of the filter row, on the Base UI menu with checkbox items. */
function FilterMenu({
  label,
  summary,
  active,
  options,
  onToggle,
  extra,
}: {
  label: string;
  summary: string;
  active: boolean;
  options: readonly FilterOption[];
  onToggle: (value: string) => void;
  extra?: { label: string; count: number; checked: boolean; onChange: () => void } | undefined;
}) {
  const item =
    "flex h-8 cursor-default items-center gap-2 px-2.5 text-[12px] data-[highlighted]:bg-sunken";
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger
        type="button"
        aria-label={label}
        className={cn(
          "inline-flex h-[26px] items-center gap-2 border px-2.5 text-[12px]",
          active
            ? "border-ink bg-ink text-bg hover:opacity-85"
            : "border-line bg-transparent text-ink hover:bg-sunken",
        )}
      >
        {summary}
        <ChevronDown className={cn("size-3.5", active ? "text-bg" : "text-muted")} />
      </BaseMenu.Trigger>
      <BaseMenu.Portal>
        <BaseMenu.Positioner sideOffset={4} align="start" className="z-50">
          <BaseMenu.Popup className="min-w-52 border border-line bg-surface py-1 text-ink">
            {options.map((o) => (
              <BaseMenu.CheckboxItem
                key={o.value}
                checked={o.checked}
                onCheckedChange={() => onToggle(o.value)}
                closeOnClick={false}
                className={item}
              >
                <span className="flex w-3.5 justify-center">
                  {o.checked ? <Check className="size-3.5" /> : null}
                </span>
                {o.rel ? <RelationSwatch rel={o.rel} /> : null}
                <span className="flex-1">{o.label}</span>
                <span className="tabular-nums text-muted">{o.count}</span>
              </BaseMenu.CheckboxItem>
            ))}
            {extra ? (
              <>
                <BaseMenu.Separator className="my-1 h-px bg-line-soft" />
                <BaseMenu.CheckboxItem
                  checked={extra.checked}
                  onCheckedChange={extra.onChange}
                  closeOnClick={false}
                  className={item}
                >
                  <span className="flex w-3.5 justify-center">
                    {extra.checked ? <Check className="size-3.5" /> : null}
                  </span>
                  <span className="flex-1">{extra.label}</span>
                </BaseMenu.CheckboxItem>
              </>
            ) : null}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}

/** The menu of a node, at the place of the click. */
function NodeMenu({
  node,
  at,
  expanded,
  onClose,
  entries,
}: {
  node: SemanticNode;
  at: { x: number; y: number };
  expanded: boolean;
  onClose: () => void;
  entries: Array<{ label: string; onSelect: () => void }>;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector("button")?.focus();
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={t("graph.node.menu", { label: nodeName(node, node.id) })}
      data-expanded={expanded}
      className="fixed z-50 min-w-44 border border-line bg-surface py-1 text-ink"
      style={{ left: at.x + 6, top: at.y + 6 }}
    >
      {entries.map((e) => (
        <button
          key={e.label}
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            e.onSelect();
          }}
          className="flex h-8 w-full items-center px-2.5 text-left text-[12px] hover:bg-sunken focus:bg-sunken focus:outline-none"
        >
          {e.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The graph of a project: each source a node sized by its cards, the connections of its cards and
 * notes as labelled edges between sources. A click on a source shows its cards, a click on an edge
 * shows what it rests on. "Show from here" narrows the view to two steps around one node.
 */
export function GraphScreen({
  location = {},
  onChange,
}: {
  location?: GraphLocation;
  onChange?: (next: GraphLocation) => void;
}) {
  const tr = useI18n();
  const { t, tn } = tr;
  const projects = useOp(projectsList, {});
  const ego = location.node;

  const scope = useMemo(() => {
    if (location.library) return LIBRARY;
    if (location.project) return location.project;
    const all = projects.data?.projects ?? [];
    const stored = rememberedScope();
    if (stored && (stored === LIBRARY || all.some((p) => p.slug === stored))) return stored;
    return all.find((p) => p.status === "active")?.slug ?? all[0]?.slug ?? LIBRARY;
  }, [location.library, location.project, projects.data]);
  const project = scope === LIBRARY ? undefined : scope;

  const texts = useOp(textsList, { project: project ?? "" }, { enabled: !!project && !ego });
  const [filters, setFilters] = useState<GraphFilters>(NO_FILTERS);
  const text = ego ? undefined : location.text;

  const graph = useOp(
    graphProject,
    {
      ...(ego ? { around: ego } : project ? { project } : {}),
      ...(text && project ? { text } : {}),
      depth: 2,
      expand: [],
      proposed: filters.proposed,
    },
    { enabled: projects.isSuccess || !!ego },
  );

  const nodes = useMemo(
    () => new Map((graph.data?.nodes ?? []).map((n) => [n.id, n])),
    [graph.data],
  );
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<string>();
  const [menu, setMenu] = useState<{ id: string; at: { x: number; y: number } }>();
  const positions = useRef<Positions>(new Map());
  const viewKey = `${scope}|${ego ?? ""}|${text ?? ""}`;

  // a new view starts collapsed, an ego view with the source of its node open
  useEffect(() => {
    void viewKey;
    positions.current = new Map();
    setSelected(undefined);
    setMenu(undefined);
    setExpanded(new Set());
  }, [viewKey]);
  useEffect(() => {
    if (!ego || !graph.data) return;
    const start = graph.data.nodes.find((n) => n.id === ego);
    const item =
      start?.kind === "card" ? start.item : start?.kind === "item" ? start.id : undefined;
    if (item) setExpanded(new Set([item]));
  }, [ego, graph.data]);

  const view = useMemo(
    () =>
      graph.data
        ? aggregateGraph(graph.data, {
            expanded,
            relations: filters.relations,
            kinds: filters.kinds,
          })
        : undefined,
    [graph.data, expanded, filters.relations, filters.kinds],
  );
  const placed = useMemo(() => {
    if (!view) return new Map() as Positions;
    const next = layout(view, positions.current);
    for (const [id, p] of next) {
      if (nodes.get(id)?.kind !== "card") positions.current.set(id, p);
    }
    return next;
  }, [view, nodes]);

  const links = useMemo(
    () => new Map((graph.data?.links ?? []).map((l) => [l.id, l])),
    [graph.data],
  );
  const explanations = useMemo(
    () => new Map((graph.data?.explanations ?? []).map((x) => [x.id, x])),
    [graph.data],
  );
  const edgeLabel = useMemo(() => {
    const byId = new Map((view?.edges ?? []).map((e) => [e.id, e]));
    return (id: string) => {
      const e = byId.get(id);
      if (!e) return "";
      const rel = relationLabel(tr, e.rel === MENTIONS ? "untyped" : e.rel);
      return e.evidence.length > 0 ? `${rel} (${tn("graph.edgeCards", e.evidence.length)})` : rel;
    };
  }, [view, tr, tn]);
  const labelled = useMemo(() => {
    const between = (view?.edges ?? []).filter(
      (e) =>
        e.rel !== MENTIONS &&
        nodes.get(e.from)?.kind !== "card" &&
        nodes.get(e.to)?.kind !== "card",
    );
    return new Set(between.length <= LABEL_LIMIT ? between.map((e) => e.id) : []);
  }, [view, nodes]);

  const openEdges = useMemo(
    () =>
      (graph.data?.nodes ?? []).flatMap((n) =>
        n.kind === "card" && n.item
          ? [{ from: n.id, to: n.item, rel: "excerpt-of", status: "accepted" }]
          : [],
      ),
    [graph.data],
  );
  const open = useOpenNode(openEdges);

  if (projects.isPending && !ego) return <Loading label={t("graph.loading")} />;

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const go = (next: GraphLocation) => onChange?.(next);
  const here: GraphLocation = project ? { project } : { library: true };

  const menuEntries = (n: SemanticNode) => [
    ...(n.kind === "item" && (n.cards ?? 0) > 0
      ? [
          {
            label: expanded.has(n.id) ? t("graph.node.collapse") : t("graph.node.expand"),
            onSelect: () => toggleExpanded(n.id),
          },
        ]
      : []),
    ...(n.id !== ego
      ? [{ label: t("graph.node.focus"), onSelect: () => go({ ...here, node: n.id }) }]
      : []),
    { label: t("graph.node.open"), onSelect: () => void open(n) },
  ];

  const onNode = (id: string, at: { x: number; y: number }) => {
    const n = nodes.get(id);
    if (!n) return;
    if (n.kind === "item" && (n.cards ?? 0) > 0) toggleExpanded(id);
    else setMenu({ id, at });
  };

  // Filter options: what the data holds, with counts.
  const relCounts = new Map<string, number>();
  for (const l of graph.data?.links ?? []) relCounts.set(l.rel, (relCounts.get(l.rel) ?? 0) + 1);
  const relOptions: FilterOption[] = GRAPH_RELATIONS.filter((r) => relCounts.has(r)).map((r) => ({
    value: r,
    rel: r,
    label: relationLabel(tr, r === MENTIONS ? "untyped" : r),
    count: relCounts.get(r) ?? 0,
    checked: !filters.relations || filters.relations.has(r),
  }));
  const kindCounts = new Map<CardKind, number>();
  for (const n of graph.data?.nodes ?? []) {
    if (n.kind === "card" && n.cardKind)
      kindCounts.set(n.cardKind, (kindCounts.get(n.cardKind) ?? 0) + 1);
  }
  const kindOptions: FilterOption[] = CARD_KINDS.filter((k) => kindCounts.has(k)).map((k) => ({
    value: k,
    label: t(`kind.${k}`),
    count: kindCounts.get(k) ?? 0,
    checked: !filters.kinds || filters.kinds.has(k),
  }));
  const presentRelations = relOptions.map((o) => o.value);
  const presentKinds = kindOptions.map((o) => o.value as CardKind);
  const focusNode = ego ? nodes.get(ego) : undefined;
  const textOptions = texts.data?.texts ?? [];
  const selectedEdge = view?.edges.find((e) => e.id === selected);
  const menuNode = menu ? nodes.get(menu.id) : undefined;
  const sortedEdges = [...(view?.edges ?? [])].sort(
    (a, b) =>
      Number(a.rel === MENTIONS) - Number(b.rel === MENTIONS) ||
      b.evidence.length - a.evidence.length ||
      a.id.localeCompare(b.id),
  );
  const edgeText = (e: SemanticEdge) =>
    `${nodeName(nodes.get(e.from), e.from)} ${edgeLabel(e.id)} ${nodeName(nodes.get(e.to), e.to)}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-line px-6">
        <h1 className="mr-1 font-serif text-[15px] font-semibold">{t("graph.title")}</h1>
        {ego ? (
          <span className="inline-flex h-[26px] max-w-80 items-center gap-1.5 border border-ink bg-ink pl-2.5 text-[12px] text-bg">
            <span className="truncate">
              {t("graph.focus", { label: nodeName(focusNode, ego) })}
            </span>
            <button
              type="button"
              aria-label={t("graph.focusClose")}
              onClick={() => go(here)}
              className="flex h-full items-center px-1.5 hover:opacity-80"
            >
              <X className="size-3.5" />
            </button>
          </span>
        ) : (
          <Select
            label={t("graph.scope")}
            value={scope}
            onChange={(value) => {
              remember(value);
              go(value === LIBRARY ? { library: true } : { project: value });
            }}
            options={[
              ...(projects.data?.projects ?? []).map((p) => ({ value: p.slug, label: p.title })),
              { value: LIBRARY, label: t("graph.library") },
            ]}
            className="w-52 [&>span:first-child]:truncate"
          />
        )}
        <div className="flex items-center gap-2">
          <FilterMenu
            label={t("graph.relations")}
            summary={
              filters.relations
                ? tn("graph.relationsSome", filters.relations.size)
                : t("graph.relationsAll")
            }
            active={!!filters.relations}
            options={relOptions}
            onToggle={(rel) =>
              setFilters((f) => ({ ...f, relations: toggleIn(f.relations, presentRelations, rel) }))
            }
            extra={{
              label: t("graph.showProposed"),
              count: 0,
              checked: filters.proposed,
              onChange: () => setFilters((f) => ({ ...f, proposed: !f.proposed })),
            }}
          />
          {kindOptions.length > 0 ? (
            <FilterMenu
              label={t("graph.kinds")}
              summary={
                filters.kinds ? tn("graph.kindsSome", filters.kinds.size) : t("graph.kindsAll")
              }
              active={!!filters.kinds}
              options={kindOptions}
              onToggle={(kind) =>
                setFilters((f) => ({
                  ...f,
                  kinds: toggleIn(f.kinds, presentKinds, kind as CardKind),
                }))
              }
            />
          ) : null}
          {project && !ego && textOptions.length > 0 ? (
            <Select
              label={t("graph.text")}
              value={text ?? ""}
              active={!!text}
              onChange={(value) => go({ project, ...(value ? { text: value } : {}) })}
              options={[
                { value: "", label: t("graph.textAll") },
                ...textOptions.map((x) => ({ value: x.text, label: x.title })),
              ]}
              className="w-40 [&>span:first-child]:truncate"
            />
          ) : null}
          {filters.relations || filters.kinds || text ? (
            <button
              type="button"
              onClick={() => {
                setFilters((f) => ({ ...f, relations: undefined, kinds: undefined }));
                if (text) go(here);
              }}
              className="text-xs text-muted hover:text-ink"
            >
              {t("graph.reset")}
            </button>
          ) : null}
        </div>
        {view ? (
          <span className="ml-auto text-xs text-muted" data-testid="graph-counts">
            {t("graph.counts", { nodes: view.nodes.length, edges: view.edges.length })}
          </span>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {graph.isError ? (
            <ErrorState error={graph.error} />
          ) : !view ? (
            <Loading label={t("graph.loading")} />
          ) : (graph.data?.nodes.length ?? 0) === 0 ? (
            <EmptyState
              icon={<Network className="size-5" />}
              title={t("graph.emptyTitle")}
              description={t("graph.emptyDescription")}
            />
          ) : view.edges.length === 0 && view.nodes.length === 0 ? (
            <EmptyState
              icon={<Network className="size-5" />}
              title={t("graph.isolatedTitle")}
              description={t("graph.isolatedDescription")}
            />
          ) : (
            <Suspense fallback={<Loading label={t("graph.loading")} />}>
              <GraphCanvas
                view={view}
                positions={placed}
                edgeLabel={edgeLabel}
                labelled={labelled}
                selectedEdge={selected}
                focus={ego}
                onNode={onNode}
                onNodeMenu={(id, at) => setMenu({ id, at })}
                onEdge={(id) => setSelected(id)}
                onStage={() => setSelected(undefined)}
              />
            </Suspense>
          )}
        </div>
        <aside
          aria-label={t("graph.panel")}
          className="w-80 shrink-0 overflow-y-auto border-l border-line px-5 py-4"
        >
          {selectedEdge ? (
            <EdgePanel
              edge={selectedEdge}
              nodes={nodes}
              links={links}
              explanations={explanations}
              onBack={() => setSelected(undefined)}
              onOpen={(n) => void open(n)}
            />
          ) : (
            <>
              <p className="mb-4 text-xs leading-snug text-muted">{t("graph.hint")}</p>
              <h2 className="mb-1.5 text-label font-medium uppercase tracking-wide text-muted">
                {t("graph.edges")}
              </h2>
              <ul className="flex flex-col" data-testid="graph-edges">
                {sortedEdges.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(e.id)}
                      aria-label={t("graph.edgeOpen", { label: edgeText(e) })}
                      className={cn(
                        "flex w-full items-center gap-2.5 py-1.5 text-left text-[12px] leading-tight hover:bg-sunken",
                        e.rel === MENTIONS && "text-muted",
                      )}
                    >
                      <RelationSwatch rel={e.rel} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">
                          {nodeName(nodes.get(e.from), e.from)}
                          <span className="text-muted"> → </span>
                          {nodeName(nodes.get(e.to), e.to)}
                        </span>
                        <span className="truncate text-muted">{edgeLabel(e.id)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <details className="mt-5">
                <summary className="cursor-pointer text-label font-medium uppercase tracking-wide text-muted">
                  {t("graph.nodes")}
                </summary>
                <ul className="mt-1.5 flex flex-col" data-testid="graph-nodes">
                  {(view?.nodes ?? []).map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={(ev) =>
                          setMenu({ id: n.id, at: { x: ev.clientX - 200, y: ev.clientY } })
                        }
                        className="w-full truncate py-0.5 text-left text-[12px] hover:text-accent"
                      >
                        {nodeName(n, n.id)}
                        {n.outside ? (
                          <span className="text-muted"> · {t("graph.outside")}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            </>
          )}
        </aside>
      </div>
      {menu && menuNode ? (
        <NodeMenu
          node={menuNode}
          at={menu.at}
          expanded={expanded.has(menuNode.id)}
          onClose={() => setMenu(undefined)}
          entries={menuEntries(menuNode)}
        />
      ) : null}
    </div>
  );
}
