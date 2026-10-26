import {
  type CardEmbed,
  filterSuggestions,
  type ResolvedLink,
  type Suggestion,
  type WikiLinkProvider,
} from "@citegeist/editor";
import { cardsList, itemsList, notesList } from "@citegeist/ops";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Translator } from "../i18n";
import { useI18n } from "../i18n";
import type { Core } from "../lib/core";
import { locatorText } from "../lib/format";
import { useCore } from "../lib/hooks";

type ItemSummary = Awaited<ReturnType<typeof loadItems>>[number];
type CardData = Awaited<ReturnType<typeof loadCards>>[number];
type NoteSummary = Awaited<ReturnType<typeof loadNotes>>[number];

const PAGE = 500;
const MAX_PAGES = 20;

async function loadItems(core: Core) {
  const out = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await core.call(itemsList, { limit: PAGE, ...(cursor ? { cursor } : {}) });
    out.push(...res.items);
    cursor = res.next;
    if (!cursor) break;
  }
  return out;
}

async function loadCards(core: Core) {
  const out = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await core.call(cardsList, { limit: PAGE, ...(cursor ? { cursor } : {}) });
    out.push(...res.cards);
    cursor = res.next;
    if (!cursor) break;
  }
  return out;
}

async function loadNotes(core: Core) {
  return (await core.call(notesList, { limit: PAGE })).notes;
}

/** Everything a wiki link can point at, loaded once per library change. */
export interface LinkIndex {
  items: Map<string, ItemSummary>;
  cards: Map<string, CardData>;
  /** By slug and by id. */
  notes: Map<string, NoteSummary>;
}

export type LinkTarget =
  | { kind: "item"; citekey: string }
  | { kind: "card"; id: string; citekey: string }
  | { kind: "note"; id: string };

export function resolveTarget(index: LinkIndex, target: string): LinkTarget | undefined {
  if (index.items.has(target)) return { kind: "item", citekey: target };
  const card = index.cards.get(target);
  if (card) return { kind: "card", id: target, citekey: card.frontmatter.item };
  const note = index.notes.get(target);
  if (note) return { kind: "note", id: note.id };
  return undefined;
}

function citation(item: ItemSummary | undefined): string | undefined {
  if (!item) return undefined;
  const parts = [item.authors, item.year].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/** "S. 31" or "Abs. 4": the locator of a card with its term. */
function pageOf(card: CardData, tr: Translator): string | undefined {
  return locatorText(tr, card.frontmatter.locator);
}

/** Builds the editor's provider over a loaded library index. Exported for tests. */
export function createProvider(index: LinkIndex, tr: Translator): WikiLinkProvider {
  const items: Suggestion[] = [...index.items.values()].map((i) => ({
    kind: "item",
    target: i.citekey,
    label: i.title,
    ...(citation(i) ? { detail: citation(i) as string } : {}),
  }));
  const seenNotes = new Set<string>();
  const notes: Suggestion[] = [];
  for (const n of index.notes.values()) {
    if (seenNotes.has(n.id)) continue;
    seenNotes.add(n.id);
    notes.push({ kind: "note", target: n.slug, label: n.title });
  }
  const cards: Suggestion[] = [...index.cards.values()].map((c) => {
    const page = pageOf(c, tr);
    const owner = citation(index.items.get(c.frontmatter.item));
    return {
      kind: "card",
      target: c.frontmatter.id,
      label: c.body.quote.replace(/\s+/g, " ").slice(0, 90),
      detail: [owner, page].filter(Boolean).join(", "),
    };
  });

  return {
    suggest(query, { embed }) {
      return filterSuggestions(embed ? cards : [...items, ...notes, ...cards], query);
    },
    resolve(target): ResolvedLink | undefined {
      const item = index.items.get(target);
      if (item) return { kind: "item", label: item.title };
      const card = index.cards.get(target);
      if (card) return { kind: "card", label: card.body.quote.slice(0, 90) };
      const note = index.notes.get(target);
      if (note) return { kind: "note", label: note.title };
      return undefined;
    },
    card(id): CardEmbed | undefined {
      const card = index.cards.get(id);
      if (!card) return undefined;
      const owner = citation(index.items.get(card.frontmatter.item));
      const page = pageOf(card, tr);
      return {
        id,
        quote: card.body.quote,
        ...(page ? { page } : {}),
        ...(owner ? { citation: owner } : {}),
        ...(card.frontmatter.kind ? { kind: tr.t(`kind.${card.frontmatter.kind}`) } : {}),
        ...(card.body.note ? { note: card.body.note } : {}),
      };
    },
  };
}

/** Loads every item, card and note once; the editor resolves and suggests from this snapshot. */
export async function buildLinkIndex(core: Core): Promise<LinkIndex> {
  const [items, cards, notes] = await Promise.all([
    loadItems(core),
    loadCards(core),
    loadNotes(core),
  ]);
  const noteMap = new Map<string, NoteSummary>();
  for (const n of notes) {
    noteMap.set(n.slug, n);
    noteMap.set(n.id, n);
  }
  return {
    items: new Map(items.map((i) => [i.citekey, i])),
    cards: new Map(cards.map((c) => [c.frontmatter.id, c])),
    notes: noteMap,
  };
}

/**
 * Items, cards and notes of the library as a wiki-link provider for the editor. Reloads when the
 * library changes (the core provider invalidates every "op" query on change events).
 */
export function useLibraryLinks(): {
  index: LinkIndex | undefined;
  provider: WikiLinkProvider | undefined;
} {
  const core = useCore();
  const i18n = useI18n();
  const query = useQuery({
    queryKey: ["op", "notes.linkIndex"],
    queryFn: () => buildLinkIndex(core),
  });
  const index = query.data;
  const lang = i18n.lang;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the translator follows the language
  const provider = useMemo(() => (index ? createProvider(index, i18n) : undefined), [index, lang]);
  return { index, provider };
}
