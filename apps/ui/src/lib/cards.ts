import type { cardsCreate, cardsList } from "@citegeist/ops";
import type { ReaderHighlight, SelectionAnchors } from "@citegeist/reader";
import { CardColor } from "@citegeist/schema";
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

/** The four highlight colours, in the order of their keys 1 to 4. */
export const HIGHLIGHT_COLORS = CardColor.options;

/** CSS colour of a highlight colour: the solid swatch for dots and card tabs. */
export function highlightColor(color: CardColor): string {
  return `var(--hl-${color})`;
}

/** CSS colour of the marker fill the reader paints over a highlighted passage. */
export function highlightFill(color: CardColor): string {
  return `var(--hl-${color}-fill)`;
}

/**
 * Colour of a card in the head and the legend: its own highlight colour, else the colour of its
 * kind.
 */
export function cardColor(fm: {
  color?: CardColor | undefined;
  kind?: string | undefined;
}): string {
  return fm.color ? highlightColor(fm.color) : kindColor(fm.kind);
}

/**
 * What the reader draws for a card. A card with a highlight colour is a marker filled in that
 * colour, every other card an underline in the colour of its kind.
 */
export function readerHighlight(fm: {
  id: string;
  kind?: string | undefined;
  color?: CardColor | undefined;
  anchor: ReaderHighlight["anchor"];
}): ReaderHighlight {
  return {
    id: fm.id,
    anchor: { pdf: fm.anchor.pdf, text: fm.anchor.text },
    color: fm.color ? highlightFill(fm.color) : kindColor(fm.kind),
    fill: fm.color !== undefined,
  };
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
