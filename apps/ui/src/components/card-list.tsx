import type { cardsList } from "@citegeist/ops";
import type { z } from "zod";
import { useI18n } from "../i18n";
import { locatorText } from "../lib/format";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

export type CardData = z.output<typeof cardsList.output>["cards"][number];

/** Quote cards of one item: verbatim quote first, then the AI text (marked) and the reader's own words. */
export function CardList({
  cards,
  onOpen,
}: {
  cards: readonly CardData[];
  /** Opens a card in the reader. */
  onOpen?: (id: string) => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  return (
    <ul className="flex flex-col gap-5">
      {cards.map((card) => {
        const { frontmatter: fm, body } = card;
        const locator = locatorText(i18n, fm.locator);
        return (
          <li
            key={fm.id}
            data-testid="card"
            className="rounded-lg border border-line bg-surface p-4"
          >
            <div className="mb-2 flex items-center gap-2">
              <Badge tone="accent">{t(`kind.${fm.kind}`)}</Badge>
              {locator ? <span className="text-xs text-muted">{locator}</span> : null}
              {onOpen ? (
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onOpen(fm.id)}>
                  {t("card.openInReader")}
                </Button>
              ) : null}
            </div>
            <blockquote className="border-l-2 border-accent pl-3 font-serif text-[15.5px] leading-relaxed">
              {body.quote}
            </blockquote>
            {body.core ? (
              <p className="mt-3">
                <span className="font-medium">{body.core}</span>
                {fm.core ? <Badge className="ml-2">{t("card.ai")}</Badge> : null}
              </p>
            ) : null}
            {body.paraphrase ? (
              <p className="mt-1 text-muted">
                {body.paraphrase}
                {fm.paraphrase ? <Badge className="ml-2">{t("card.ai")}</Badge> : null}
              </p>
            ) : null}
            {body.ownWords ? (
              <p className="mt-3 font-serif">
                <span className="mr-1 text-xs uppercase tracking-wide text-muted">
                  {t("card.ownWords")}
                </span>{" "}
                {body.ownWords}
              </p>
            ) : null}
            {body.comment ? (
              <p className="mt-2 text-muted">
                <span className="mr-1 text-xs uppercase tracking-wide">{t("card.comment")}</span>{" "}
                {body.comment}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
