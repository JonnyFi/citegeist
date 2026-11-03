import type { CardColor } from "@citegeist/schema";
import { Quote } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n";
import type { CardJob } from "../lib/card-jobs";
import { HIGHLIGHT_COLORS, highlightColor, kindColor } from "../lib/cards";
import { cn } from "../lib/utils";
import { QuoteCard } from "./card-editor";
import { CardExport } from "./card-export";
import type { CardData } from "./card-list";
import { Select } from "./ui/select";
import { EmptyState } from "./ui/states";

/**
 * Bar above the card column: one coloured square and the word for each card kind in use (the
 * colour is never the only sign), and the export of all cards at the right.
 */
export function CardColumnBar({
  cards,
  project,
}: {
  cards: readonly CardData[];
  project?: string | undefined;
}) {
  const { t } = useI18n();
  const kinds = [...new Set(cards.map((c) => c.frontmatter.kind))].filter(
    (k): k is NonNullable<typeof k> => k !== undefined,
  );
  return (
    <div className="flex h-8 shrink-0 items-center justify-between gap-3 border-b border-line-soft bg-bg px-4">
      <div
        aria-hidden="true"
        className="flex items-center gap-3 text-[11px] uppercase tracking-[0.08em] text-muted"
      >
        {kinds.map((kind) => (
          <span key={kind} className="flex items-center gap-1.5">
            <span className="size-2" style={{ background: kindColor(kind) }} />
            {t(`kind.${kind}`)}
          </span>
        ))}
      </div>
      <CardExport ids={cards.map((c) => c.frontmatter.id)} project={project} />
    </div>
  );
}

/** What the filter bar of the card column has chosen: some colours and one tag. */
export interface CardFilters {
  colors: ReadonlySet<CardColor>;
  tag: string | undefined;
}

export const NO_FILTERS: CardFilters = { colors: new Set(), tag: undefined };

/** The cards that match every chosen filter: any of the colours, and the tag. */
export function filterCards(cards: readonly CardData[], filters: CardFilters): CardData[] {
  return cards.filter(({ frontmatter: fm }) => {
    if (filters.colors.size > 0 && !(fm.color && filters.colors.has(fm.color))) return false;
    if (filters.tag !== undefined && !fm.tags.includes(filters.tag)) return false;
    return true;
  });
}

/**
 * Filter bar of the card column: one chip for each colour in use and a menu with the tags of the
 * item. It shows only when some card has a colour or a tag.
 */
function CardFilterBar({
  cards,
  filters,
  onChange,
}: {
  cards: readonly CardData[];
  filters: CardFilters;
  onChange: (next: CardFilters) => void;
}) {
  const { t } = useI18n();
  const colorsInUse = HIGHLIGHT_COLORS.filter((c) => cards.some((x) => x.frontmatter.color === c));
  const tags = useMemo(
    () => [...new Set(cards.flatMap((c) => c.frontmatter.tags))].sort((a, b) => a.localeCompare(b)),
    [cards],
  );
  if (colorsInUse.length === 0 && tags.length === 0) return null;
  const active = filters.colors.size > 0 || filters.tag !== undefined;
  return (
    <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft bg-bg px-4 py-1">
      {colorsInUse.length > 0 ? (
        <fieldset className="m-0 flex gap-0.5 border-0 p-0">
          <legend className="sr-only">{t("hl.filterColors")}</legend>
          {colorsInUse.map((color) => {
            const on = filters.colors.has(color);
            const name = t(`hl.color.${color}`);
            return (
              <button
                key={color}
                type="button"
                aria-pressed={on}
                aria-label={name}
                title={name}
                data-testid={`filter-color-${color}`}
                onClick={() => {
                  const colors = new Set(filters.colors);
                  if (on) colors.delete(color);
                  else colors.add(color);
                  onChange({ ...filters, colors });
                }}
                className={cn(
                  "inline-flex size-6 items-center justify-center border hover:bg-sunken",
                  on ? "border-ink" : "border-transparent",
                )}
              >
                <span
                  aria-hidden="true"
                  className="size-3"
                  style={{ background: highlightColor(color) }}
                />
              </button>
            );
          })}
        </fieldset>
      ) : null}
      {tags.length > 0 ? (
        <Select
          label={t("hl.filterTag")}
          value={filters.tag ?? ""}
          onChange={(tag) => onChange({ ...filters, tag: tag === "" ? undefined : tag })}
          options={[
            { value: "", label: t("hl.anyTag") },
            ...tags.map((x) => ({ value: x, label: x })),
          ]}
          active={filters.tag !== undefined}
          className="h-6 min-w-0"
        />
      ) : null}
      {active ? (
        <button
          type="button"
          onClick={() => onChange(NO_FILTERS)}
          className="text-[12px] text-muted underline underline-offset-2 hover:text-ink hover:no-underline"
        >
          {t("hl.resetFilters")}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Card column of the reader: every card of the item, the selected one open for editing. A card
 * that was just created shows its pending state until the AI texts arrive. Cards with a colour or
 * a tag can be filtered.
 */
export function CardPanel({
  cards,
  selectedId,
  onSelect,
  jobs,
  onJob,
  defaultLanguage,
  orphaned,
  noteFocusId,
}: {
  cards: readonly CardData[];
  selectedId: string | undefined;
  onSelect: (id: string | undefined) => void;
  jobs: Readonly<Record<string, CardJob>>;
  onJob: (cardId: string, jobId: string, baseline?: string) => void;
  defaultLanguage: string;
  /** Ids of cards whose highlight could not be placed in the current view. */
  orphaned: ReadonlySet<string>;
  /** The card just marked with a colour: its note field takes the cursor when it opens. */
  noteFocusId?: string | undefined;
}) {
  const { t } = useI18n();
  const [chosen, setFilters] = useState<CardFilters>(NO_FILTERS);
  // a colour or tag that no card has any more (after a delete) does not hide the other cards
  const filters = useMemo<CardFilters>(
    () => ({
      colors: new Set(
        [...chosen.colors].filter((c) => cards.some((x) => x.frontmatter.color === c)),
      ),
      tag:
        chosen.tag !== undefined && cards.some((c) => c.frontmatter.tags.includes(chosen.tag ?? ""))
          ? chosen.tag
          : undefined,
    }),
    [chosen, cards],
  );
  const shown = useMemo(() => filterCards(cards, filters), [cards, filters]);

  // a card marked while a filter hides it would vanish from the panel: show it
  useEffect(() => {
    if (selectedId && !shown.some((c) => c.frontmatter.id === selectedId)) {
      if (cards.some((c) => c.frontmatter.id === selectedId)) setFilters(NO_FILTERS);
    }
  }, [selectedId, shown, cards]);

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
      <CardColumnBar cards={cards} />
      <CardFilterBar cards={cards} filters={filters} onChange={setFilters} />
      <ul className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {shown.length === 0 ? <li className="text-[12px] text-muted">{t("hl.noMatch")}</li> : null}
        {shown.map((card) => {
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
                focusNote={id === noteFocusId}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
