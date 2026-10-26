/**
 * Citation graph sources (internal metadata-sources research section 11): the reference list
 * Crossref holds for a DOI, and OpenAlex for `referenced_works` and `cited_by`. All requests go
 * through the shared client, so the per-source limits and the response cache apply.
 */

import { asString } from "../csl.js";
import type { CitingPage, ReferencePage, WorkKey, WorkRef } from "../graph-types.js";
import { normalizeDoi } from "../identifiers.js";
import { cleanText, compact } from "../text.js";
import { SourceError } from "../types.js";
import { doiPath, type SourceContext, withMailto } from "./context.js";

type Json = Record<string, unknown>;

const CROSSREF = "https://api.crossref.org";
const OPENALEX = "https://api.openalex.org";

/** Fields of a work in a list: enough to show it and to add it, nothing more. */
export const WORK_SELECT = [
  "id",
  "doi",
  "ids",
  "title",
  "publication_year",
  "authorships",
  "primary_location",
  "cited_by_count",
].join(",");

/** Largest page OpenAlex allows is 200; batches of ids stay far below the URL length limit. */
const ID_BATCH = 100;

export function openAlexUrl(
  ctx: SourceContext,
  path: string,
  params: Record<string, string>,
): string {
  const url = new URL(`${OPENALEX}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (ctx.config.mailto) url.searchParams.set("mailto", ctx.config.mailto);
  if (ctx.config.openalexApiKey) url.searchParams.set("api_key", ctx.config.openalexApiKey);
  return url.toString();
}

export async function openAlexJson(ctx: SourceContext, url: string): Promise<Json | undefined> {
  const res = await ctx.http.get({ source: "openalex", url, accept: "application/json" });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new SourceError("openalex", `HTTP ${res.status}`, res.status);
  try {
    return JSON.parse(res.body) as Json;
  } catch {
    throw new SourceError("openalex", "response is not JSON");
  }
}

export function arxivFromDoi(doi: string): string | undefined {
  return /^10\.48550\/arxiv\.(.+)$/i.exec(doi)?.[1]?.toLowerCase();
}

function yearOf(v: unknown): number | undefined {
  const m = /\d{4}/.exec(asString(v) ?? "");
  return m ? Number(m[0]) : undefined;
}

export function shortId(url: string | undefined): string | undefined {
  return url?.replace(/^https?:\/\/openalex\.org\//, "");
}

// Crossref --------------------------------------------------------------------------------------

/**
 * Reference list deposited with a DOI. Undefined when Crossref does not know the DOI; an empty
 * list when the publisher deposited none (58% of recent articles have one).
 */
export async function fetchCrossrefReferences(
  ctx: SourceContext,
  doi: string,
  limit: number,
): Promise<ReferencePage | undefined> {
  const res = await ctx.http.get({
    source: "crossref",
    url: withMailto(`${CROSSREF}/works/${doiPath(doi)}`, ctx.config),
    accept: "application/json",
  });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new SourceError("crossref", `HTTP ${res.status} for ${doi}`, res.status);
  let message: Json;
  try {
    message = (JSON.parse(res.body) as { message: Json }).message;
  } catch {
    throw new SourceError("crossref", `unexpected response for ${doi}`);
  }
  const refs = Array.isArray(message.reference) ? (message.reference as Json[]) : [];
  return { works: refs.slice(0, limit).map(mapCrossrefReference), total: refs.length };
}

export function mapCrossrefReference(ref: Json): WorkRef {
  const doi = normalizeDoi(asString(ref.DOI) ?? "");
  const articleTitle = asString(ref["article-title"]);
  const volumeTitle = asString(ref["volume-title"]);
  const seriesTitle = asString(ref["series-title"]);
  const journal = asString(ref["journal-title"]);
  const author = asString(ref.author);
  return compact<WorkRef>({
    key: asString(ref.key),
    doi,
    arxiv: doi ? arxivFromDoi(doi) : undefined,
    title: cleanText(articleTitle ?? volumeTitle ?? seriesTitle ?? "") || undefined,
    authors: author ? cleanText(author) : undefined,
    year: yearOf(ref.year),
    container: cleanText(journal ?? (articleTitle ? (volumeTitle ?? "") : "")) || undefined,
    raw: asString(ref.unstructured) ? cleanText(asString(ref.unstructured) ?? "") : undefined,
  });
}

// OpenAlex --------------------------------------------------------------------------------------

/** Maps an OpenAlex work from a `select=WORK_SELECT` request. */
export function mapOpenAlexRef(work: Json): WorkRef {
  const doi = normalizeDoi(asString(work.doi) ?? "");
  const ids = (work.ids ?? {}) as Json;
  const pmid = asString(ids.pmid)?.match(/(\d+)\/?$/)?.[1];
  const names = (Array.isArray(work.authorships) ? (work.authorships as Json[]) : [])
    .map((a) => asString(((a.author ?? {}) as Json).display_name))
    .filter((n): n is string => !!n)
    .map((n) => n.trim().split(/\s+/).pop() ?? n);
  const authors =
    names.length > 4 ? `${names.slice(0, 3).join(", ")} et al.` : names.join(", ") || undefined;
  const source = ((work.primary_location ?? {}) as Json).source as Json | null | undefined;
  const title = asString(work.title);
  return compact<WorkRef>({
    openalex: shortId(asString(work.id)),
    doi,
    arxiv: doi ? arxivFromDoi(doi) : undefined,
    pmid,
    title: title ? cleanText(title) : undefined,
    authors,
    year: typeof work.publication_year === "number" ? work.publication_year : undefined,
    container: asString(source?.display_name),
    citedBy: typeof work.cited_by_count === "number" ? work.cited_by_count : undefined,
  });
}

function singletonPath(key: WorkKey): string | undefined {
  if (key.openalex) return `works/${key.openalex}`;
  if (key.doi) return `works/doi:${doiPath(key.doi)}`;
  if (key.arxiv) return `works/doi:${doiPath(`10.48550/arxiv.${key.arxiv}`)}`;
  return undefined;
}

/** DOI and OpenAlex id of a work, from whichever identifier is known. Singleton lookups are free. */
export async function fetchOpenAlexIds(
  ctx: SourceContext,
  key: WorkKey,
): Promise<{ openalex: string; doi?: string; referenced: string[] } | undefined> {
  const path = singletonPath(key);
  if (!path) return undefined;
  const work = await openAlexJson(
    ctx,
    openAlexUrl(ctx, path, { select: "id,doi,referenced_works" }),
  );
  const openalex = shortId(asString(work?.id));
  if (!work || !openalex) return undefined;
  const referenced = (Array.isArray(work.referenced_works) ? work.referenced_works : [])
    .map((r) => shortId(asString(r)))
    .filter((r): r is string => !!r);
  const doi = normalizeDoi(asString(work.doi) ?? "");
  return { openalex, referenced, ...(doi ? { doi } : {}) };
}

export async function fetchOpenAlexDoi(
  ctx: SourceContext,
  openalex: string,
): Promise<string | undefined> {
  return (await fetchOpenAlexIds(ctx, { openalex }))?.doi;
}

/** `referenced_works` of a work, resolved in batches (one list call per 100 ids). */
export async function fetchOpenAlexReferences(
  ctx: SourceContext,
  key: WorkKey,
  limit: number,
): Promise<ReferencePage | undefined> {
  const head = await fetchOpenAlexIds(ctx, key);
  if (!head) return undefined;
  const wanted = head.referenced.slice(0, limit);
  const byId = new Map<string, WorkRef>();
  for (let i = 0; i < wanted.length; i += ID_BATCH) {
    const batch = wanted.slice(i, i + ID_BATCH);
    const page = await openAlexJson(
      ctx,
      openAlexUrl(ctx, "works", {
        filter: `openalex:${batch.join("|")}`,
        select: WORK_SELECT,
        per_page: String(batch.length),
      }),
    );
    for (const w of Array.isArray(page?.results) ? (page.results as Json[]) : []) {
      const ref = mapOpenAlexRef(w);
      if (ref.openalex) byId.set(ref.openalex, ref);
    }
  }
  // Keep the order of the reference list; an id OpenAlex cannot resolve stays as a bare id.
  const works = wanted.map((id) => byId.get(id) ?? { openalex: id });
  return { works, total: head.referenced.length, openalex: head.openalex };
}

/** Works that cite the given one, most cited first. `cursor` continues a previous page. */
export async function fetchOpenAlexCiting(
  ctx: SourceContext,
  key: WorkKey,
  options: { limit: number; cursor?: string | undefined },
): Promise<CitingPage | undefined> {
  const openalex = key.openalex ?? (await fetchOpenAlexIds(ctx, key))?.openalex;
  if (!openalex) return undefined;
  const page = await openAlexJson(
    ctx,
    openAlexUrl(ctx, "works", {
      filter: `cites:${openalex}`,
      sort: "cited_by_count:desc",
      select: WORK_SELECT,
      per_page: String(Math.min(Math.max(options.limit, 1), 200)),
      cursor: options.cursor ?? "*",
    }),
  );
  if (!page) return undefined;
  const meta = (page.meta ?? {}) as Json;
  const works = (Array.isArray(page.results) ? (page.results as Json[]) : []).map(mapOpenAlexRef);
  const next = asString(meta.next_cursor);
  return {
    works,
    total: typeof meta.count === "number" ? meta.count : works.length,
    openalex,
    ...(next && works.length > 0 ? { next } : {}),
  };
}
