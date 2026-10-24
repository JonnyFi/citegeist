import { Quote } from "lucide-react";
import { useI18n } from "../i18n";
import type { CardJob } from "../lib/card-jobs";
import { kindColor } from "../lib/cards";
import { QuoteCard } from "./card-editor";
import type { CardData } from "./card-list";
import { EmptyState } from "./ui/states";

/** One coloured square and the word for each card kind in use: the colour is never the only sign. */
function Legend({ cards }: { cards: readonly CardData[] }) {
  const { t } = useI18n();
  const kinds = [...new Set(cards.map((c) => c.frontmatter.kind))];
  return (
    <div
      aria-hidden="true"
      className="flex h-8 shrink-0 items-center gap-3 border-b border-line-soft bg-bg px-4 text-[11px] uppercase tracking-[0.08em] text-muted"
    >
      {kinds.map((kind) => (
        <span key={kind} className="flex items-center gap-1.5">
          <span className="size-2" style={{ background: kindColor(kind) }} />
          {t(`kind.${kind}`)}
        </span>
      ))}
    </div>
  );
}

/**
 * Card column of the reader: every card of the item, the selected one open for editing. A card
 * that was just created shows its pending state until the AI texts arrive.
 */
export function CardPanel({
  cards,
  selectedId,
  onSelect,
  jobs,
  onJob,
  defaultLanguage,
  orphaned,
}: {
  cards: readonly CardData[];
  selectedId: string | undefined;
  onSelect: (id: string | undefined) => void;
  jobs: Readonly<Record<string, CardJob>>;
  onJob: (cardId: string, jobId: string, baseline?: string) => void;
  defaultLanguage: string;
  /** Ids of cards whose highlight could not be placed in the current view. */
  orphaned: ReadonlySet<string>;
}) {
  const { t } = useI18n();

  if (cards.length === 0) {
    return (
      <EmptyState
        icon={<Quote />}
        title={t("panel.emptyTitle")}
        description={t("panel.emptyDescription")}
      />
    );
  }

  return (
    <section aria-label={t("panel.title")} className="flex min-h-0 flex-1 flex-col">
      <Legend cards={cards} />
      <ul className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {cards.map((card) => {
          const id = card.frontmatter.id;
          const open = id === selectedId;
          return (
            <li key={id} data-testid="panel-card" data-card-id={id}>
              <QuoteCard
                card={card}
                mode="panel"
                open={open}
                onToggle={() => onSelect(open ? undefined : id)}
                job={jobs[id]}
                onJob={onJob}
                defaultLanguage={defaultLanguage}
                orphaned={orphaned.has(id)}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
