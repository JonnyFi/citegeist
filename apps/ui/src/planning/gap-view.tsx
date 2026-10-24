import type { NumberedNode } from "@citegeist/ops";
import { useQueries } from "@tanstack/react-query";
import { CircleCheck } from "lucide-react";
import { Stamp } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { EmptyState, ErrorState, Loading } from "../components/ui/states";
import { useI18n } from "../i18n";
import { useCore } from "../lib/hooks";
import type { LinkIndex } from "../notes/library-links";
import { planDocsGet } from "./contracts";
import { findGaps } from "./insights";
import { useInsightHits } from "./insights-view";
import { StatusMeter } from "./outline-tree";

/** Nodes of the plan that have no source or no insight yet, with the reason for each. */
export function GapView({
  project,
  plan,
  nodes,
  index,
  onOpenNode,
}: {
  project: string;
  plan: string;
  nodes: readonly NumberedNode[];
  index: LinkIndex | undefined;
  onOpenNode: (id: string) => void;
}) {
  const { t } = useI18n();
  const core = useCore();
  const hits = useInsightHits(project, plan);
  const withDoc = nodes.filter((n) => n.doc);
  const docs = useQueries({
    queries: withDoc.map((n) => ({
      queryKey: ["op", planDocsGet.name, { project, plan, doc: n.id }],
      queryFn: () => core.call(planDocsGet, { project, plan, doc: n.id }),
    })),
  });

  const loading = hits.isPending || !index || docs.some((d) => d.isPending);
  const failure = hits.error ?? docs.find((d) => d.error)?.error;
  const bodies = new Map<string, string>();
  withDoc.forEach((n, i) => {
    bodies.set(n.id, docs[i]?.data?.body ?? "");
  });
  const gaps =
    index && hits.data
      ? findGaps({
          nodes,
          docs: bodies,
          hits: hits.data.hits,
          citekeys: new Set(index.items.keys()),
        })
      : [];

  if (failure) return <ErrorState error={failure} />;
  if (loading) return <Loading label={t("plan.gaps.loading")} />;
  if (nodes.length === 0) {
    return <EmptyState title={t("plan.gaps.noNodes")} description={t("plan.gaps.noNodesHint")} />;
  }
  if (gaps.length === 0) {
    return (
      <EmptyState
        icon={<CircleCheck />}
        title={t("plan.gaps.noneTitle")}
        description={t("plan.gaps.noneDescription")}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4">
      <p className="pb-3 font-mono text-[12px] text-muted">
        {t("plan.gaps.summary", { gaps: gaps.length, nodes: nodes.length })}
      </p>
      <ul aria-label={t("plan.gaps.list")} className="flex flex-col border-t border-line">
        {gaps.map(({ node, noSources, noInsights }) => (
          <li
            key={node.id}
            data-testid="gap"
            data-node-id={node.id}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-line-soft py-3"
          >
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex items-baseline gap-2" style={{ paddingLeft: node.depth * 16 }}>
                <span className="font-mono text-[12px] text-muted">{node.number}</span>
                <span className="min-w-0 truncate font-medium">{node.title}</span>
                <StatusMeter status={node.status} />
              </div>
              <div className="flex flex-wrap gap-1.5" style={{ paddingLeft: node.depth * 16 }}>
                {noSources ? <Stamp tone="danger">{t("plan.gaps.noSources")}</Stamp> : null}
                {noInsights ? <Stamp>{t("plan.gaps.noInsights")}</Stamp> : null}
              </div>
            </div>
            <Button size="sm" onClick={() => onOpenNode(node.id)}>
              {t("plan.gaps.open")}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
