/**
 * Types of the citation graph, retraction and version lookups. The resolver implements
 * `GraphLookup`; the core takes it as a dependency so tests can pass a fake.
 */

/** A work in the citation graph, as far as the source tells. */
export interface WorkRef {
  /** Lowercase DOI without prefix. */
  doi?: string;
  /** OpenAlex id, "W123". */
  openalex?: string;
  /** arXiv id without version. */
  arxiv?: string;
  pmid?: string;
  title?: string;
  /** Family names, for example "Harris, Millman, van der Walt". */
  authors?: string;
  year?: number;
  /** Journal, proceedings or book title. */
  container?: string;
  citedBy?: number;
  /** The reference as printed, when nothing better is known. */
  raw?: string;
  /** Key of the entry in refs.jsonl or in the Crossref reference list. */
  key?: string;
}

export interface WorkKey {
  doi?: string;
  openalex?: string;
  arxiv?: string;
}

export interface ReferencePage {
  works: WorkRef[];
  /** Number of references the source lists, before `limit` cut the list. */
  total: number;
  /** OpenAlex id of the work, when the source knows it. */
  openalex?: string;
}

export interface CitingPage {
  works: WorkRef[];
  /** Number of citing works OpenAlex knows. */
  total: number;
  /** Cursor for the next page. */
  next?: string;
  openalex?: string;
}

export type NoticeKind = "retraction" | "withdrawal" | "expression-of-concern" | "correction";

export type NoticeSource = "publisher" | "retraction-watch" | "openalex" | "pubmed";

export interface RetractionNotice {
  kind: NoticeKind;
  /** Label of the notice as the source prints it, for example "Retraction". */
  label?: string;
  /** DOI of the notice, when it has one. */
  doi?: string;
  /** ISO date (YYYY, YYYY-MM or YYYY-MM-DD) of the notice. */
  date?: string;
  source: NoticeSource;
  /** Retraction Watch record id. */
  recordId?: string;
}

export interface RetractionStatus {
  doi: string;
  /** False when neither Crossref nor OpenAlex know the DOI. */
  known: boolean;
  /** Empty for a work without retraction or correction. */
  notices: RetractionNotice[];
  /** The DOI is itself a notice: DOIs of the works it retracts or corrects. */
  noticeFor: string[];
  /** ISO date of the check. */
  checkedAt: string;
}

export type VersionRelation = "preprint-of" | "has-preprint";

/** The other version of a work: `relation` is the role of the queried work. */
export interface VersionLink {
  relation: VersionRelation;
  doi?: string;
  arxiv?: string;
  source: "crossref" | "arxiv" | "openalex";
}

export interface VersionResult {
  links: VersionLink[];
  /** Sources that failed; links from the other sources are still returned. */
  errors: string[];
}

export interface GraphLookup {
  /** References from the Crossref deposit; undefined when Crossref does not know the DOI. */
  crossrefReferences(doi: string, limit: number): Promise<ReferencePage | undefined>;
  /** `referenced_works` of OpenAlex, resolved to titles, DOIs and authors. */
  openAlexReferences(key: WorkKey, limit: number): Promise<ReferencePage | undefined>;
  /** Works that cite the given one, most cited first. */
  openAlexCiting(
    key: WorkKey,
    options: { limit: number; cursor?: string | undefined },
  ): Promise<CitingPage | undefined>;
  /** DOI of an OpenAlex work, when it has one. */
  openAlexDoi(openalex: string): Promise<string | undefined>;
  retractionStatus(doi: string): Promise<RetractionStatus>;
  findVersions(key: { doi?: string; arxiv?: string }): Promise<VersionResult>;
}

const TYPE_FIXES: Array<[RegExp, NoticeKind]> = [
  // Crossref has typos in the wild: "retration", "retracion".
  [/^retra/, "retraction"],
  [/^withdraw/, "withdrawal"],
  [/^expressionofconcern$|^eoc$/, "expression-of-concern"],
  [
    /^(partialretraction|correction|corrections|erratum|errata|corrigendum|addendum)$/,
    "correction",
  ],
];

/** Notice kind of a Crossref update type, or undefined for types that are no notice (new_version). */
export function classifyUpdateType(raw: string | undefined): NoticeKind | undefined {
  const t = raw?.toLowerCase().replace(/[\s_-]+/g, "");
  if (!t) return undefined;
  return TYPE_FIXES.find(([re]) => re.test(t))?.[1];
}
