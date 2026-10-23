import type { Location, TextAnchorRecord } from "@citegeist/anchoring";

/** Zotero-compatible PDF anchor, same shape as `CardFrontmatter["anchor"]["pdf"]`. */
export interface PdfAnchorValue {
  /** zero-based page index */
  page: number;
  /** one [x1, y1, x2, y2] rectangle per visual line, PDF user space (y up) */
  quads: Array<[number, number, number, number]>;
  /** source hash of the PDF the quads belong to */
  file: string;
}

/** What a stored card contributes to the reader. Same shape as `CardFrontmatter["anchor"]`. */
export interface HighlightAnchor {
  pdf?: PdfAnchorValue | undefined;
  text?: TextAnchorRecord | undefined;
}

export interface ReaderHighlight {
  id: string;
  anchor: HighlightAnchor;
  /** any CSS color; defaults to a yellow */
  color?: string | undefined;
}

/** Emitted when the user confirms the selection popover. */
export interface SelectionAnchors {
  /** absent when the selection was made in the reflow view */
  pdfAnchor?: PdfAnchorValue | undefined;
  textAnchor: TextAnchorRecord;
  /** normalised wording of the selection, equal to `textAnchor.exact` */
  quote: string;
  /** blocks, page index and printed page label of the selection */
  location: Location;
}

/**
 * How a highlight was placed: `pdf` from stored quads, `text` by re-finding the text anchor,
 * `orphaned` when neither worked (the card needs a manual repair).
 */
export type HighlightStatus = "pdf" | "text" | "orphaned";

export interface LanguageOption {
  value: string;
  label: string;
}
