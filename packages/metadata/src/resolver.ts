/**
 * The resolver cascade from docs/research/metadata-sources.md section 12, per input kind.
 * Agents and the MCP server call this, never the remote APIs directly.
 */

import type {
  CitingPage,
  GraphLookup,
  ReferencePage,
  RetractionStatus,
  VersionResult,
  WorkKey,
} from "./graph-types.js";
import {
  DEFAULT_LIMITS,
  type FetchLike,
  type HttpCache,
  HttpClient,
  type RateLimit,
} from "./http.js";
import { detectIdentifier, type Identifier } from "./identifiers.js";
import { type MatchResult, matchTitle, type TitleQuery, titleSimilarity } from "./match.js";
import { type MergeResult, mergeRecords } from "./merge.js";
import { fetchArxiv } from "./sources/arxiv.js";
import {
  fetchCrossrefReferences,
  fetchOpenAlexCiting,
  fetchOpenAlexDoi,
  fetchOpenAlexReferences,
} from "./sources/citations.js";
import type { SourceContext } from "./sources/context.js";
import { fetchCrossrefWork, searchCrossref } from "./sources/crossref.js";
import { fetchDoiCsl } from "./sources/doi-org.js";
import { fetchDnb, fetchK10plus } from "./sources/library-catalogs.js";
import { fetchOpenAlexPdfUrls, fetchOpenAlexWork } from "./sources/openalex.js";
import { fetchOpenLibrary } from "./sources/openlibrary.js";
import { fetchPubmed } from "./sources/pubmed.js";
import { fetchRetractionStatus } from "./sources/retraction.js";
import { fetchUnpaywall } from "./sources/unpaywall.js";
import { findVersions } from "./sources/versions.js";
import { foldForCompare, isoDate } from "./text.js";
import type {
  Enrichment,
  FieldName,
  MetadataConfig,
  MetadataFields,
  SourceRecord,
} from "./types.js";

export interface ResolverOptions {
  config?: MetadataConfig;
  /** Injectable for tests (replayed responses) and for proxies. Default: global fetch. */
  fetch?: FetchLike;
  cache?: HttpCache;
  limits?: Record<string, RateLimit>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface ResolveOptions {
  /** Values the user entered. They win over every source. */
  user?: MetadataFields;
}

export type ResolveStatus = "resolved" | "not-found" | "unsupported";

export interface ResolveResult extends MergeResult {
  status: ResolveStatus;
  identifier?: Identifier;
  /** The source records the merge was computed from, for audit and re-merging. */
  records: SourceRecord[];
  /** Sources that failed (network, HTTP 5xx). A failed enrichment source does not fail the lookup. */
  errors: Array<{ source: string; message: string }>;
}

export interface TitleResolveResult {
  match: MatchResult;
  /** Present when the match was accepted and the DOI resolved. */
  resolved?: ResolveResult;
}

const SAME_WORK_TITLE = 0.85;

export class MetadataResolver implements GraphLookup {
  readonly http: HttpClient;
  private readonly ctx: SourceContext;
  private readonly config: MetadataConfig;

  constructor(options: ResolverOptions = {}) {
    this.config = options.config ?? {};
    const now = options.now ?? Date.now;
    const userAgent = `${this.config.userAgent ?? "citegeist/0.0.0"}${
      this.config.mailto ? ` (mailto:${this.config.mailto})` : ""
    }`;
    // Keys raise the allowance: OpenAlex 30 requests per second, NCBI 10 (docs section 4 and 9).
    const keyed: Record<string, RateLimit> = {
      ...(this.config.openalexApiKey
        ? {
            openalex: { minIntervalMs: 35, concurrency: DEFAULT_LIMITS.openalex?.concurrency ?? 2 },
          }
        : {}),
      ...(this.config.ncbiApiKey ? { ncbi: { minIntervalMs: 110, concurrency: 1 } } : {}),
    };
    this.http = new HttpClient({
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.cache ? { cache: options.cache } : {}),
      limits: { ...keyed, ...options.limits },
      ...(options.sleep ? { sleep: options.sleep } : {}),
      ...(options.random ? { random: options.random } : {}),
      now,
      userAgent,
    });
    this.ctx = { http: this.http, config: this.config, now };
  }

  /** Resolves a DOI, arXiv id, ISBN, PMID or URL (as typed by a user) or a detected identifier. */
  async resolve(input: string | Identifier, options: ResolveOptions = {}): Promise<ResolveResult> {
    const id = typeof input === "string" ? detectIdentifier(input) : input;
    if (!id)
      return this.finish([], undefined, options, "unsupported", [
        { source: "detect", message: `"${String(input)}" is not a DOI, arXiv id, ISBN or PMID` },
      ]);
    const errors: ResolveResult["errors"] = [];
    switch (id.kind) {
      case "doi":
        return this.resolveDoi(id, options, errors);
      case "arxiv":
        return this.resolveArxiv(id, options, errors);
      case "isbn":
        return this.resolveIsbn(id, options, errors);
      case "pmid":
        return this.resolvePmid(id, options, errors);
      default:
        return this.finish([], id, options, "unsupported", [
          { source: id.kind, message: `resolving ${id.kind} identifiers is not implemented` },
        ]);
    }
  }

  /**
   * Finds a DOI for a PDF without identifiers and resolves it, but only when title, first author,
   * year and type all agree (see match.ts). Everything else comes back as "review" or "reject".
   */
  async resolveByTitle(
    query: TitleQuery,
    options: ResolveOptions = {},
  ): Promise<TitleResolveResult> {
    const hits = await searchCrossref(this.ctx, {
      title: query.title,
      ...(query.firstAuthor ? { author: query.firstAuthor } : {}),
      ...(query.year !== undefined ? { year: query.year } : {}),
    });
    const match = matchTitle(
      query,
      hits.map((h) => h.fields),
    );
    const doi = match.accepted?.DOI;
    if (match.verdict !== "accept" || !doi) return { match };
    return { match, resolved: await this.resolve({ kind: "doi", value: doi, raw: doi }, options) };
  }

  private async resolveDoi(
    id: Identifier,
    options: ResolveOptions,
    errors: ResolveResult["errors"],
  ): Promise<ResolveResult> {
    const ra = await this.registrationAgencyRecord(id.value, errors);
    if (!ra) return this.finish([], id, options, "not-found", errors);
    const records: SourceRecord[] = [ra];
    const extras = await Promise.all([
      this.parentBookRecords(ra, errors),
      this.unpaywallRecord(id.value, errors),
      this.openAlexRecord(id.value, errors),
    ]);
    records.push(...extras[0]);
    // Unpaywall before OpenAlex: the first record with open-access data wins the merge, and
    // OpenAlex lists wrong PDF locations now and then (docs section 4).
    if (extras[1]) records.push(extras[1]);
    if (extras[2]) records.push(extras[2]);
    return this.finish(records, id, options, "resolved", errors);
  }

  /** PubMed record first, then the DOI path when PubMed names a DOI (Crossref wins the citation fields). */
  private async resolvePmid(
    id: Identifier,
    options: ResolveOptions,
    errors: ResolveResult["errors"],
  ): Promise<ResolveResult> {
    let pubmed: SourceRecord | undefined;
    try {
      pubmed = await fetchPubmed(this.ctx, id.value);
    } catch (err) {
      errors.push({ source: "pubmed", message: errorMessage(err) });
    }
    if (!pubmed) return this.finish([], id, options, "not-found", errors);
    const doi = pubmed.fields.DOI;
    const records: SourceRecord[] = [];
    if (doi) {
      const ra = await this.registrationAgencyRecord(doi, errors);
      if (ra) records.push(ra);
    }
    records.push(pubmed);
    if (doi) {
      const [unpaywall, openalex] = await Promise.all([
        this.unpaywallRecord(doi, errors),
        this.openAlexRecord(doi, errors),
      ]);
      if (unpaywall) records.push(unpaywall);
      if (openalex) records.push(openalex);
    }
    return this.finish(records, id, options, "resolved", errors);
  }

  private async unpaywallRecord(
    doi: string,
    errors: ResolveResult["errors"],
  ): Promise<SourceRecord | undefined> {
    if (this.config.unpaywall === false || !(this.config.unpaywallEmail ?? this.config.mailto))
      return undefined;
    try {
      return await fetchUnpaywall(this.ctx, doi);
    } catch (err) {
      errors.push({ source: "unpaywall", message: errorMessage(err) });
      return undefined;
    }
  }

  /** Open-access status and PDF url of a DOI. Undefined without a configured email or when Unpaywall does not know it. */
  async findOpenAccess(doi: string): Promise<Enrichment["openAccess"] | undefined> {
    if (this.config.unpaywall === false) return undefined;
    return (await fetchUnpaywall(this.ctx, doi))?.enrichment?.openAccess;
  }

  /** PDF links of all open-access locations OpenAlex lists for a DOI, best first. */
  findOpenAlexPdfs(doi: string): Promise<string[]> {
    return fetchOpenAlexPdfUrls(this.ctx, doi);
  }

  // Citation graph, retractions, versions (GraphLookup) ----------------------------------------

  crossrefReferences(doi: string, limit: number): Promise<ReferencePage | undefined> {
    return fetchCrossrefReferences(this.ctx, doi, limit);
  }

  openAlexReferences(key: WorkKey, limit: number): Promise<ReferencePage | undefined> {
    return fetchOpenAlexReferences(this.ctx, key, limit);
  }

  openAlexCiting(
    key: WorkKey,
    options: { limit: number; cursor?: string | undefined },
  ): Promise<CitingPage | undefined> {
    return fetchOpenAlexCiting(this.ctx, key, options);
  }

  openAlexDoi(openalex: string): Promise<string | undefined> {
    return fetchOpenAlexDoi(this.ctx, openalex);
  }

  retractionStatus(doi: string): Promise<RetractionStatus> {
    return fetchRetractionStatus(this.ctx, doi);
  }

  findVersions(key: { doi?: string; arxiv?: string }): Promise<VersionResult> {
    return findVersions(this.ctx, key);
  }

  private async registrationAgencyRecord(
    doi: string,
    errors: ResolveResult["errors"],
  ): Promise<SourceRecord | undefined> {
    try {
      const crossref = await fetchCrossrefWork(this.ctx, doi);
      if (crossref) return crossref;
    } catch (err) {
      errors.push({ source: "crossref", message: errorMessage(err) });
    }
    try {
      return await fetchDoiCsl(this.ctx, doi);
    } catch (err) {
      errors.push({ source: "doi.org", message: errorMessage(err) });
      return undefined;
    }
  }

  /** Chapters carry no editors. Their Crossref parent (DOI stem) or the catalogue record has them. */
  private async parentBookRecords(
    chapter: SourceRecord,
    errors: ResolveResult["errors"],
  ): Promise<SourceRecord[]> {
    if (this.config.resolveParentBook === false || chapter.fields.type !== "chapter") return [];
    if (chapter.fields.editor?.length) return [];
    const doi = chapter.fields.DOI;
    const stem = doi ? /^(.+?)_\d+(?:-\d+)?$/.exec(doi)?.[1] : undefined;
    const out: SourceRecord[] = [];
    if (stem) {
      try {
        const parent = await fetchCrossrefWork(this.ctx, stem);
        if (parent) out.push(only(parent, ["editor", "publisher-place"]));
      } catch (err) {
        errors.push({ source: "crossref", message: errorMessage(err) });
      }
    }
    if (out.some((r) => r.fields.editor?.length)) return out;
    const isbn = chapter.fields.ISBN;
    if (isbn) {
      for (const fetcher of [fetchK10plus, fetchDnb]) {
        try {
          const book = await fetcher(this.ctx, isbn);
          if (book) out.push(only(book, ["editor", "publisher-place"]));
          if (out.some((r) => r.fields.editor?.length)) break;
        } catch (err) {
          errors.push({ source: "catalogue", message: errorMessage(err) });
        }
      }
    }
    return out;
  }

  private async openAlexRecord(
    doi: string,
    errors: ResolveResult["errors"],
  ): Promise<SourceRecord | undefined> {
    if (this.config.openalex === false) return undefined;
    try {
      return await fetchOpenAlexWork(this.ctx, doi);
    } catch (err) {
      errors.push({ source: "openalex", message: errorMessage(err) });
      return undefined;
    }
  }

  private async resolveArxiv(
    id: Identifier,
    options: ResolveOptions,
    errors: ResolveResult["errors"],
  ): Promise<ResolveResult> {
    let arxiv: SourceRecord | undefined;
    try {
      arxiv = await fetchArxiv(this.ctx, id.value);
    } catch (err) {
      errors.push({ source: "arxiv", message: errorMessage(err) });
    }
    const arxivDoi = `10.48550/arxiv.${id.value.toLowerCase()}`;
    if (!arxiv) {
      const datacite = await this.registrationAgencyRecord(arxivDoi, errors);
      if (!datacite) return this.finish([], id, options, "not-found", errors);
      const oa = await this.openAlexRecord(arxivDoi, errors);
      return this.finish(oa ? [datacite, oa] : [datacite], id, options, "resolved", errors);
    }

    const records: SourceRecord[] = [];
    const publishedDoi = arxiv.enrichment?.publishedDoi;
    let doi = arxivDoi;
    if (publishedDoi && this.config.followPublishedDoi !== false) {
      const published = await this.registrationAgencyRecord(publishedDoi, errors);
      if (published && sameWork(arxiv, published)) {
        records.push(published);
        doi = publishedDoi;
      }
    }
    records.push(arxiv);
    const oa = await this.openAlexRecord(doi, errors);
    if (oa) records.push(oa);
    return this.finish(records, id, options, "resolved", errors);
  }

  private async resolveIsbn(
    id: Identifier,
    options: ResolveOptions,
    errors: ResolveResult["errors"],
  ): Promise<ResolveResult> {
    const isbn = id.value;
    const german = isbn.startsWith("9783");
    const order =
      this.config.isbnSources ??
      (german
        ? (["dnb", "k10plus", "openlibrary"] as const)
        : (["k10plus", "openlibrary"] as const));
    const records: SourceRecord[] = [];
    const lookups = { dnb: fetchDnb, k10plus: fetchK10plus, openlibrary: fetchOpenLibrary };
    for (const source of order.filter((s) => s !== "openlibrary")) {
      try {
        const rec = await lookups[source](this.ctx, isbn);
        if (rec) records.push(rec);
      } catch (err) {
        errors.push({ source, message: errorMessage(err) });
      }
    }
    if (records.length === 0 && order.includes("openlibrary")) {
      try {
        const rec = await fetchOpenLibrary(this.ctx, isbn);
        if (rec) records.push(rec);
      } catch (err) {
        errors.push({ source: "openlibrary", message: errorMessage(err) });
      }
    }
    if (records.length === 0) return this.finish([], id, options, "not-found", errors);
    const doi = records.map((r) => r.fields.DOI).find((d) => d !== undefined);
    if (doi) {
      const oa = await this.openAlexRecord(doi, errors);
      if (oa) records.push(oa);
    }
    return this.finish(records, id, options, "resolved", errors);
  }

  private finish(
    records: SourceRecord[],
    identifier: Identifier | undefined,
    options: ResolveOptions,
    status: ResolveStatus,
    errors: ResolveResult["errors"],
  ): ResolveResult {
    const merged = mergeRecords(records, {
      ...(options.user ? { user: options.user } : {}),
      today: isoDate(this.ctx.now()),
    });
    return {
      ...merged,
      status,
      ...(identifier ? { identifier } : {}),
      records,
      errors,
    };
  }
}

/** A record reduced to the listed fields, used for parent books that must not overwrite the chapter. */
function only(rec: SourceRecord, keep: FieldName[]): SourceRecord {
  const fields: Record<string, unknown> = {};
  for (const k of keep) if (rec.fields[k] !== undefined) fields[k] = rec.fields[k];
  const out: SourceRecord = { ...rec, fields: fields as MetadataFields };
  delete (out as { enrichment?: Enrichment }).enrichment;
  return out;
}

/** The DOI an arXiv record names must describe the same work, else the author-supplied DOI is wrong. */
function sameWork(arxiv: SourceRecord, published: SourceRecord): boolean {
  const a = arxiv.fields;
  const b = published.fields;
  if (!a.title || !b.title) return false;
  if (titleSimilarity(a.title, b.title) < SAME_WORK_TITLE) return false;
  const fa = a.author?.[0];
  const fb = b.author?.[0];
  if (!fa || !fb || !("family" in fa) || !("family" in fb)) return true;
  return foldForCompare(fa.family).split(" ").pop() === foldForCompare(fb.family).split(" ").pop();
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createResolver(options: ResolverOptions = {}): MetadataResolver {
  return new MetadataResolver(options);
}
