import { XMLParser } from "fast-xml-parser";
import { normalizeDoi } from "../identifiers.js";
import {
  cleanText,
  collapseWhitespace,
  compact,
  decodeEntities,
  splitPersonName,
} from "../text.js";
import {
  type Creator,
  type Enrichment,
  type MetadataFields,
  SourceError,
  type SourceRecord,
} from "../types.js";
import { makeRecord, type SourceContext } from "./context.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  isArray: (name) => ["entry", "author", "category", "link"].includes(name),
});

type Node = Record<string, unknown>;

function text(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "object" && v !== null) {
    const t = (v as Node)["#text"];
    return typeof t === "string" ? t : undefined;
  }
  return undefined;
}

/**
 * arXiv API record for an id (without version). The client keeps the API terms: at most one
 * request per three seconds, one connection.
 */
export async function fetchArxiv(
  ctx: SourceContext,
  id: string,
): Promise<SourceRecord | undefined> {
  const url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id).replace(/%2F/gi, "/")}`;
  const res = await ctx.http.get({ source: "arxiv", url, accept: "application/atom+xml" });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new SourceError("arxiv", `HTTP ${res.status} for ${id}`, res.status);
  return parseArxivAtom(res.body, id, res.fetchedAt);
}

export function parseArxivAtom(
  xml: string,
  id: string,
  fetchedAtMs: number,
): SourceRecord | undefined {
  let feed: Node;
  try {
    feed = (parser.parse(xml) as { feed?: Node }).feed ?? {};
  } catch {
    throw new SourceError("arxiv", `response for ${id} is not XML`);
  }
  const entries = (feed.entry ?? []) as Node[];
  const entry = entries[0];
  if (!entry) return undefined;
  const title = text(entry.title);
  // The API reports bad ids as an entry titled "Error".
  if (!title || title.trim() === "Error") return undefined;

  const rawId = text(entry.id) ?? "";
  const versionMatch = /(v\d+)$/.exec(rawId);
  const authors: Creator[] = ((entry.author ?? []) as Node[])
    .map((a) => text(a.name))
    .filter((n): n is string => !!n)
    .map((n) => splitPersonName(n));

  const published = text(entry.published);
  const journalRef = text(entry.journal_ref);
  const publishedDoi = normalizeDoi(text(entry.doi) ?? "");
  const categories = ((entry.category ?? []) as Node[])
    .map((c) => (typeof c["@_term"] === "string" ? c["@_term"] : undefined))
    .filter((c): c is string => !!c);

  const fields = compact<MetadataFields>({
    type: "article",
    title: cleanText(collapseWhitespace(title)),
    author: authors,
    issued: published?.slice(0, 10),
    abstract: text(entry.summary)
      ? collapseWhitespace(decodeEntities(text(entry.summary) ?? ""))
      : undefined,
    publisher: "arXiv",
    URL: `https://arxiv.org/abs/${id}`,
    DOI: `10.48550/arxiv.${id.toLowerCase()}`,
    ids: { arxiv: id },
  });
  const enrichment = compact<Enrichment>({
    journalRef: journalRef ? collapseWhitespace(journalRef) : undefined,
    publishedDoi,
    arxivVersion: versionMatch?.[1],
    arxivCategories: categories,
    openAccess: {
      isOa: true,
      pdfUrl: `https://arxiv.org/pdf/${id}`,
      landingUrl: `https://arxiv.org/abs/${id}`,
    },
  });
  return makeRecord("arxiv", id, fetchedAtMs, fields, enrichment);
}
