import { notesList } from "@citegeist/editor/contracts";
import { graphNeighbors, itemsList } from "@citegeist/ops";
import { Network } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { Badge } from "../components/ui/badge";
import { Segmented } from "../components/ui/segmented";
import { Select } from "../components/ui/select";
import { EmptyState, ErrorState, Loading } from "../components/ui/states";
import { relationLabel } from "../connections/connections-panel";
import { NODE_KINDS, type NodeKind } from "../connections/model";
import { useOpenNode } from "../connections/open-node";
import { useI18n } from "../i18n";
import { useOp } from "../lib/hooks";
import { filterGraph, kindCounts, NO_FILTERS, relationCounts } from "./model";

const GraphCanvas = lazy(() => import("./graph-canvas"));

export type GraphDepth = 1 | 2 | 3;

function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function CheckRow({
  label,
  count,
  checked,
  onChange,
}: {
  label: string;
  count: number;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 py-0.5">
      <input type="checkbox" checked={checked} onChange={onChange} className="accent-accent" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-xs tabular-nums text-muted">{count}</span>
    </label>
  );
}

/**
 * The graph around one node: items, cards and notes with their typed links, filterable by
 * relation and node kind. Clicking a node opens it. The list next to the canvas offers the same
 * nodes as buttons.
 */
export function GraphScreen({
  node,
  depth = 1,
  onChange,
}: {
  node?: string | undefined;
  depth?: GraphDepth;
  onChange?: (next: { node?: string | undefined; depth: GraphDepth }) => void;
}) {
  const { t, has } = useI18n();
  const notes = useOp(notesList, { limit: 100 });
  const items = useOp(itemsList, { limit: 100 });
  const [filters, setFilters] = useState(NO_FILTERS);

  const options = useMemo(
    () => [
      ...(notes.data?.notes ?? []).map((n) => ({
        value: n.id,
        label: `${t("search.kind.note")}: ${n.title}`,
      })),
      ...(items.data?.items ?? []).map((i) => ({
        value: i.citekey,
        label: `${t("search.kind.item")}: ${i.title}`,
      })),
    ],
    [notes.data, items.data, t],
  );
  const center = node ?? options[0]?.value;

  const neighbors = useOp(graphNeighbors, { node: center ?? "", depth }, { enabled: !!center });
  const edgesForOpen = neighbors.data?.edges ?? [];
  const open = useOpenNode(edgesForOpen);
  const visible = useMemo(
    () => (neighbors.data && center ? filterGraph(neighbors.data, center, filters) : undefined),
    [neighbors.data, center, filters],
  );

  if (notes.isPending || items.isPending) return <Loading label={t("graph.loading")} />;
  if (!center) {
    return (
      <EmptyState
        icon={<Network className="size-5" />}
        title={t("graph.emptyTitle")}
        description={t("graph.emptyDescription")}
      />
    );
  }

  const relations = relationCounts(neighbors.data?.edges ?? []);
  const kinds = kindCounts(neighbors.data?.nodes ?? []);
  const select = (id: string) => {
    const picked = visible?.nodes.find((n) => n.id === id);
    if (picked) void open(picked);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-4 border-b border-line px-6">
        <h1 className="font-serif text-[15px] font-semibold">{t("graph.title")}</h1>
        <Select
          label={t("graph.center")}
          value={center}
          onChange={(value) => onChange?.({ node: value, depth })}
          options={options}
          className="w-72 [&>span:first-child]:truncate"
        />
        <Segmented
          label={t("graph.depth")}
          value={String(depth) as "1" | "2" | "3"}
          onChange={(value) => onChange?.({ node, depth: Number(value) as GraphDepth })}
          options={[
            { value: "1", label: t("graph.depthN", { n: 1 }) },
            { value: "2", label: t("graph.depthN", { n: 2 }) },
            { value: "3", label: t("graph.depthN", { n: 3 }) },
          ]}
        />
        {visible ? (
          <span className="ml-auto text-xs text-muted" data-testid="graph-counts">
            {t("graph.counts", { nodes: visible.nodes.length, edges: visible.edges.length })}
          </span>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {neighbors.isError ? (
            <ErrorState error={neighbors.error} />
          ) : !visible ? (
            <Loading label={t("graph.loading")} />
          ) : visible.edges.length === 0 ? (
            <EmptyState
              icon={<Network className="size-5" />}
              title={t("graph.isolatedTitle")}
              description={t("graph.isolatedDescription")}
            />
          ) : (
            <Suspense fallback={<Loading label={t("graph.loading")} />}>
              <GraphCanvas data={visible} center={center} onOpen={select} />
            </Suspense>
          )}
        </div>
        <aside
          aria-label={t("graph.sidebar")}
          className="w-72 shrink-0 overflow-y-auto border-l border-line px-4 py-4"
        >
          <fieldset className="m-0 min-w-0 border-0 p-0">
            <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
              {t("graph.relations")}
            </legend>
            {relations.map(([rel, count]) => (
              <CheckRow
                key={rel}
                label={relationLabel({ t, has }, rel)}
                count={count}
                checked={!filters.hiddenRelations.has(rel)}
                onChange={() =>
                  setFilters((f) => ({ ...f, hiddenRelations: toggled(f.hiddenRelations, rel) }))
                }
              />
            ))}
            <CheckRow
              label={t("graph.showProposed")}
              count={(neighbors.data?.edges ?? []).filter((e) => e.status === "proposed").length}
              checked={filters.showProposed}
              onChange={() => setFilters((f) => ({ ...f, showProposed: !f.showProposed }))}
            />
          </fieldset>
          <fieldset className="m-0 mt-5 min-w-0 border-0 p-0">
            <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
              {t("graph.kinds")}
            </legend>
            {NODE_KINDS.filter((k) => kinds.has(k)).map((kind: NodeKind) => (
              <CheckRow
                key={kind}
                label={t(`search.kind.${kind}`)}
                count={kinds.get(kind) ?? 0}
                checked={!filters.hiddenKinds.has(kind)}
                onChange={() =>
                  setFilters((f) => ({ ...f, hiddenKinds: toggled(f.hiddenKinds, kind) }))
                }
              />
            ))}
          </fieldset>
          <section className="mt-5" aria-label={t("graph.nodes")}>
            <h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
              {t("graph.nodes")}
            </h2>
            <ul className="flex flex-col gap-1" data-testid="graph-nodes">
              {(visible?.nodes ?? []).map((n) => (
                <li key={n.id} className="flex items-center gap-2">
                  <Badge>{t(`search.kind.${n.kind}`)}</Badge>
                  <button
                    type="button"
                    onClick={() => void open(n)}
                    aria-label={t("graph.open", { label: n.label })}
                    className="min-w-0 truncate text-left hover:text-accent"
                  >
                    {n.label}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
