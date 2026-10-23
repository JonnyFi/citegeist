import { asString, mapCslLike } from "../csl.js";
import { compact } from "../text.js";
import { type Enrichment, type MetadataFields, SourceError, type SourceRecord } from "../types.js";
import { doiPath, makeRecord, type SourceContext, withMailto } from "./context.js";

type Json = Record<string, unknown>;

const BASE = "https://api.crossref.org";

/** Crossref work record for a DOI, or undefined when Crossref does not know the DOI (404). */
export async function fetchCrossrefWork(
  ctx: SourceContext,
  doi: string,
): Promise<SourceRecord | undefined> {
  const res = await ctx.http.get({
    source: "crossref",
    url: withMailto(`${BASE}/works/${doiPath(doi)}`, ctx.config),
    accept: "application/json",
  });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new SourceError("crossref", `HTTP ${res.status} for ${doi}`, res.status);
  const message = parseMessage(res.body);
  if (!message) throw new SourceError("crossref", `unexpected response for ${doi}`);
  const fields = mapCslLike(message);
  const enrichment = crossrefEnrichment(message);
  return makeRecord("crossref", fields.DOI ?? doi, res.fetchedAt, fields, enrichment);
}

function parseMessage(body: string): Json | undefined {
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    return typeof parsed.message === "object" && parsed.message !== null
      ? (parsed.message as Json)
      : undefined;
  } catch {
    return undefined;
  }
}

function crossrefEnrichment(message: Json): Enrichment {
  const updatedBy = message["updated-by"];
  let isRetracted: boolean | undefined;
  if (Array.isArray(updatedBy)) {
    isRetracted = updatedBy.some(
      (u) =>
        typeof u === "object" && u !== null && /retract/i.test(asString((u as Json).type) ?? ""),
    )
      ? true
      : undefined;
  }
  return compact({ isRetracted });
}

export interface CrossrefQuery {
  title: string;
  author?: string;
  year?: number;
  rows?: number;
}

export interface CrossrefCandidate {
  fields: MetadataFields;
  /** Crossref relevance score. Unnormalised: never use it as acceptance criterion. */
  score: number;
}

const SELECT = [
  "DOI",
  "type",
  "title",
  "subtitle",
  "author",
  "editor",
  "issued",
  "published",
  "container-title",
  "publisher",
  "volume",
  "issue",
  "page",
  "ISBN",
  "ISSN",
  "score",
].join(",");

/** `query.bibliographic` search. Returns candidates; deciding which one is right is the matcher's job. */
export async function searchCrossref(
  ctx: SourceContext,
  q: CrossrefQuery,
): Promise<CrossrefCandidate[]> {
  const text = [q.title, q.author, q.year].filter((p) => p !== undefined && p !== "").join(" ");
  const url = new URL(`${BASE}/works`);
  url.searchParams.set("query.bibliographic", text);
  url.searchParams.set("rows", String(q.rows ?? 5));
  url.searchParams.set("select", SELECT);
  const res = await ctx.http.get({
    source: "crossref-list",
    url: withMailto(url.toString(), ctx.config),
    accept: "application/json",
  });
  if (!res.ok) throw new SourceError("crossref", `HTTP ${res.status} for search`, res.status);
  let items: unknown;
  try {
    items = (JSON.parse(res.body) as { message?: { items?: unknown } }).message?.items;
  } catch {
    throw new SourceError("crossref", "unexpected search response");
  }
  if (!Array.isArray(items)) return [];
  return items
    .filter((i): i is Json => typeof i === "object" && i !== null)
    .map((i) => ({ fields: mapCslLike(i), score: typeof i.score === "number" ? i.score : 0 }));
}
