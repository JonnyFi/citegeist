import { scanWikiLinks } from "@citegeist/editor";
import { type InsightHit, insightsFind, insightsNote, type NumberedNode } from "@citegeist/ops";
import { Link } from "@tanstack/react-router";
import { Lightbulb } from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";
import { Label } from "../components/layout";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/input";
import { EmptyState, ErrorState, Loading } from "../components/ui/states";
import { useI18n } from "../i18n";
import { useOp, useOpMutation } from "../lib/hooks";
import { describeError } from "../lib/utils";
import type { LinkIndex } from "../notes/library-links";
import { insightText, nodesOfInsight, placeOf } from "./insights";
import { nodeLabel } from "./outline";

/** The hits the insights view and the gap view share: everything noted in the plan and the project. */
export function useInsightHits(project: string, plan: string) {
  return useOp(insightsFind, { project, plan, limit: 50 });
}

/** Citekeys of the sources an insight links, directly or through a card. */
export function sourcesOf(text: string, index: LinkIndex | undefined): string[] {
  const out: string[] = [];
  for (const m of scanWikiLinks(text)) {
    if (index?.items.has(m.target)) out.push(m.target);
    else {
      const card = index?.cards.get(m.target);
      if (card) out.push(card.frontmatter.item);
    }
  }
  return [...new Set(out)];
}

function sourceLabel(index: LinkIndex | undefined, citekey: string): string {
  const item = index?.items.get(citekey);
  const parts = [item?.authors, item?.year].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : citekey;
}

/** The paragraph with its wiki links as chips: sources open the source, nodes open the node. */
function InsightBody({
  text,
  nodes,
  index,
  onOpenNode,
}: {
  text: string;
  nodes: readonly NumberedNode[];
  index: LinkIndex | undefined;
  onOpenNode: (id: string) => void;
}) {
  const { t } = useI18n();
  const parts: ReactNode[] = [];
  let at = 0;
  for (const m of scanWikiLinks(text)) {
    parts.push(text.slice(at, m.from));
    at = m.to;
    const node = nodes.find((n) => n.id === m.target);
    const card = index?.cards.get(m.target);
    const known = index?.items.has(m.target);
    const key = `${m.from}`;
    if (node) {
      parts.push(
        <button
          key={key}
          type="button"
          onClick={() => onOpenNode(node.id)}
          className="border-b border-ink font-mono text-[0.85em]"
        >
          {nodeLabel(node)}
        </button>,
      );
    } else if (known) {
      parts.push(
        <Link
          key={key}
          to="/items/$citekey"
          params={{ citekey: m.target }}
          className="border-b border-ink font-mono text-[0.85em]"
        >
          {m.alias ?? m.target}
        </Link>,
      );
    } else if (card) {
      parts.push(
        <Link
          key={key}
          to="/items/$citekey"
          params={{ citekey: card.frontmatter.item }}
          search={{ tab: "read", card: card.frontmatter.id }}
          className="border-b border-ink font-mono text-[0.85em]"
        >
          {m.alias ?? t("plan.insight.card")}
        </Link>,
      );
    } else {
      parts.push(
        <span
          key={key}
          className="border-b border-danger font-mono text-[0.85em] text-danger"
          title={t("plan.insight.unresolved")}
        >
          {m.alias ?? m.target}
        </span>,
      );
    }
  }
  parts.push(text.slice(at));
  return (
    <p className="font-serif text-[15px] leading-[1.5]">
      {parts.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static split of one paragraph
        <Fragment key={i}>{p}</Fragment>
      ))}
    </p>
  );
}

function InsightRow({
  hit,
  nodes,
  index,
  onOpenNode,
  onOpenPlan,
}: {
  hit: InsightHit;
  nodes: readonly NumberedNode[];
  index: LinkIndex | undefined;
  onOpenNode: (id: string) => void;
  onOpenPlan: (doc: "plan" | "project") => void;
}) {
  const { t } = useI18n();
  const text = insightText(hit);
  const sources = sourcesOf(text, index);
  const place = placeOf(hit.path, nodes);
  const about = nodesOfInsight(hit, nodes);
  return (
    <li
      data-testid="insight"
      data-block={hit.block}
      className="grid grid-cols-[88px_minmax(0,1fr)] gap-4 border-b border-line-soft py-4"
    >
      <div className="flex flex-col gap-1 font-mono text-[12px] text-muted">
        <span>{hit.date ?? ""}</span>
        {hit.block ? <span className="text-[11px]">{hit.block}</span> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-2.5">
        <InsightBody text={text} nodes={nodes} index={index} onOpenNode={onOpenNode} />
        <dl className="flex flex-col gap-1 text-[12px]">
          <div className="flex flex-wrap items-baseline gap-2">
            <dt className="w-16 shrink-0 text-muted">{t("plan.insight.target")}</dt>
            <dd className="flex flex-wrap gap-1.5">
              {about.length > 0 ? (
                about.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => onOpenNode(n.id)}
                    className="border border-line px-2 py-[2px] hover:bg-sunken"
                  >
                    {nodeLabel(n)}
                  </button>
                ))
              ) : (
                <button
                  type="button"
                  onClick={() => onOpenPlan(place.kind === "plan" ? "plan" : "project")}
                  className="border border-line px-2 py-[2px] hover:bg-sunken"
                >
                  {place.kind === "plan" ? t("plan.planDoc") : t("plan.projectInsights")}
                </button>
              )}
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline gap-2">
            <dt className="w-16 shrink-0 text-muted">{t("plan.insight.sources")}</dt>
            <dd className="flex flex-wrap gap-1.5">
              {sources.length > 0 ? (
                sources.map((citekey) => (
                  <Link
                    key={citekey}
                    to="/items/$citekey"
                    params={{ citekey }}
                    className="border border-line-faint px-2 py-[2px] hover:bg-sunken"
                  >
                    {sourceLabel(index, citekey)}
                  </Link>
                ))
              ) : (
                <span className="text-muted">{t("plan.insight.noSources")}</span>
              )}
            </dd>
          </div>
        </dl>
      </div>
    </li>
  );
}

/** Form to write an insight by hand into the place that is open; the agent writes the same way. */
function NoteForm({
  project,
  plan,
  target,
  targetLabel,
}: {
  project: string;
  plan: string;
  target: string;
  targetLabel: string;
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const note = useOpMutation(insightsNote);
  return (
    <form
      aria-label={t("plan.insight.new")}
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        note.mutate({ project, plan, target, text: text.trim() }, { onSuccess: () => setText("") });
      }}
      className="flex flex-col gap-2 border-b border-line pb-4"
    >
      <Label>{t("plan.insight.new")}</Label>
      <Textarea
        aria-label={t("plan.insight.text")}
        rows={3}
        value={text}
        placeholder={t("plan.insight.placeholder")}
        onChange={(e) => setText(e.target.value)}
        className="resize-none font-serif text-[15px] leading-[1.5]"
      />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" variant="primary" disabled={note.isPending || !text.trim()}>
          {t("plan.insight.save")}
        </Button>
        <span className="text-[12px] text-muted">
          {t("plan.insight.goesTo", { place: targetLabel })}
        </span>
        {note.data ? (
          <span role="status" className="text-[12px]">
            {note.data.summary}
          </span>
        ) : null}
        {note.error ? (
          <span role="alert" className="text-[12px] text-danger">
            {describeError(note.error).message}
          </span>
        ) : null}
      </div>
    </form>
  );
}

/** All insights of the plan and the project with their sources and the node they are about. */
export function InsightsView({
  project,
  plan,
  nodes,
  index,
  selected,
  onOpenNode,
  onOpenPlan,
}: {
  project: string;
  plan: string;
  nodes: readonly NumberedNode[];
  index: LinkIndex | undefined;
  /** "plan", "project" or a node id: where a new insight goes. */
  selected: string;
  onOpenNode: (id: string) => void;
  onOpenPlan: (doc: "plan" | "project") => void;
}) {
  const { t, tn } = useI18n();
  const hits = useInsightHits(project, plan);
  const node = nodes.find((n) => n.id === selected);
  const targetLabel = node
    ? nodeLabel(node)
    : selected === "project"
      ? t("plan.projectInsights")
      : t("plan.planDoc");

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4">
      <NoteForm
        project={project}
        plan={plan}
        target={node ? node.id : selected === "project" ? "project" : "plan"}
        targetLabel={targetLabel}
      />
      {hits.isPending ? (
        <Loading label={t("plan.insight.loading")} />
      ) : hits.isError ? (
        <ErrorState error={hits.error} />
      ) : hits.data.hits.length === 0 ? (
        <EmptyState
          icon={<Lightbulb />}
          title={t("plan.insight.emptyTitle")}
          description={t("plan.insight.emptyDescription")}
        />
      ) : (
        <>
          <p className="py-3 font-mono text-[12px] text-muted">
            {tn("plan.insight.count", hits.data.hits.length)}
          </p>
          <ul aria-label={t("plan.insights")} className="flex flex-col border-t border-line">
            {hits.data.hits.map((hit) => (
              <InsightRow
                key={`${hit.path}#${hit.block ?? hit.text}`}
                hit={hit}
                nodes={nodes}
                index={index}
                onOpenNode={onOpenNode}
                onOpenPlan={onOpenPlan}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
