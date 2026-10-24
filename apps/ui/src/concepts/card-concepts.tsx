import { conceptsList } from "@citegeist/ops";
import { Link } from "@tanstack/react-router";
import { useI18n } from "../i18n";
import { useOp } from "../lib/hooks";

/**
 * The concepts a card belongs to, as links to their pages. Renders nothing when the card belongs
 * to no concept. The list is one cached query shared by every card on the screen.
 */
export function CardConcepts({ cardId }: { cardId: string }) {
  const { t } = useI18n();
  const list = useOp(conceptsList, { limit: 500 });
  const own = (list.data?.concepts ?? []).filter((c) => c.cards.includes(cardId));
  if (own.length === 0) return null;
  return (
    <div
      data-testid="card-concepts"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line-faint px-3 py-2 text-[12px]"
    >
      <span className="text-[11px] text-muted">{t("concepts.cardLink")}</span>
      {own.map((c) => (
        <Link
          key={c.id}
          to="/concepts/$id"
          params={{ id: c.id }}
          aria-label={t("concepts.cardLinkLabel", { title: c.title })}
          className="border border-line-faint px-1.5 py-[1px] hover:bg-sunken"
        >
          {c.title}
        </Link>
      ))}
    </div>
  );
}
