import { cardsList, itemsGet, searchQuery } from "@citegeist/ops";
import type { z } from "zod";
import type { Core } from "../lib/core";

type Card = z.output<typeof cardsList.output>["cards"][number];
type Item = z.output<typeof itemsGet.output>["frontmatter"];

export interface PaletteResult {
  card: Card;
  /** "Luhmann (1984), Soziale Systeme", or just the title when the item has no author. */
  source: string;
}

/** Hits shown at most. The palette is a picker, not a results page. */
export const RESULT_LIMIT = 12;

function familyNames(item: Item): string[] {
  return (item.author ?? []).map((a) => ("family" in a ? a.family : a.literal));
}

/** Short author-year-title label, the way a person names a source out loud. */
export function sourceLabel(item: Item): string {
  const names = familyNames(item);
  const who =
    names.length === 0
      ? undefined
      : names.length === 1
        ? names[0]
        : names.length === 2
          ? `${names[0]} & ${names[1]}`
          : `${names[0]} et al.`;
  const year = item.issued !== undefined ? String(item.issued).slice(0, 4) : undefined;
  const head = who ? (year ? `${who} (${year})` : who) : undefined;
  return head ? `${head}, ${item.title}` : item.title;
}

/**
 * Cards for the palette. A query runs `search.query` over cards and then loads the full cards of
 * the hit items with `cards.list`, because a hit carries only a snippet. Without a query the
 * newest cards show.
 */
export async function findCards(core: Core, query: string): Promise<PaletteResult[]> {
  const q = query.trim();
  let cards: Card[];
  if (q === "") {
    cards = (await core.call(cardsList, { limit: RESULT_LIMIT })).cards;
  } else {
    const { hits } = await core.call(searchQuery, {
      q,
      kinds: ["card"],
      limit: RESULT_LIMIT,
    });
    const citekeys = [...new Set(hits.flatMap((h) => (h.citekey ? [h.citekey] : [])))];
    const lists = await Promise.all(
      citekeys.map((citekey) => core.call(cardsList, { citekey, limit: 200 })),
    );
    const byId = new Map(lists.flatMap((l) => l.cards).map((c) => [c.frontmatter.id, c]));
    cards = hits.flatMap((h) => {
      const card = byId.get(h.id);
      return card ? [card] : [];
    });
  }
  const itemKeys = [...new Set(cards.map((c) => c.frontmatter.item))];
  const items = new Map(
    await Promise.all(
      itemKeys.map(async (citekey) => {
        try {
          const { frontmatter } = await core.call(itemsGet, { citekey });
          return [citekey, frontmatter] as const;
        } catch {
          return [citekey, undefined] as const;
        }
      }),
    ),
  );
  return cards.map((card) => {
    const item = items.get(card.frontmatter.item);
    return { card, source: item ? sourceLabel(item) : card.frontmatter.item };
  });
}
