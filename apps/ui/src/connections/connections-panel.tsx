import { graphNeighbors, jobsGet, linksDecide, linksPropose, notesGet } from "@citegeist/ops";
import type { Link as NoteLink } from "@citegeist/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Network, Quote, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { ErrorState } from "../components/ui/states";
import { type MessageKey, type Translator, useI18n } from "../i18n";
import { useCore, useOp, useOpMutation } from "../lib/hooks";
import { describeError } from "../lib/utils";
import {
  type GraphEdge,
  type GraphNode,
  groupBy,
  linkTarget,
  type Neighbors,
  nodeIndex,
  relationKey,
  UNTYPED,
} from "./model";
import { useOpenNode } from "./open-node";

export type ConnectionSubject = "note" | "item";

/** Display text of a relation key, also for automatic relations. */
export function relationLabel(tr: Pick<Translator, "t" | "has">, key: string): string {
  const messageKey = `rel.${key}`;
  return tr.has(messageKey) ? tr.t(messageKey) : key;
}

const TERMINAL = ["succeeded", "failed", "cancelled"];

/** Starts links.propose and follows its job until it ends, then refetches what the screen shows. */
function useProposeLinks(noteId: string) {
  const core = useCore();
  const queryClient = useQueryClient();
  const [job, setJob] = useState<string>();
  const start = useMutation({
    mutationFn: () => core.call(linksPropose, { note: noteId }),
    onSuccess: (out) => setJob(out.job),
  });
  const status = useQuery({
    queryKey: ["op", jobsGet.name, job],
    enabled: job !== undefined,
    queryFn: () => core.call(jobsGet, { job: job as string }),
    refetchInterval: (q) => (TERMINAL.includes(q.state.data?.status ?? "") ? false : 400),
  });
  const done = useRef<string>(undefined);
  const final = status.data && TERMINAL.includes(status.data.status) ? status.data : undefined;
  useEffect(() => {
    if (!job || !final || done.current === job) return;
    done.current = job;
    void queryClient.invalidateQueries({ queryKey: ["op"] });
  }, [job, final, queryClient]);

  let state: "idle" | "running" | "done" | "failed" = "idle";
  if (start.isPending || (job && !final)) state = "running";
  else if (start.isError || final?.status === "failed" || final?.status === "cancelled") {
    state = "failed";
  } else if (final) state = "done";
  return {
    state,
    start: () => {
      setJob(undefined);
      start.mutate();
    },
    error: start.error ?? final?.error,
  };
}

function NodeName({
  node,
  fallback,
  onOpen,
}: {
  node: GraphNode | undefined;
  fallback: string;
  onOpen: (node: GraphNode) => void;
}) {
  const { t } = useI18n();
  if (!node) return <span className="min-w-0 truncate font-medium">{fallback}</span>;
  return (
    <>
      <Badge>{t(`search.kind.${node.kind}`)}</Badge>
      <button
        type="button"
        onClick={() => onOpen(node)}
        className="min-w-0 truncate text-left font-medium hover:text-accent"
      >
        {node.label}
      </button>
    </>
  );
}

interface Row {
  key: string;
  rel: string;
  node: GraphNode | undefined;
  fallback: string;
  proposed: boolean;
  why?: string | undefined;
  evidence?: string | undefined;
  by?: string | undefined;
  index?: number | undefined;
}

function rowsFromEdges(
  edges: readonly GraphEdge[],
  nodes: Map<string, GraphNode>,
  side: "from" | "to",
): Row[] {
  const other = side === "from" ? "to" : "from";
  return edges.map((e, i) => ({
    key: `${e.from}>${e.to}:${e.rel}:${i}`,
    rel: relationKey(e.rel),
    node: nodes.get(e[other]),
    fallback: e[other],
    proposed: e.status === "proposed",
  }));
}

/**
 * Graph node behind each link of the note. A link written with a slug does not match a node id,
 * so it takes the node of an edge with the same relation and status that no other link claimed.
 */
function resolveLinkNodes(
  noteId: string,
  links: readonly NoteLink[],
  nodes: Map<string, GraphNode>,
  edges: readonly GraphEdge[],
): Array<GraphNode | undefined> {
  const claimed = new Set<string>();
  const found = links.map((l) => {
    const direct = nodes.get(linkTarget(l.to));
    if (direct) claimed.add(direct.id);
    return direct;
  });
  return links.map((l, i) => {
    if (found[i]) return found[i];
    const edge = edges.find(
      (e) =>
        e.from === noteId &&
        e.rel === l.rel &&
        e.status === l.status &&
        !claimed.has(e.to) &&
        nodes.has(e.to),
    );
    if (!edge) return undefined;
    claimed.add(edge.to);
    return nodes.get(edge.to);
  });
}

function rowsFromLinks(
  links: readonly NoteLink[],
  resolved: ReadonlyArray<GraphNode | undefined>,
  keep: (link: NoteLink) => boolean,
): Row[] {
  return links.flatMap((l, index) =>
    keep(l)
      ? [
          {
            key: `link-${index}`,
            rel: relationKey(l.rel),
            node: resolved[index],
            fallback: linkTarget(l.to),
            proposed: l.status === "proposed",
            why: l.why,
            evidence: l.evidence,
            by: l.by,
            index,
          },
        ]
      : [],
  );
}

function Groups({
  rows,
  testId,
  onOpen,
}: {
  rows: Row[];
  testId: string;
  onOpen: (node: GraphNode) => void;
}) {
  const tr = useI18n();
  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      {groupBy(rows, (r) => r.rel).map(([rel, group]) => (
        <section key={rel} aria-label={relationLabel(tr, rel)}>
          <h4 className="mb-1 text-xs font-medium text-muted">{relationLabel(tr, rel)}</h4>
          <ul className="flex flex-col gap-1.5">
            {group.map((row) => (
              <li key={row.key} className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <NodeName node={row.node} fallback={row.fallback} onOpen={onOpen} />
                  {row.proposed ? (
                    <Badge tone="outline">{tr.t("notes.backlinkProposed")}</Badge>
                  ) : null}
                </div>
                {row.why ? <p className="pl-1 text-muted">{row.why}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Proposals({
  noteId,
  rows,
  nodes,
  onOpen,
}: {
  noteId: string;
  rows: Row[];
  nodes: Map<string, GraphNode>;
  onOpen: (node: GraphNode) => void;
}) {
  const tr = useI18n();
  const { t } = tr;
  const decide = useOpMutation(linksDecide);
  const busy = decide.isPending;
  return (
    <section aria-label={t("connections.proposals")} data-testid="proposals">
      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-accent">
        <Sparkles className="size-3.5" />
        {t("connections.proposals")}
      </h3>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => {
          const target = row.node?.label ?? row.fallback;
          const evidence = row.evidence ? nodes.get(linkTarget(row.evidence)) : undefined;
          return (
            <li
              key={row.key}
              className="flex flex-col gap-1.5 rounded-md border border-line bg-surface p-2.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="accent">{relationLabel(tr, row.rel)}</Badge>
                <NodeName node={row.node} fallback={row.fallback} onOpen={onOpen} />
              </div>
              {row.why ? <p>{row.why}</p> : null}
              {row.evidence ? (
                <p className="flex items-center gap-1 text-xs text-muted">
                  <Quote className="size-3" />
                  {t("connections.evidence", { card: evidence?.label ?? linkTarget(row.evidence) })}
                </p>
              ) : null}
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy}
                  aria-label={t("connections.acceptLabel", { target })}
                  onClick={() =>
                    decide.mutate({ note: noteId, accept: [row.index ?? 0], reject: [] })
                  }
                >
                  {t("connections.accept")}
                </Button>
                <Button
                  size="sm"
                  disabled={busy}
                  aria-label={t("connections.rejectLabel", { target })}
                  onClick={() =>
                    decide.mutate({ note: noteId, accept: [], reject: [row.index ?? 0] })
                  }
                >
                  {t("connections.reject")}
                </Button>
                {row.by ? (
                  <span className="ml-auto text-xs text-muted">
                    {t("connections.proposedBy", { who: row.by.replace(/^agent:/, "") })}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {decide.isError ? (
        <p role="alert" className="mt-2 text-danger">
          {describeError(decide.error, t("connections.decideFailed")).message}
        </p>
      ) : null}
    </section>
  );
}

const PROPOSE_STATUS: Record<"running" | "done" | "failed", MessageKey> = {
  running: "connections.proposing",
  done: "connections.proposeDone",
  failed: "connections.proposeFailed",
};

function ProposeButton({ noteId }: { noteId: string }) {
  const { t } = useI18n();
  const propose = useProposeLinks(noteId);
  return (
    <div className="flex items-center gap-2">
      {propose.state !== "idle" ? (
        <span
          role="status"
          aria-live="polite"
          data-testid="propose-state"
          data-state={propose.state}
          className={propose.state === "failed" ? "text-danger" : "text-muted"}
        >
          {t(PROPOSE_STATUS[propose.state])}
        </span>
      ) : null}
      <Button size="sm" disabled={propose.state === "running"} onClick={propose.start}>
        <Sparkles className="size-3.5" />
        {t("connections.propose")}
      </Button>
    </div>
  );
}

/**
 * Typed connections of a note or an item: what it links to and what links to it, grouped by
 * relation. For a note the AI proposals show first, each with a reason, and can be accepted or
 * rejected.
 */
export function ConnectionsPanel({ kind, id }: { kind: ConnectionSubject; id: string }) {
  const { t } = useI18n();
  const neighbors = useOp(graphNeighbors, { node: id, depth: 1 });
  const note = useOp(notesGet, { id }, { enabled: kind === "note" });
  const data: Neighbors | undefined = neighbors.data;
  const open = useOpenNode(data?.edges ?? []);
  const nodes = nodeIndex(data);

  const edgesOut = (data?.edges ?? []).filter((e) => e.from === id && e.to !== id);
  const edgesIn = (data?.edges ?? []).filter((e) => e.to === id && e.from !== id);

  let proposals: Row[] = [];
  let outgoing: Row[];
  if (kind === "note") {
    const links = note.data?.frontmatter.links ?? [];
    const resolved = resolveLinkNodes(id, links, nodes, data?.edges ?? []);
    proposals = rowsFromLinks(links, resolved, (l) => l.status === "proposed");
    const typed = rowsFromLinks(links, resolved, (l) => l.status !== "proposed");
    const covered = new Set([
      ...links.map((l) => linkTarget(l.to)),
      ...resolved.flatMap((n) => (n ? [n.id] : [])),
    ]);
    // Wiki links to something the note also links with a type would only repeat that link.
    const rest = rowsFromEdges(
      edgesOut.filter((e) => relationKey(e.rel) !== UNTYPED || !covered.has(e.to)),
      nodes,
      "from",
    ).filter(
      (r) =>
        r.rel === UNTYPED ||
        r.rel === "cites" ||
        r.rel === "excerpt-of" ||
        r.rel === "derived-from",
    );
    outgoing = [...typed, ...rest];
  } else {
    outgoing = rowsFromEdges(edgesOut, nodes, "from");
  }
  const incoming = rowsFromEdges(edgesIn, nodes, "to");
  const total = proposals.length + outgoing.length + incoming.length;

  const loading = neighbors.isPending || (kind === "note" && note.isPending);
  const error = neighbors.error ?? note.error;

  return (
    <section aria-labelledby="connections-heading" className="mt-10" data-testid="connections">
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-line pb-1.5">
        <h2
          id="connections-heading"
          className="flex items-baseline gap-2 text-xs font-medium uppercase tracking-wide text-muted"
        >
          {t("connections.title")}
          {!loading ? <span className="tabular-nums">{total}</span> : null}
        </h2>
        <div className="flex items-center gap-3">
          <Link
            to="/graph"
            search={{ node: id }}
            className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink"
          >
            <Network className="size-3.5" />
            {t("connections.openGraph")}
          </Link>
          {kind === "note" ? <ProposeButton noteId={id} /> : null}
        </div>
      </div>
      {error ? (
        <ErrorState error={error} />
      ) : loading ? (
        <p className="text-muted">{t("connections.loading")}</p>
      ) : (
        <div className="flex flex-col gap-5">
          {proposals.length > 0 ? (
            <Proposals noteId={id} rows={proposals} nodes={nodes} onOpen={(n) => void open(n)} />
          ) : null}
          {outgoing.length > 0 ? (
            <div>
              <h3 className="mb-1.5 text-xs font-medium text-muted">{t("connections.outgoing")}</h3>
              <Groups rows={outgoing} testId="outgoing" onOpen={(n) => void open(n)} />
            </div>
          ) : null}
          {incoming.length > 0 ? (
            <div>
              <h3 className="mb-1.5 text-xs font-medium text-muted">{t("connections.incoming")}</h3>
              <Groups rows={incoming} testId="incoming" onOpen={(n) => void open(n)} />
            </div>
          ) : null}
          {total === 0 ? <p className="text-muted">{t("connections.empty")}</p> : null}
        </div>
      )}
    </section>
  );
}
