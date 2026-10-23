import type { cardsList } from "@citegeist/ops";
import type { z } from "zod";
import { Badge } from "./ui/badge";

export type CardData = z.output<typeof cardsList.output>["cards"][number];

function locatorText(card: CardData): string | undefined {
  const loc = card.frontmatter.locator;
  if (!loc) return undefined;
  const prefix = loc.label === "page" ? "p." : `${loc.label}`;
  return `${prefix} ${loc.start}${loc.end ? `-${loc.end}` : ""}`;
}

/** Quote cards of one item: verbatim quote first, then the AI text (marked) and the reader's own words. */
export function CardList({ cards }: { cards: readonly CardData[] }) {
  return (
    <ul className="flex flex-col gap-5">
      {cards.map((card) => {
        const { frontmatter: fm, body } = card;
        const locator = locatorText(card);
        return (
          <li
            key={fm.id}
            data-testid="card"
            className="rounded-lg border border-line bg-surface p-4"
          >
            <div className="mb-2 flex items-center gap-2">
              <Badge tone="accent">{fm.kind}</Badge>
              {locator ? <span className="text-xs text-muted">{locator}</span> : null}
            </div>
            <blockquote className="border-l-2 border-accent pl-3 font-serif text-[15.5px] leading-relaxed">
              {body.quote}
            </blockquote>
            {body.core ? (
              <p className="mt-3">
                <span className="font-medium">{body.core}</span>
                {fm.core ? <Badge className="ml-2">AI</Badge> : null}
              </p>
            ) : null}
            {body.paraphrase ? (
              <p className="mt-1 text-muted">
                {body.paraphrase}
                {fm.paraphrase ? <Badge className="ml-2">AI</Badge> : null}
              </p>
            ) : null}
            {body.ownWords ? (
              <p className="mt-3 font-serif">
                <span className="mr-1 text-xs uppercase tracking-wide text-muted">In my words</span>{" "}
                {body.ownWords}
              </p>
            ) : null}
            {body.comment ? (
              <p className="mt-2 text-muted">
                <span className="mr-1 text-xs uppercase tracking-wide">Comment</span> {body.comment}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
