import { asString } from "../csl.js";
import { cleanText, compact, normalizeLanguage, normalizeOrcid, splitPersonName } from "../text.js";
import {
  type Creator,
  type Enrichment,
  type MetadataFields,
  SourceError,
  type SourceRecord,
} from "../types.js";
import { doiPath, makeRecord, type SourceContext } from "./context.js";

type Json = Record<string, unknown>;

const BASE = "https://api.openalex.org";

const SELECT = [
  "id",
  "doi",
  "ids",
  "title",
  "language",
  "authorships",
  "topics",
  "keywords",
  "referenced_works",
  "cited_by_count",
  "abstract_inverted_index",
  "open_access",
  "best_oa_location",
  "is_retracted",
].join(",");

/**
 * OpenAlex work by DOI (singleton lookups are free). Used for enrichment only: the record carries
 * ORCIDs, topics, references and abstracts. DOI, year and type are deliberately not mapped
 * because OpenAlex merges can corrupt them (see docs/research/metadata-sources.md section 4).
 */
export async function fetchOpenAlexWork(
  ctx: SourceContext,
  doi: string,
): Promise<SourceRecord | undefined> {
  const url = new URL(`${BASE}/works/doi:${doiPath(doi)}`);
  url.searchParams.set("select", SELECT);
  if (ctx.config.mailto) url.searchParams.set("mailto", ctx.config.mailto);
  if (ctx.config.openalexApiKey) url.searchParams.set("api_key", ctx.config.openalexApiKey);
  const res = await ctx.http.get({
    source: "openalex",
    url: url.toString(),
    accept: "application/json",
  });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new SourceError("openalex", `HTTP ${res.status} for ${doi}`, res.status);
  let work: Json;
  try {
    work = JSON.parse(res.body) as Json;
  } catch {
    throw new SourceError("openalex", `response for ${doi} is not JSON`);
  }
  const { fields, enrichment } = mapOpenAlexWork(work, res.fetchedAt);
  return makeRecord("openalex", fields.ids?.openalex ?? doi, res.fetchedAt, fields, enrichment);
}

export function mapOpenAlexWork(
  work: Json,
  fetchedAtMs: number,
): { fields: MetadataFields; enrichment: Enrichment } {
  const id = asString(work.id)?.replace(/^https?:\/\/openalex\.org\//, "");
  const ids = (work.ids ?? {}) as Json;
  const pmid = asString(ids.pmid)?.match(/(\d+)\/?$/)?.[1];
  const pmcid = asString(ids.pmcid)?.match(/(PMC\d+)\/?$/i)?.[1];
  const title = asString(work.title);

  const fields = compact<MetadataFields>({
    title: title ? cleanText(title) : undefined,
    author: mapAuthorships(work.authorships),
    abstract: rebuildAbstract(work.abstract_inverted_index),
    language: normalizeLanguage(asString(work.language)),
    ids: compact<Record<string, string>>({
      openalex: id,
      pmid,
      pmcid,
    }),
  });

  const topics = Array.isArray(work.topics)
    ? (work.topics as Json[])
        .map((t) => asString(t.display_name))
        .filter((t): t is string => !!t)
        .slice(0, 10)
    : [];
  const keywords = Array.isArray(work.keywords)
    ? (work.keywords as Json[]).map((k) => asString(k.display_name)).filter((k): k is string => !!k)
    : [];
  const references = Array.isArray(work.referenced_works)
    ? (work.referenced_works as unknown[])
        .map((r) => asString(r)?.replace(/^https?:\/\/openalex\.org\//, ""))
        .filter((r): r is string => !!r)
    : [];
  const oa = (work.open_access ?? undefined) as Json | undefined;
  const best = (work.best_oa_location ?? undefined) as Json | undefined;

  const enrichment: Enrichment = compact<Enrichment>({
    topics,
    keywords,
    references,
    citedByCount:
      typeof work.cited_by_count === "number"
        ? {
            value: work.cited_by_count,
            source: "openalex",
            fetchedAt: new Date(fetchedAtMs).toISOString().slice(0, 10),
          }
        : undefined,
    openAccess: oa
      ? compact({
          isOa: oa.is_oa === true,
          pdfUrl: asString(best?.pdf_url),
          landingUrl: asString(best?.landing_page_url),
          license: asString(best?.license),
        })
      : undefined,
    isRetracted: work.is_retracted === true ? true : undefined,
  });
  return { fields, enrichment };
}

function mapAuthorships(v: unknown): Creator[] {
  if (!Array.isArray(v)) return [];
  const out: Creator[] = [];
  for (const a of v as Json[]) {
    const author = (a.author ?? {}) as Json;
    const name = asString(author.display_name);
    if (!name) continue;
    const split = splitPersonName(name);
    const orcid = normalizeOrcid(asString(author.orcid));
    out.push(orcid && "family" in split ? { ...split, orcid } : split);
  }
  return out;
}

/** OpenAlex ships abstracts as {word: [positions]}. */
export function rebuildAbstract(index: unknown): string | undefined {
  if (typeof index !== "object" || index === null) return undefined;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index as Record<string, unknown>)) {
    if (!Array.isArray(positions)) continue;
    for (const p of positions) if (typeof p === "number") words[p] = word;
  }
  const text = words.filter((w) => w !== undefined).join(" ");
  return text.length > 0 ? text : undefined;
}
