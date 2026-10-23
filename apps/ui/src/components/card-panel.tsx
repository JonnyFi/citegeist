import { Quote } from "lucide-react";
import { useI18n } from "../i18n";
import { type CardJob, isPending } from "../lib/card-jobs";
import { locatorText } from "../lib/format";
import { cn } from "../lib/utils";
import { CardEditor } from "./card-editor";
import type { CardData } from "./card-list";
import { Badge } from "./ui/badge";
import { EmptyState } from "./ui/states";

/**
 * Side panel of the reader: every card of the item, the selected one open for editing. A card that
 * was just created shows its pending state until the AI texts arrive.
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
  const i18n = useI18n();
  const { t } = i18n;

  return (
    <section aria-label={t("panel.title")} className="flex min-h-0 flex-col">
      <h2 className="border-b border-line px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted">
        {t("panel.title")} <span className="tabular-nums">{cards.length}</span>
      </h2>
      {cards.length === 0 ? (
        <EmptyState
          icon={<Quote className="size-5" />}
          title={t("panel.emptyTitle")}
          description={t("panel.emptyDescription")}
        />
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {cards.map((card) => {
            const { frontmatter: fm, body } = card;
            const open = fm.id === selectedId;
            const job = jobs[fm.id];
            return (
              <li
                key={fm.id}
                data-testid="panel-card"
                data-card-id={fm.id}
                className={cn("border-b border-line/70", open && "bg-surface")}
              >
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => onSelect(open ? undefined : fm.id)}
                  className="block w-full px-4 py-3 text-left hover:bg-sunken/60"
                >
                  <span className="mb-1 flex items-center gap-2 text-xs text-muted">
                    <Badge tone="accent">{t(`kind.${fm.kind}`)}</Badge>
                    {locatorText(i18n, fm.locator)}
                    {isPending(job, fm.paraphrase) ? <Badge>{t("card.pendingShort")}</Badge> : null}
                    {orphaned.has(fm.id) ? (
                      <Badge tone="outline" title={t("card.orphanedHint")}>
                        {t("card.orphaned")}
                      </Badge>
                    ) : null}
                  </span>
                  {open ? null : (
                    <span className="line-clamp-3 font-serif text-[14.5px] leading-snug">
                      {body.quote}
                    </span>
                  )}
                </button>
                {open ? (
                  <div className="px-4 pb-4">
                    <CardEditor
                      card={card}
                      job={job}
                      defaultLanguage={defaultLanguage}
                      onJob={onJob}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
