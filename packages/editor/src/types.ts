import type { ClusterRef } from "./clusters";

export type LinkKind = "item" | "card" | "note";

/** One entry of the wiki-link autocomplete. */
export interface Suggestion {
  /** Text written between the brackets: a citekey, a card id or a note slug. */
  target: string;
  /** Human-readable title shown next to the target. */
  label: string;
  kind: LinkKind;
  /** Short extra line, such as authors and year or the page of a card. */
  detail?: string;
}

/** What a wiki-link target points at, for rendering it as resolved or missing. */
export interface ResolvedLink {
  kind: LinkKind;
  label: string;
}

/** Data for rendering `![[c_...]]` as an inline card. */
export interface CardEmbed {
  id: string;
  quote: string;
  /** Where the quote stands, inserted into the `page` label. An app with several locator terms passes "para. 4" and sets that label to "{page}". */
  page?: string;
  /** Short citation, e.g. "Luhmann 1984" */
  citation?: string;
  /** Card kind label, e.g. "Definition" */
  kind?: string;
  /** The note of the card, shown below the quote. */
  note?: string;
}

export interface OpenLinkEvent {
  target: string;
  anchor?: string;
  embed: boolean;
}

/** Everything the editor needs to know about the library. The host supplies it, the editor never fetches. */
export interface WikiLinkProvider {
  /** Candidates for the text typed after `[[` (or `![[` when `embed`). May be async. */
  suggest(query: string, options: { embed: boolean }): Suggestion[] | Promise<Suggestion[]>;
  /** Synchronous lookup so links can be styled as resolved or missing while typing. */
  resolve(target: string): ResolvedLink | undefined;
  /** Data for an embedded card; omit to render embeds as plain links. */
  card?(id: string): CardEmbed | undefined | Promise<CardEmbed | undefined>;
}

/** What a chosen quote card writes: the quote with its citation, a paraphrase with its citation, or the citation alone. */
export type CitationInsertKind = "direct" | "indirect" | "cite";

/** One entry offered after `@` in a text: a source, or a quote card of a source. */
export interface CitationSuggestion {
  /** The citekey written after `@`. For a card: the citekey of its source. */
  key: string;
  /** The title of the source. For a card: the quote on a single line (the menu truncates it). */
  title: string;
  /** Authors and year, such as "Luhmann 1984". For a card: with the place, "Luhmann 1984, S. 31". */
  detail?: string;
  /** Sources of the open project are listed before the rest of the library. */
  group?: "project" | "library";
  /** A source (default) or a quote card. Cards are listed after the sources. */
  kind?: "source" | "card";
  /** The card id when `kind` is "card". */
  id?: string;
}

/** Everything the editor needs to complete and check Pandoc citations such as `[@key, S. 12]`. */
export interface CitationProvider {
  /** Candidates for the text typed after `@`. May be async. */
  suggest(query: string): CitationSuggestion[] | Promise<CitationSuggestion[]>;
  /** Synchronous lookup so unknown citekeys can be marked while typing. */
  resolve(key: string): { title: string } | undefined;
  /** The finished text to write for a chosen card, already in Pandoc syntax. */
  insertCard?(id: string, kind: CitationInsertKind): Promise<string>;
  /**
   * The in-text form of a citation cluster, such as "(Williams & Srnicek, 2013, Abs. 2)". Return
   * undefined while it is not available; the host calls `editor.refresh()` once it is.
   */
  format?(refs: ClusterRef[]): string | undefined;
}

/** Strings shown inside widgets; the host passes translations. */
export interface EditorLabels {
  frontmatter: string;
  cardLoading: string;
  cardMissing: string;
  openCard: string;
  page: string;
  sectionItem: string;
  sectionNote: string;
  sectionCard: string;
  citationUnknown: string;
  sectionProject: string;
  sectionLibrary: string;
  /** Shown under the selected card in the `@` menu. */
  citationKeysHint: string;
  citationCardFailed: string;
}

export const DEFAULT_LABELS: EditorLabels = {
  frontmatter: "Properties",
  cardLoading: "Loading card",
  cardMissing: "Card not found",
  openCard: "Open card",
  page: "p. {page}",
  sectionItem: "Sources",
  sectionNote: "Notes",
  sectionCard: "Cards",
  citationUnknown: "Unknown citekey",
  sectionProject: "This project",
  sectionLibrary: "Library",
  citationKeysHint: "Enter: verbatim, Shift+Enter: paraphrase, Alt+Enter: citation only",
  citationCardFailed: "The citation could not be inserted",
};
