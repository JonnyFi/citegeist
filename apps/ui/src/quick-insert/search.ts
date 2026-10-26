import { cardsList, itemsGet, itemsList, searchQuery } from "@citegeist/ops";
import type { z } from "zod";
import type { Core } from "../lib/core";

type Card = z.output<typeof cardsList.output>["cards"][number];
export type SourceItem = z.output<typeof itemsGet.output>["frontmatter"];

/** A row of the palette: a quote card or a whole source. */
export type Citable =
  | {
      type: "card";
      card: Card;
      /** "Luhmann (1984), Soziale Systeme", or just the title when the item has no author. */
      source: string;
    }
  | {
      type: "source";
      item: SourceItem;
      /** Same label as `source` of a card row. */
      label: string;
    };

/** Rows shown at most. The palette is a picker, not a results page. */
export const RESULT_LIMIT = 12;
/** Without a query, cards come first and sources fill the rest. At most this many cards. */
const RECENT_CARDS = 8;
/** Sources looked at to find the newest ones. */
const RECENT_SOURCE_POOL = 30;

/** Stable key of a row, for React and for the active selection. */
export function citableKey(row: Citable): string {
  return row.type === "card" ? row.card.frontmatter.id : `source:${row.item.citekey}`;
}

function familyNames(item: SourceItem): string[] {
  return (item.author ?? []).map((a) => ("family" in a ? a.family : a.literal));
}

/** "Luhmann (1984)", "A & B (2020)", "A et al."; undefined when the item has no author. */
export function sourceCredit(item: SourceItem): string | undefined {
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
  return who ? (year ? `${who} (${year})` : who) : undefined;
}

/** Short author-year-title label, the way a person names a source out loud. */
export function sourceLabel(item: SourceItem): string {
  const head = sourceCredit(item);
  return head ? `${head}, ${item.title}` : item.title;
}

async function loadItem(core: Core, citekey: string): Promise<SourceItem | undefined> {
  try {
    return (await core.call(itemsGet, { citekey })).frontmatter;
  } catch {
    return undefined;
  }
}

function isCard(entry: Card | SourceItem): entry is Card {
  return "frontmatter" in entry;
}

/** Rows for cards and sources, in the given order, each card with the label of its source. */
async function toRows(core: Core, entries: Array<Card | SourceItem>): Promise<Citable[]> {
  const owners = new Map<string, SourceItem>();
  for (const entry of entries) if (!isCard(entry)) owners.set(entry.citekey, entry);
  const missing = new Set<string>();
  for (const entry of entries) {
    if (isCard(entry) && !owners.has(entry.frontmatter.item)) missing.add(entry.frontmatter.item);
  }
  const loaded = await Promise.all(
    [...missing].map(async (citekey) => [citekey, await loadItem(core, citekey)] as const),
  );
  for (const [citekey, item] of loaded) if (item) owners.set(citekey, item);
  return entries.map((entry): Citable => {
    if (!isCard(entry)) return { type: "source", item: entry, label: sourceLabel(entry) };
    const owner = owners.get(entry.frontmatter.item);
    return {
      type: "card",
      card: entry,
      source: owner ? sourceLabel(owner) : entry.frontmatter.item,
    };
  });
}

/**
 * Cards and sources for the palette.
 *
 * A query runs `search.query` over items and cards. A hit carries only a snippet, so the full
 * cards of the hit items come from `cards.list` and the sources from `items.get`; the order of the
 * hits stays. Without a query the newest cards show, followed by the newest sources.
 */
export async function findCitables(core: Core, query: string): Promise<Citable[]> {
  const q = query.trim();
  if (q === "") {
    const [cardList, itemList] = await Promise.all([
      core.call(cardsList, { limit: RECENT_CARDS }),
      core.call(itemsList, { limit: RECENT_SOURCE_POOL }),
    ]);
    const pool = await Promise.all(itemList.items.map((i) => loadItem(core, i.citekey)));
    const newest = pool
      .flatMap((item) => (item ? [item] : []))
      .sort((a, b) => b.created.at.localeCompare(a.created.at))
      .slice(0, Math.max(0, RESULT_LIMIT - cardList.cards.length));
    return toRows(core, [...cardList.cards, ...newest]);
  }
  const { hits } = await core.call(searchQuery, {
    q,
    kinds: ["item", "card"],
    limit: RESULT_LIMIT,
  });
  const keysOf = (kind: "item" | "card") => [
    ...new Set(hits.flatMap((h) => (h.kind === kind && h.citekey ? [h.citekey] : []))),
  ];
  const [lists, sources] = await Promise.all([
    Promise.all(keysOf("card").map((citekey) => core.call(cardsList, { citekey, limit: 200 }))),
    Promise.all(keysOf("item").map((citekey) => loadItem(core, citekey))),
  ]);
  const cardById = new Map(lists.flatMap((l) => l.cards).map((c) => [c.frontmatter.id, c]));
  const sourceByKey = new Map(
    sources.flatMap((item) => (item ? [[item.citekey, item] as const] : [])),
  );
  const entries = hits.flatMap((h): Array<Card | SourceItem> => {
    if (h.kind !== "card" && h.kind !== "item") return [];
    const entry =
      h.kind === "card" ? cardById.get(h.id) : h.citekey ? sourceByKey.get(h.citekey) : undefined;
    return entry ? [entry] : [];
  });
  return toRows(core, entries);
}
