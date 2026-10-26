import type { ExplanationNote, SemanticEdge, SemanticNode } from "@citegeist/ops";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { relationLabel } from "../connections/connections-panel";
import { useI18n } from "../i18n";
import { relationStyle, truncate } from "./model";

/** A short line in the colour and dash of a relation, as in the canvas. */
export function RelationSwatch({ rel }: { rel: string }) {
  const style = relationStyle(rel);
  return (
    <svg aria-hidden="true" width="18" height="6" className="shrink-0" viewBox="0 0 18 6">
      <line
        x1="0"
        y1="3"
        x2="18"
        y2="3"
        stroke={`var(${style.token})`}
        strokeWidth="2"
        strokeDasharray={style.dash === "dashed" ? "5 3" : style.dash === "dotted" ? "1.5 3" : ""}
      />
    </svg>
  );
}

export function nodeName(n: SemanticNode | undefined, fallback: string): string {
  if (!n) return fallback;
  if (n.kind === "item") return n.short ?? n.label;
  return truncate(n.label, 60);
}

/**
 * What one connection rests on: its relation between the two ends, the reason, the evidence cards
 * and the notes that explain it. Opened by a click on an edge in the canvas or in the list.
 */
export function EdgePanel({
  edge,
  nodes,
  links,
  explanations,
  onBack,
  onOpen,
}: {
  edge: SemanticEdge;
  nodes: ReadonlyMap<string, SemanticNode>;
  links: ReadonlyMap<string, { why?: string | undefined; by?: string | undefined }>;
  explanations: ReadonlyMap<string, ExplanationNote>;
  onBack: () => void;
  onOpen: (node: Pick<SemanticNode, "id" | "kind" | "label">) => void;
}) {
  const tr = useI18n();
  const { t, tn } = tr;
  const from = nodes.get(edge.from);
  const to = nodes.get(edge.to);
  const reasons = [
    ...new Map(
      edge.links.flatMap((id) => {
        const l = links.get(id);
        return l?.why ? [[l.why, l.by] as const] : [];
      }),
    ),
  ];
  const cards = edge.evidence.flatMap((id) => {
    const n = nodes.get(id);
    return n ? [n] : [];
  });
  const notes = edge.notes.flatMap((id) => {
    const n = explanations.get(id);
    return n ? [n] : [];
  });
  const heading = (text: string) => (
    <h3 className="mb-1.5 text-label font-medium uppercase tracking-wide text-muted">{text}</h3>
  );
  const sourceOf = (card: SemanticNode) => (card.item ? nodes.get(card.item) : undefined);

  return (
    <section aria-label={t("graph.edgeOpen", { label: relationLabel(tr, edge.rel) })}>
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1 text-xs text-muted hover:text-ink"
      >
        <ArrowLeft className="size-3.5" />
        {t("graph.edge.back")}
      </button>
      <div className="flex flex-col gap-1.5" data-testid="edge-panel">
        <button
          type="button"
          className="text-left font-serif text-[15px] font-semibold hover:underline"
          onClick={() => from && onOpen(from)}
        >
          {nodeName(from, edge.from)}
        </button>
        <span className="flex items-center gap-2 text-[13px]">
          <RelationSwatch rel={edge.rel} />
          {relationLabel(tr, edge.rel)}
          {edge.status === "proposed" ? (
            <Badge tone="outline">{t("graph.edge.proposed")}</Badge>
          ) : null}
        </span>
        <button
          type="button"
          className="text-left font-serif text-[15px] font-semibold hover:underline"
          onClick={() => to && onOpen(to)}
        >
          {nodeName(to, edge.to)}
        </button>
      </div>

      {reasons.length > 0 ? (
        <div className="mt-5">
          {heading(t("graph.edge.why"))}
          <ul className="flex flex-col gap-2">
            {reasons.map(([why, by]) => (
              <li key={why} className="text-[13px] leading-snug">
                {why}
                {by?.startsWith("agent:") ? (
                  <span className="ml-1 text-xs text-muted">
                    {t("graph.edge.byAgent", { who: by.slice("agent:".length) })}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {notes.length > 0 ? (
        <div className="mt-5">
          {heading(t("graph.edge.notes"))}
          <ul className="flex flex-col gap-3">
            {notes.map((n) => (
              <li key={n.id} className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => onOpen({ id: n.id, kind: "note", label: n.title })}
                  aria-label={t("graph.edge.openNote", { title: n.title })}
                  className="inline-flex items-center gap-1 text-left text-[13px] font-medium hover:underline"
                >
                  {n.title}
                  <ExternalLink className="size-3 shrink-0 text-muted" />
                </button>
                {n.excerpt ? (
                  <p className="line-clamp-4 text-[13px] leading-snug text-muted">{n.excerpt}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {cards.length > 0 ? (
        <div className="mt-5">
          {heading(`${t("graph.edge.evidence")} · ${tn("graph.edgeCards", cards.length)}`)}
          <ul className="flex flex-col gap-3">
            {cards.map((c) => (
              <li
                key={c.id}
                className="border-l-2 pl-3"
                style={{ borderColor: `var(--card-${c.cardKind ?? "none"})` }}
              >
                <blockquote className="line-clamp-5 font-serif text-[14px] leading-snug">
                  {c.label}
                </blockquote>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                  {c.cardKind ? <span>{t(`kind.${c.cardKind}`)}</span> : null}
                  <span>{nodeName(sourceOf(c), c.item ?? "")}</span>
                  {c.page ? <span>{t("graph.page", { page: c.page })}</span> : null}
                  <button
                    type="button"
                    onClick={() => onOpen(c)}
                    className="ml-auto text-ink hover:underline"
                  >
                    {t("graph.edge.openCard")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
