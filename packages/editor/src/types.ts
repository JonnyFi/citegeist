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
  /** Printed page or range, e.g. "31 f." */
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
};
