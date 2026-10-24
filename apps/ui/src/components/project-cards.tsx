import { cardsList } from "@citegeist/ops";
import type { CardFrontmatter } from "@citegeist/schema";
import { Link, useNavigate } from "@tanstack/react-router";
import { Quote } from "lucide-react";
import { useMemo, useState } from "react";
import { useI18n } from "../i18n";
import { kindColor } from "../lib/cards";
import { useOp } from "../lib/hooks";
import { cn } from "../lib/utils";
import { useLibraryLinks } from "../notes/library-links";
import { QuoteCard } from "./card-editor";
import { CardExport } from "./card-export";
import { EmptyState, ErrorState, Loading } from "./ui/states";

type CardKind = CardFrontmatter["kind"];

/** The "Karten" tab of a project: every card filed under it, filterable by kind, with the export. */
export function ProjectCards({ slug }: { slug: string }) {
  const { t, tn } = useI18n();
  const navigate = useNavigate();
  const cards = useOp(cardsList, { project: slug, limit: 500 });
  const { index } = useLibraryLinks();
  const [kind, setKind] = useState<CardKind | "all">("all");

  const all = useMemo(() => cards.data?.cards ?? [], [cards.data]);
  const kinds = useMemo(() => [...new Set(all.map((c) => c.frontmatter.kind))], [all]);
  const shown = kind === "all" ? all : all.filter((c) => c.frontmatter.kind === kind);

  if (cards.isPending) return <Loading label={t("projectCards.loading")} />;
  if (cards.isError) return <ErrorState error={cards.error} />;
  if (all.length === 0) {
    return (
      <EmptyState
        icon={<Quote />}
        title={t("projectCards.emptyTitle")}
        description={t("projectCards.emptyDescription")}
      />
    );
  }

  const chip = (value: CardKind | "all", label: string, color?: string) => (
    <button
      key={value}
      type="button"
      aria-pressed={kind === value}
      onClick={() => setKind(value)}
      className={cn(
        "flex items-center gap-1.5 border px-2 py-[3px] text-[11px] uppercase tracking-[0.08em]",
        kind === value ? "border-ink bg-ink text-bg" : "border-line text-ink hover:bg-sunken",
      )}
    >
      {color ? <span className="size-2" style={{ background: color }} /> : null}
      {label}
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8 pb-10 pt-6">
      <div className="flex max-w-[680px] flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {chip("all", t("projectCards.all"))}
            {kinds.map((k) => chip(k, t(`kind.${k}`), kindColor(k)))}
          </div>
          <CardExport ids={shown.map((c) => c.frontmatter.id)} project={slug} />
        </div>
        <p className="font-mono text-[12px] text-muted">{tn("projectCards.count", shown.length)}</p>
        <ul aria-label={t("projectCards.list")} className="flex flex-col gap-4">
          {shown.map((card) => {
            const citekey = card.frontmatter.item;
            const item = index?.items.get(citekey);
            return (
              <li
                key={card.frontmatter.id}
                data-testid="project-card"
                className="flex flex-col gap-1.5"
              >
                <Link
                  to="/items/$citekey"
                  params={{ citekey }}
                  className="flex items-baseline gap-2 text-[12px] text-muted hover:text-ink"
                >
                  <span className="font-mono">{citekey}</span>
                  {item ? (
                    <span className="min-w-0 truncate">
                      {[item.authors, item.year].filter(Boolean).join(" ")}
                    </span>
                  ) : null}
                </Link>
                <QuoteCard
                  card={card}
                  mode="list"
                  onOpenInReader={() =>
                    void navigate({
                      to: "/items/$citekey",
                      params: { citekey },
                      search: { tab: "read", card: card.frontmatter.id },
                    })
                  }
                />
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
