/**
 * Sources of alerts: the newest works of an arXiv category or query (arXiv API) and of an OpenAlex
 * topic, search, author or citing relation. All requests go through the shared client, so the
 * per-source limits and the response cache apply. Alerts ask for newest first and cut at `since`.
 */

import { XMLParser } from "fast-xml-parser";
import type { AlertQuery, AlertWork } from "../alert-types.js";
import type { WorkRef } from "../graph-types.js";
import { normalizeDoi } from "../identifiers.js";
import { cleanText, collapseWhitespace, compact, decodeEntities, normalizeOrcid } from "../text.js";
import { SourceError } from "../types.js";
import {
  fetchOpenAlexIds,
  mapOpenAlexRef,
  openAlexJson,
  openAlexUrl,
  WORK_SELECT,
} from "./citations.js";
import type { SourceContext } from "./context.js";
import { rebuildAbstract } from "./openalex.js";

type Node = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  isArray: (name) => ["entry", "author", "category"].includes(name),
});

/** Largest page the arXiv API serves in one request that stays fast. */
const ARXIV_PAGE = 100;

function text(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "object" && v !== null) {
    const t = (v as Node)["#text"];
    return typeof t === "string" ? t : undefined;
  }
  return undefined;
}

const FIELD_PREFIX = /(?:^|[\s(])(?:all|ti|au|abs|co|jr|cat|rn|id):/;

/** The `search_query` of the arXiv API. A query without a field prefix searches all fields. */
export function arxivSearchQuery(query: AlertQuery): string {
  if (query.kind === "arxiv-category") return `cat:${query.category.trim()}`;
  if (query.kind !== "arxiv-query") throw new Error(`${query.kind} is no arXiv query`);
  const q = query.query.trim();
  return FIELD_PREFIX.test(q) ? q : `all:${q}`;
}

/** Last name of the author as the graph shows it ("Ada Lovelace" becomes "Lovelace"). */
function family(name: string): string {
  const n = name.trim();
  return n.includes(",") ? (n.split(",")[0] ?? n).trim() : (n.split(/\s+/).pop() ?? n);
}

/** Family names as the graph shows them: first three, then "et al." from five authors on. */
function authorLine(names: string[]): string | undefined {
  const families = names.map(family).filter((n) => n !== "");
  if (families.length === 0) return undefined;
  return families.length > 4 ? `${families.slice(0, 3).join(", ")} et al.` : families.join(", ");
}

/** Parses an Atom feed of the arXiv API. Entries older than `since` are dropped. */
export function parseArxivFeed(xml: string, since: string): AlertWork[] {
  let feed: Node;
  try {
    feed = (parser.parse(xml) as { feed?: Node }).feed ?? {};
  } catch {
    throw new SourceError("arxiv", "response is not XML");
  }
  const out: AlertWork[] = [];
  for (const entry of (feed.entry ?? []) as Node[]) {
    const title = text(entry.title);
    // The API reports a bad query as an entry titled "Error".
    if (!title || title.trim() === "Error") continue;
    const id = (text(entry.id) ?? "")
      .replace(/^https?:\/\/arxiv\.org\/abs\//, "")
      .replace(/v\d+$/, "")
      .toLowerCase();
    if (!id) continue;
    const published = text(entry.published)?.slice(0, 10);
    if (published && published < since) continue;
    const names = ((entry.author ?? []) as Node[])
      .map((a) => text(a.name))
      .filter((n): n is string => !!n);
    const summary = text(entry.summary);
    const year = published ? Number(published.slice(0, 4)) : undefined;
    out.push(
      compact<AlertWork>({
        arxiv: id,
        doi: normalizeDoi(text(entry.doi) ?? ""),
        title: cleanText(collapseWhitespace(title)),
        authors: authorLine(names),
        year: year !== undefined && Number.isInteger(year) ? year : undefined,
        container: "arXiv",
        abstract: summary ? collapseWhitespace(decodeEntities(summary)) : undefined,
        published,
      }),
    );
  }
  return out;
}

async function arxivWorks(ctx: SourceContext, query: AlertQuery): Promise<AlertWork[]> {
  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("search_query", arxivSearchQuery(query));
  url.searchParams.set("sortBy", "submittedDate");
  url.searchParams.set("sortOrder", "descending");
  url.searchParams.set("max_results", String(Math.min(Math.max(query.limit, 1), ARXIV_PAGE)));
  const res = await ctx.http.get({
    source: "arxiv",
    url: url.toString(),
    accept: "application/atom+xml",
    // A feed that is a day old is worth nothing to a daily alert.
    ttlMs: 60 * 60 * 1000,
  });
  if (!res.ok) throw new SourceError("arxiv", `HTTP ${res.status}`, res.status);
  return parseArxivFeed(res.body, query.since).slice(0, query.limit);
}

/** The id of an OpenAlex topic: "T10181" or the URL https://openalex.org/T10181. */
export function openAlexTopicId(value: string): string | undefined {
  return /(?:^|\/)(T\d+)\/?$/i.exec(value.trim())?.[1]?.toUpperCase();
}

/** The OpenAlex filter that picks an author by OpenAlex id (A123) or ORCID. */
export function openAlexAuthorFilter(value: string): string | undefined {
  const v = value.trim();
  const id = /(?:^|\/)(A\d+)\/?$/i.exec(v)?.[1];
  if (id) return `author.id:${id.toUpperCase()}`;
  const orcid = normalizeOrcid(v);
  return orcid ? `author.orcid:${orcid}` : undefined;
}

function mapAlertWork(work: Node): AlertWork {
  const ref: WorkRef = mapOpenAlexRef(work);
  const abstract = rebuildAbstract(work.abstract_inverted_index);
  const published = typeof work.publication_date === "string" ? work.publication_date : undefined;
  return compact<AlertWork>({ ...ref, abstract, published });
}

async function openAlexWorks(ctx: SourceContext, query: AlertQuery): Promise<AlertWork[]> {
  const filters = [`from_publication_date:${query.since}`];
  const params: Record<string, string> = {};
  switch (query.kind) {
    case "openalex-topic": {
      const id = openAlexTopicId(query.topic);
      if (!id) throw new SourceError("openalex", `"${query.topic}" is no OpenAlex topic id`);
      filters.push(`topics.id:${id}`);
      break;
    }
    case "openalex-search":
      params.search = query.query.trim();
      break;
    case "author": {
      const filter = openAlexAuthorFilter(query.author);
      if (!filter) {
        throw new SourceError("openalex", `"${query.author}" is no ORCID or OpenAlex author id`);
      }
      filters.push(filter);
      break;
    }
    case "cites": {
      const openalex = query.key.openalex ?? (await fetchOpenAlexIds(ctx, query.key))?.openalex;
      if (!openalex) return [];
      filters.push(`cites:${openalex}`);
      break;
    }
    default:
      throw new Error(`${query.kind} is no OpenAlex query`);
  }
  const page = await openAlexJson(
    ctx,
    openAlexUrl(ctx, "works", {
      ...params,
      filter: filters.join(","),
      sort: "publication_date:desc",
      select: `${WORK_SELECT},publication_date,abstract_inverted_index`,
      per_page: String(Math.min(Math.max(query.limit, 1), 200)),
    }),
  );
  const results = Array.isArray(page?.results) ? (page.results as Node[]) : [];
  return results.map(mapAlertWork).slice(0, query.limit);
}

/** The newest works of one alert source, newest first. */
export async function fetchAlertWorks(ctx: SourceContext, query: AlertQuery): Promise<AlertWork[]> {
  return query.kind === "arxiv-category" || query.kind === "arxiv-query"
    ? arxivWorks(ctx, query)
    : openAlexWorks(ctx, query);
}
