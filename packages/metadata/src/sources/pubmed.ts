import { XMLParser } from "fast-xml-parser";
import { normalizeDoi } from "../identifiers.js";
import { cleanText, compact, normalizeLanguage, normalizeOrcid } from "../text.js";
import {
  type Creator,
  type Enrichment,
  type MetadataFields,
  SourceError,
  type SourceRecord,
} from "../types.js";
import { makeRecord, type SourceContext } from "./context.js";

type Node = Record<string, unknown>;

const BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

// Titles and abstracts carry inline markup (<i>, <sup>): keep their inner XML as a string and
// strip the tags in cleanText.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  stopNodes: ["*.ArticleTitle", "*.AbstractText", "*.VernacularTitle"],
  isArray: (name) =>
    ["PubmedArticle", "Author", "AbstractText", "ArticleId", "PublicationType", "Keyword"].includes(
      name,
    ),
});

/** NCBI asks for `tool` and `email` on every call; both come from the user config. */
export function pubmedUrl(ctx: SourceContext, endpoint: string, params: Record<string, string>) {
  const url = new URL(`${BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("tool", ctx.config.ncbiTool ?? "citegeist");
  if (ctx.config.mailto) url.searchParams.set("email", ctx.config.mailto);
  if (ctx.config.ncbiApiKey) url.searchParams.set("api_key", ctx.config.ncbiApiKey);
  return url.toString();
}

/**
 * PubMed record for a PMID through efetch (one call gives full names, ORCIDs, the abstract with
 * its section labels, the DOI and the publication types). Undefined when PubMed has no such
 * article. Rate limit: 3 requests per second, 10 with a key (see the resolver).
 */
export async function fetchPubmed(
  ctx: SourceContext,
  pmid: string,
): Promise<SourceRecord | undefined> {
  const res = await ctx.http.get({
    source: "ncbi",
    url: pubmedUrl(ctx, "efetch.fcgi", { db: "pubmed", id: pmid, retmode: "xml" }),
    accept: "application/xml",
  });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new SourceError("pubmed", `HTTP ${res.status} for PMID ${pmid}`, res.status);
  return parsePubmedXml(res.body, pmid, res.fetchedAt);
}

function str(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "object" && v !== null) {
    const t = (v as Node)["#text"];
    return typeof t === "string" ? t : undefined;
  }
  return undefined;
}

function list<T = Node>(v: unknown): T[] {
  if (v === undefined || v === null) return [];
  return (Array.isArray(v) ? v : [v]) as T[];
}

const MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

function pubDate(date: Node | undefined): string | undefined {
  if (!date) return undefined;
  const year = str(date.Year) ?? /\b(1[5-9]\d{2}|20\d{2})\b/.exec(str(date.MedlineDate) ?? "")?.[1];
  if (!year) return undefined;
  const monthRaw = str(date.Month)?.toLowerCase().slice(0, 3);
  const month = monthRaw
    ? /^\d+$/.test(monthRaw)
      ? monthRaw.padStart(2, "0")
      : MONTHS[monthRaw]
    : undefined;
  if (!month) return year;
  const day = str(date.Day);
  return day ? `${year}-${month}-${day.padStart(2, "0")}` : `${year}-${month}`;
}

function mapAuthors(authorList: Node | undefined): Creator[] {
  const out: Creator[] = [];
  for (const a of list(authorList?.Author)) {
    const collective = str(a.CollectiveName);
    const family = str(a.LastName);
    if (!family) {
      if (collective) out.push({ literal: cleanText(collective) });
      continue;
    }
    const given = str(a.ForeName) ?? str(a.Initials);
    const orcid = list(a.Identifier)
      .map((i) => ((i as Node)["@_Source"] === "ORCID" ? normalizeOrcid(str(i)) : undefined))
      .find((o) => !!o);
    out.push(
      compact<Creator>({
        family: cleanText(family),
        given: given ? cleanText(given) : undefined,
        orcid,
      }),
    );
  }
  return out;
}

function mapAbstract(abstract: Node | undefined): string | undefined {
  const parts = list(abstract?.AbstractText)
    .map((t) => {
      const text = cleanText(str(t) ?? "");
      if (!text) return undefined;
      const label = typeof t === "object" ? str((t as Node)["@_Label"]) : undefined;
      return label && label.toUpperCase() !== "UNLABELLED" ? `${label}: ${text}` : text;
    })
    .filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

export function parsePubmedXml(
  xml: string,
  pmid: string,
  fetchedAtMs: number,
): SourceRecord | undefined {
  let set: Node;
  try {
    set = (parser.parse(xml) as { PubmedArticleSet?: Node }).PubmedArticleSet ?? {};
  } catch {
    throw new SourceError("pubmed", `response for PMID ${pmid} is not XML`);
  }
  const article = list(set.PubmedArticle)[0];
  if (!article) return undefined;
  const citation = (article.MedlineCitation ?? {}) as Node;
  const art = (citation.Article ?? {}) as Node;
  const journal = (art.Journal ?? {}) as Node;
  const issue = (journal.JournalIssue ?? {}) as Node;
  const title = str(art.ArticleTitle);
  if (!title) return undefined;

  const articleIds = list((article.PubmedData as Node | undefined)?.ArticleIdList)
    .flatMap((l) => list((l as Node).ArticleId))
    .map((i) => ({ type: (i as Node)["@_IdType"], value: str(i) }));
  const idOf = (type: string): string | undefined =>
    articleIds.find((i) => i.type === type)?.value?.trim();
  const eloc = list(art.ELocationID).find((e) => (e as Node)["@_EIdType"] === "doi");
  const doi = normalizeDoi(idOf("doi") ?? str(eloc) ?? "");
  const pmcid = idOf("pmc");

  const types = list((art.PublicationTypeList as Node | undefined)?.PublicationType).map((t) =>
    (str(t) ?? "").toLowerCase(),
  );
  const keywords = list(citation.KeywordList)
    .flatMap((l) => list((l as Node).Keyword))
    .map((k) => cleanText(str(k) ?? ""))
    .filter((k) => k.length > 0);
  const journalTitle = str(journal.Title);
  const language = normalizeLanguage(str(list(art.Language)[0]));

  const fields = compact<MetadataFields>({
    type: "article-journal",
    // PubMed titles end with a full stop; translated ones are wrapped in brackets.
    title: cleanText(title).replace(/\.$/, ""),
    author: mapAuthors(art.AuthorList as Node | undefined),
    issued: pubDate(issue.PubDate as Node | undefined),
    "container-title": journalTitle ? cleanText(journalTitle) : undefined,
    volume: str(issue.Volume),
    issue: str(issue.Issue),
    page: str((art.Pagination as Node | undefined)?.MedlinePgn),
    DOI: doi,
    ISSN: str(journal.ISSN),
    abstract: mapAbstract(art.Abstract as Node | undefined),
    language,
    ids: compact<Record<string, string>>({ pmid: str(citation.PMID) ?? pmid, pmcid }),
  });
  const enrichment = compact<Enrichment>({
    keywords,
    isRetracted: types.includes("retracted publication") ? true : undefined,
  });
  return makeRecord(
    "pubmed",
    fields.ids?.pmid ?? pmid,
    fetchedAtMs,
    fields,
    Object.keys(enrichment).length > 0 ? enrichment : undefined,
  );
}
