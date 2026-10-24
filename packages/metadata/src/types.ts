import type { Creator, ItemFrontmatter } from "@citegeist/schema";

export type { Creator };

/** The subset of ItemFrontmatter that resolvers can fill. All keys are CSL variable names. */
export type MetadataFields = {
  type?: ItemFrontmatter["type"];
  title?: string;
  subtitle?: string;
  author?: Creator[];
  editor?: Creator[];
  issued?: string | number;
  "container-title"?: string;
  volume?: string;
  issue?: string;
  page?: string;
  publisher?: string;
  "publisher-place"?: string;
  DOI?: string;
  ISBN?: string;
  ISSN?: string;
  URL?: string;
  abstract?: string;
  language?: string;
  edition?: string;
  "collection-title"?: string;
  "number-of-pages"?: string;
  /** Other identifiers: arxiv, openalex, pmid, ... */
  ids?: Record<string, string>;
};

export type FieldName = keyof MetadataFields;

/** Names are lowercase and match the provenance pattern `<source>@YYYY-MM-DD` of the schema. */
export type SourceName =
  | "crossref"
  | "doi.org"
  | "openalex"
  | "pubmed"
  | "unpaywall"
  | "arxiv"
  | "dnb"
  | "k10plus"
  | "openlibrary"
  | "user";

/** Data beyond the item frontmatter that callers may store elsewhere (index, derived files). */
export interface Enrichment {
  /** OpenAlex topics, kept apart from user tags (machine tags). */
  topics?: string[];
  keywords?: string[];
  /** Referenced works as DOIs (lowercase) where known, otherwise OpenAlex ids ("W123"). */
  references?: string[];
  citedByCount?: { value: number; source: SourceName; fetchedAt: string };
  openAccess?: { isOa: boolean; pdfUrl?: string; landingUrl?: string; license?: string };
  isRetracted?: boolean;
  /** arXiv only: the author-supplied journal reference and published DOI. */
  journalRef?: string;
  publishedDoi?: string;
  arxivVersion?: string;
  arxivCategories?: string[];
  /** Table of contents link of a book (DNB). */
  tocUrl?: string;
}

/** One normalised answer of one source. */
export interface SourceRecord {
  source: SourceName;
  /** Source specific id: DOI, arXiv id, OpenAlex work id, ISBN. */
  recordId: string;
  /** ISO date (YYYY-MM-DD). */
  fetchedAt: string;
  fields: MetadataFields;
  enrichment?: Enrichment;
}

export interface MetadataConfig {
  /** Contact address of the user. Sent to Crossref and OpenAlex. Never hard-code one. */
  mailto?: string;
  /** Optional free OpenAlex key. */
  openalexApiKey?: string;
  /** Optional free NCBI key (E-utilities): 10 requests per second instead of 3. */
  ncbiApiKey?: string;
  /** `tool` parameter NCBI asks for with every E-utilities call. Default "citegeist". */
  ncbiTool?: string;
  /** Ask Unpaywall for open-access PDFs (default true). Needs `mailto`: Unpaywall requires an email. */
  unpaywall?: boolean;
  /** Enrich with OpenAlex (default true). */
  openalex?: boolean;
  /** Resolve the published DOI named by an arXiv record (default true). */
  followPublishedDoi?: boolean;
  /** Look up the parent book of a chapter for editors and place (default true). */
  resolveParentBook?: boolean;
  /** Override the ISBN source order. */
  isbnSources?: Array<"dnb" | "k10plus" | "openlibrary">;
  /** Application name and version used in the User-Agent. */
  userAgent?: string;
}

export class SourceError extends Error {
  constructor(
    readonly source: string,
    message: string,
    readonly status?: number,
  ) {
    super(`${source}: ${message}`);
    this.name = "SourceError";
  }
}
