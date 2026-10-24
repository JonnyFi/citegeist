import type { cardsCreate, cardsList } from "@citegeist/ops";
import type { SelectionAnchors } from "@citegeist/reader";
import type { z } from "zod";

/** The cards.list input of an item page. The item view and the reader share it, so they share the cache entry. */
export function itemCardsInput(citekey: string) {
  return { citekey, limit: 200 } as const;
}

export type CardsListOutput = z.output<typeof cardsList.output>;
type CardAnchor = z.input<typeof cardsCreate.input>["anchor"];

/**
 * CSS colour of a card kind, from the theme tokens, so it follows light and dark. A card without a
 * kind has the neutral colour.
 */
export function kindColor(kind: string | undefined): string {
  return `var(--card-${kind ?? "none"})`;
}

/** cards.create anchor from what the reader reports for a selection; drops undefined fields. */
export function anchorFromSelection(sel: SelectionAnchors): CardAnchor {
  const t = sel.textAnchor;
  return {
    ...(sel.pdfAnchor ? { pdf: sel.pdfAnchor } : {}),
    text: {
      exact: t.exact,
      prefix: t.prefix,
      suffix: t.suffix,
      ...(t.block !== undefined ? { block: t.block } : {}),
      ...(t.start !== undefined ? { start: t.start } : {}),
      ...(t.end !== undefined ? { end: t.end } : {}),
    },
  };
}
