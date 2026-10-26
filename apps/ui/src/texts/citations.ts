import {
  type CitationInsertKind,
  type CitationProvider,
  type CitationSuggestion,
  type ClusterRef,
  filterCitations,
} from "@citegeist/editor";
import { itemsList } from "@citegeist/ops";
import { useEffect, useMemo, useRef } from "react";
import { useI18n } from "../i18n";
import { renderCitation } from "../lib/citation-insert";
import { locatorText } from "../lib/format";
import { useCore, useOp } from "../lib/hooks";
import { useLibraryLinks } from "../notes/library-links";
import { createChipFormatter, renderWithCore, type StaleChips } from "./chips";

interface Source {
  citekey: string;
  title: string;
  authors?: string | undefined;
  year?: string | undefined;
}

/** A quote card the `@` menu offers: the quote, where it stands and which source it belongs to. */
export interface CardSource {
  id: string;
  citekey: string;
  quote: string;
  /** "S. 31" or "Abs. 4" */
  where?: string | undefined;
}

export interface CitationExtras {
  cards?: Iterable<CardSource>;
  /** Writes a card as Pandoc text of a kind. Without it a card in the menu cannot be inserted. */
  insertCard?: (id: string, kind: CitationInsertKind) => Promise<string>;
  /** The in-text form of a cluster in the style of the text, for the chips. */
  format?: (refs: readonly ClusterRef[]) => string | undefined;
}

const QUOTE_PREVIEW = 160;

function preview(quote: string): string {
  const flat = quote.replace(/\s+/g, " ").trim();
  return flat.length > QUOTE_PREVIEW ? `${flat.slice(0, QUOTE_PREVIEW)}...` : flat;
}

/**
 * Autocomplete and checks for `[@citekey]` over the library: sources and quote cards. Sources of
 * the project come first. Exported for tests.
 */
export function createCitationProvider(
  items: Iterable<Source>,
  projectKeys: ReadonlySet<string>,
  extras: CitationExtras = {},
): CitationProvider {
  const byKey = new Map<string, Source>();
  const all: CitationSuggestion[] = [];
  for (const item of items) {
    byKey.set(item.citekey, item);
    const detail = [item.authors, item.year].filter(Boolean).join(" ");
    all.push({
      key: item.citekey,
      title: item.title,
      ...(detail ? { detail } : {}),
      group: projectKeys.has(item.citekey) ? "project" : "library",
    });
  }
  for (const card of extras.cards ?? []) {
    const owner = byKey.get(card.citekey);
    if (!owner) continue;
    const who = [owner.authors, owner.year].filter(Boolean).join(" ");
    const detail = [who, card.where].filter(Boolean).join(", ");
    all.push({
      kind: "card",
      id: card.id,
      key: card.citekey,
      title: preview(card.quote),
      ...(detail ? { detail } : {}),
      group: projectKeys.has(card.citekey) ? "project" : "library",
    });
  }
  const { insertCard, format } = extras;
  return {
    suggest: (query) => filterCitations(all, query),
    resolve(key) {
      const hit = byKey.get(key);
      return hit ? { title: hit.title } : undefined;
    },
    ...(insertCard ? { insertCard } : {}),
    ...(format ? { format } : {}),
  };
}

/** How a text is cited: the style and locale of its export, and its language for locator terms. */
export interface CitationContext {
  project: string;
  style: string;
  lang: string;
}

/**
 * The citation provider of a text, or undefined while the library index loads. It completes
 * sources and cards, inserts cards in Pandoc syntax of the language of the text and formats the
 * chips in the style of the text. A new style or language gives a new provider, and the editor
 * redraws every chip with it. `onUpdate` fires when chip texts arrive from the core.
 */
export function useCitationProvider(
  context: CitationContext,
  onUpdate: () => void,
): CitationProvider | undefined {
  const { project, style, lang } = context;
  const core = useCore();
  const i18n = useI18n();
  const links = useLibraryLinks();
  const mine = useOp(itemsList, { project, inbox: false, limit: 500 });
  const index = links.index;
  const projectItems = mine.data?.items;
  const update = useRef(onUpdate);
  update.current = onUpdate;
  const stale = useRef<StaleChips>(new Map());
  const uiLang = i18n.lang;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the translator follows the UI language
  const provider = useMemo(() => {
    if (!index) return undefined;
    const formatter = createChipFormatter({
      render: renderWithCore(core),
      style,
      locale: lang,
      onUpdate: () => update.current(),
      stale: stale.current,
    });
    const cards: CardSource[] = [...index.cards.values()].map((c) => ({
      id: c.frontmatter.id,
      citekey: c.frontmatter.item,
      quote: c.body.quote,
      where: locatorText(i18n, c.frontmatter.locator),
    }));
    const made = createCitationProvider(
      index.items.values(),
      new Set(projectItems?.map((i) => i.citekey)),
      {
        cards,
        insertCard: async (id, kind) =>
          (await renderCitation(core, { type: "card", id }, kind, { type: "text", project, lang }))
            .text,
        format: (refs) => formatter.format(refs),
      },
    );
    return { provider: made, formatter };
  }, [index, projectItems, core, project, style, lang, uiLang]);

  useEffect(() => () => provider?.formatter.dispose(), [provider]);
  return provider?.provider;
}
