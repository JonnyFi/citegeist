import type { cardsList } from "@citegeist/ops";
import type { z } from "zod";
import { QuoteCard } from "./card-editor";

export type CardData = z.output<typeof cardsList.output>["cards"][number];

/** Quote cards of one item for the card column of the overview: read-only, one per card. */
export function CardList({
  cards,
  onOpen,
}: {
  cards: readonly CardData[];
  /** Opens a card in the reader. */
  onOpen?: (id: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-3 p-3">
      {cards.map((card) => (
        <li key={card.frontmatter.id}>
          <QuoteCard
            card={card}
            mode="list"
            {...(onOpen ? { onOpenInReader: () => onOpen(card.frontmatter.id) } : {})}
          />
        </li>
      ))}
    </ul>
  );
}
