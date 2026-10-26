/**
 * Metadata of a web page: identifiers it names and the bibliographic fields it carries.
 *
 * The order of trust is fixed. An explicit identifier (DOI, ISBN, arXiv id, PMID) wins, because
 * the normal resolvers know more than any page does. Without one, the fields come from Highwire
 * `citation_*` tags, then Dublin Core, then JSON-LD (ScholarlyArticle, Book, Article,
 * CreativeWork), then `og:` and `article:` tags, then the `<title>`. Each field takes the first
 * tier that has it.
 *
 * Pages are read with regular expressions, not a DOM: the tags that matter sit in the head, and
 * a page that is broken HTML still gives what it has.
 */

import {
  detectIdentifier,
  type Identifier,
  normalizeArxivId,
  normalizeDoi,
  normalizeIsbn,
} from "./identifiers.js";
import { decodeEntities, foldForCompare, splitPersonName } from "./text.js";
import type { Creator, MetadataFields } from "./types.js";

export type PageTier = "highwire" | "dublin-core" | "json-ld" | "opengraph" | "html";

export interface PageMetadata {
  /** Identifiers the page names for itself, best first: DOI, ISBN, arXiv id, PMID. */
  identifiers: Identifier[];
  /** Bibliographic fields read from the page. Empty when the page carries none. */
  fields: MetadataFields;
  /** Which tier each field in `fields` came from. */
  tiers: Partial<Record<keyof MetadataFields, PageTier>>;
  /** True when the page is a bot challenge or access wall and not the page that was asked for. */
  challenge: boolean;
}

interface Tags {
  /** Lowercase name or property to the values in document order. */
  meta: Map<string, string[]>;
  /** href of every `<link>` tag. */
  links: string[];
}

const MAX_SCAN = 1_500_000;

function attributes(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  for (let m = re.exec(tag); m; m = re.exec(tag)) {
    const name = (m[1] ?? "").toLowerCase();
    if (!out.has(name)) out.set(name, decodeEntities(m[2] ?? m[3] ?? m[4] ?? "").trim());
  }
  return out;
}

function readTags(html: string): Tags {
  const meta = new Map<string, string[]>();
  const links: string[] = [];
  const scan = html.length > MAX_SCAN ? html.slice(0, MAX_SCAN) : html;
  for (const tag of scan.match(/<meta\b[^>]*>/gi) ?? []) {
    const a = attributes(tag);
    const key = (a.get("name") ?? a.get("property") ?? a.get("itemprop") ?? "").toLowerCase();
    const content = a.get("content");
    if (!key || content === undefined || content === "") continue;
    const list = meta.get(key) ?? [];
    list.push(content);
    meta.set(key, list);
  }
  for (const tag of scan.match(/<link\b[^>]*>/gi) ?? []) {
    const href = attributes(tag).get("href");
    if (href) links.push(href);
  }
  return { meta, links };
}

function first(tags: Tags, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = tags.meta.get(n)?.find((s) => s.trim() !== "");
    if (v) return clean(v);
  }
  return undefined;
}

function all(tags: Tags, ...names: string[]): string[] {
  const out: string[] = [];
  for (const n of names) for (const v of tags.meta.get(n) ?? []) if (v.trim()) out.push(clean(v));
  return out;
}

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// Challenge pages -------------------------------------------------------------------------------

const CHALLENGE_TITLE =
  /^(just a moment|attention required|access denied|are you a (robot|human)|robot check|verifying you are human|security check|one more step|checking your browser|client challenge|pardon our interruption|request blocked|bot verification|human verification|ddos protection)/i;

/**
 * True when a response is a bot challenge or similar wall: Cloudflare's "Just a moment...", a
 * captcha page, an access denied page. Such a page says nothing about the work, so its title
 * must never become the title of an item.
 */
export function isChallengePage(html: string): boolean {
  const title = clean(decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? ""));
  if (title && CHALLENGE_TITLE.test(title)) return true;
  const head = html.slice(0, 20000).toLowerCase();
  const small = html.length < 20000;
  if (small && /challenges\.cloudflare\.com|cf-browser-verification|_cf_chl_opt/.test(head)) {
    return true;
  }
  return small && /captcha-delivery\.com|px-captcha|g-recaptcha|h-captcha/.test(head);
}

// Identifiers ------------------------------------------------------------------------------------

type IdKind = "doi" | "isbn" | "arxiv" | "pmid";

function asIdentifier(value: string, hint?: IdKind): Identifier | undefined {
  const v = clean(value);
  if (!v) return undefined;
  if (hint === "doi" || /^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:|info:doi\/|urn:doi:)/i.test(v)) {
    const doi = normalizeDoi(v);
    return doi ? { kind: "doi", value: doi, raw: v } : undefined;
  }
  if (/^10\.\d{4,9}\/\S+$/.test(v)) {
    const doi = normalizeDoi(v);
    return doi ? { kind: "doi", value: doi, raw: v } : undefined;
  }
  if (hint === "isbn" || /^(?:urn:)?isbn/i.test(v)) {
    const body = v.replace(/^(?:urn:)?isbn(?:-1[03])?\s*:?\s*/i, "");
    for (const token of body.split(/[,;|/]\s*|\s{2,}/)) {
      const isbn = normalizeIsbn(token);
      if (isbn) return { kind: "isbn", value: isbn, raw: v };
    }
    return undefined;
  }
  if (hint === "arxiv" || /^arxiv\s*:/i.test(v)) {
    const a = normalizeArxivId(v);
    return a ? { kind: "arxiv", value: a.id, raw: v } : undefined;
  }
  if (hint === "pmid") {
    const m = /^(?:pmid\s*:?\s*)?(\d{1,9})$/i.exec(v);
    return m?.[1] ? { kind: "pmid", value: String(Number(m[1])), raw: v } : undefined;
  }
  if (/^https?:\/\//i.test(v)) {
    const id = detectIdentifier(v);
    return id && id.kind !== "url" ? id : undefined;
  }
  return undefined;
}

const DOI_NAMES = [
  "citation_doi",
  "bepress_citation_doi",
  "prism.doi",
  "dc.identifier.doi",
  "dcterms.identifier.doi",
  "doi",
  "st.doi",
  "rft_id",
];
const GENERIC_ID_NAMES = ["dc.identifier", "dcterms.identifier", "dc.source", "citation_id"];
const ISBN_NAMES = [
  "citation_isbn",
  "bepress_citation_isbn",
  "book:isbn",
  "og:isbn",
  "isbn",
  "dc.identifier.isbn",
  "prism.isbn",
];

function metaIdentifiers(tags: Tags): Identifier[] {
  const out: Identifier[] = [];
  const push = (id: Identifier | undefined): void => {
    if (id) out.push(id);
  };
  for (const n of DOI_NAMES) for (const v of tags.meta.get(n) ?? []) push(asIdentifier(v, "doi"));
  for (const n of GENERIC_ID_NAMES) for (const v of tags.meta.get(n) ?? []) push(asIdentifier(v));
  for (const href of tags.links) {
    if (/^https?:\/\/(?:dx\.)?doi\.org\/10\./i.test(href)) push(asIdentifier(href, "doi"));
  }
  for (const n of ISBN_NAMES) for (const v of tags.meta.get(n) ?? []) push(asIdentifier(v, "isbn"));
  for (const v of tags.meta.get("citation_arxiv_id") ?? []) push(asIdentifier(v, "arxiv"));
  for (const v of tags.meta.get("citation_pmid") ?? []) push(asIdentifier(v, "pmid"));
  return out;
}

// JSON-LD ----------------------------------------------------------------------------------------

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toArray(v: unknown): unknown[] {
  return v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];
}

function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const scan = html.length > MAX_SCAN ? html.slice(0, MAX_SCAN) : html;
  for (let m = re.exec(scan); m; m = re.exec(scan)) {
    const body = (m[1] ?? "")
      .replace(/^\s*(?:\/\/)?\s*<!\[CDATA\[/, "")
      .replace(/\]\]>\s*$/, "")
      .trim();
    try {
      out.push(JSON.parse(body));
    } catch {
      // a broken block does not hide the others
    }
  }
  return out;
}

/** Every node of the blocks, `@graph` flattened, with an index by `@id`. */
function flattenNodes(blocks: unknown[]): { nodes: Json[]; byId: Map<string, Json> } {
  const nodes: Json[] = [];
  const walk = (v: unknown, depth: number): void => {
    if (depth > 4) return;
    for (const item of toArray(v)) {
      if (!isObject(item)) continue;
      nodes.push(item);
      if (item["@graph"] !== undefined) walk(item["@graph"], depth + 1);
    }
  };
  walk(blocks, 0);
  const byId = new Map<string, Json>();
  for (const n of nodes) if (typeof n["@id"] === "string") byId.set(n["@id"], n);
  return { nodes, byId };
}

function typesOf(node: Json): string[] {
  return toArray(node["@type"])
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.replace(/^.*[/#]/, ""));
}

/** Types in order of how well they describe a cited work. */
const LD_PRIORITY = [
  "ScholarlyArticle",
  "MedicalScholarlyArticle",
  "TechArticle",
  "Chapter",
  "Book",
  "Thesis",
  "Report",
  "Dataset",
  "Article",
  "NewsArticle",
  "BlogPosting",
  "Review",
  "CreativeWork",
  "WebPage",
];

function mainNode(nodes: Json[], byId: Map<string, Json>): Json | undefined {
  let best: { node: Json; rank: number } | undefined;
  for (const node of nodes) {
    const ranks = typesOf(node)
      .map((t) => LD_PRIORITY.indexOf(t))
      .filter((r) => r >= 0);
    if (ranks.length === 0) continue;
    const rank = Math.min(...ranks);
    if (!best || rank < best.rank) best = { node, rank };
  }
  if (!best) return undefined;
  // A WebPage that names its main entity stands for that entity.
  const entity = toArray(best.node.mainEntity ?? best.node.mainEntityOfPage)[0];
  if (isObject(entity)) {
    const ref = typeof entity["@id"] === "string" ? byId.get(entity["@id"]) : undefined;
    const target = ref ?? (typesOf(entity).length > 0 ? entity : undefined);
    if (target && typesOf(target).some((t) => LD_PRIORITY.indexOf(t) >= 0)) return target;
  }
  return best.node;
}

function ldString(v: unknown): string | undefined {
  if (typeof v === "string") return clean(decodeEntities(v)) || undefined;
  if (typeof v === "number") return String(v);
  if (isObject(v)) return ldString(v.name ?? v["@value"] ?? v.value);
  if (Array.isArray(v)) return ldString(v[0]);
  return undefined;
}

function ldCreators(v: unknown, byId: Map<string, Json>): Creator[] {
  const out: Creator[] = [];
  for (const raw of toArray(v)) {
    let node: unknown = raw;
    if (isObject(node) && typeof node["@id"] === "string" && Object.keys(node).length === 1) {
      node = byId.get(node["@id"]) ?? node;
    }
    if (typeof node === "string") {
      // a list of names in one string: "A. Smith; B. Jones"
      for (const name of splitNameList(node)) out.push(splitPersonName(name));
    } else if (isObject(node)) {
      const family = ldString(node.familyName);
      const given = ldString(node.givenName);
      const name = ldString(node.name);
      const isOrg = typesOf(node).some((t) => /Organization|Corporation|Institution/.test(t));
      if (family) out.push(given ? { family, given } : { family });
      else if (name && isOrg) out.push({ literal: name });
      else if (name) for (const one of splitNameList(name)) out.push(splitPersonName(one));
    }
  }
  return out.filter((c) => ("family" in c ? c.family : c.literal).length > 0);
}

function ldIdentifiers(node: Json): Identifier[] {
  const out: Identifier[] = [];
  const push = (id: Identifier | undefined): void => {
    if (id) out.push(id);
  };
  const values = (v: unknown): string[] =>
    toArray(v).flatMap((x) =>
      typeof x === "string" || typeof x === "number"
        ? [String(x)]
        : isObject(x)
          ? [ldString(x.value ?? x["@value"] ?? x["@id"] ?? x.url)].filter(
              (s): s is string => s !== undefined,
            )
          : [],
    );
  for (const entry of toArray(node.identifier)) {
    if (isObject(entry)) {
      const prop = String(entry.propertyID ?? entry.name ?? "").toLowerCase();
      for (const v of values(entry.value ?? entry["@value"])) {
        push(
          asIdentifier(
            v,
            prop.includes("doi") ? "doi" : prop.includes("isbn") ? "isbn" : undefined,
          ),
        );
      }
    } else if (typeof entry === "string") push(asIdentifier(entry));
  }
  for (const v of values(node.doi)) push(asIdentifier(v, "doi"));
  for (const v of [...values(node.sameAs), ...values(node["@id"])]) {
    if (/doi\.org\/10\./i.test(v)) push(asIdentifier(v, "doi"));
  }
  const isbns = [
    ...values(node.isbn),
    ...toArray(node.workExample).flatMap((w) => (isObject(w) ? values(w.isbn) : [])),
  ];
  for (const v of isbns) push(asIdentifier(v, "isbn"));
  return out;
}

function ldFields(node: Json, byId: Map<string, Json>): MetadataFields {
  const types = typesOf(node);
  const f: MetadataFields = {};
  const title = ldString(node.headline ?? node.name);
  if (title) f.title = title;
  const author = ldCreators(node.author ?? node.creator, byId);
  if (author.length > 0) f.author = author;
  const editor = ldCreators(node.editor, byId);
  if (editor.length > 0) f.editor = editor;
  const date =
    ldString(node.datePublished) ?? ldString(node.copyrightYear) ?? ldString(node.dateCreated);
  const issued = date ? parseDate(date) : undefined;
  if (issued) f.issued = issued;
  const publisher = ldString(node.publisher);
  if (publisher) f.publisher = publisher;
  const lang = ldString(node.inLanguage);
  if (lang) {
    const l = lang.toLowerCase().replace(/_/g, "-");
    if (/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(l)) f.language = l;
  }
  const edition = ldString(node.bookEdition);
  if (edition) f.edition = edition;
  const pages = ldString(node.numberOfPages);
  if (pages) f["number-of-pages"] = pages;
  const abstract =
    ldString(node.abstract) ??
    (types.includes("ScholarlyArticle") ? ldString(node.description) : undefined);
  if (abstract) f.abstract = abstract;

  // isPartOf: issue, volume, journal or book, nested to any depth up to four
  let volume = ldString(node.volumeNumber);
  let issue = ldString(node.issueNumber);
  let container: string | undefined;
  let issn: string | undefined;
  let part: unknown = node.isPartOf;
  for (let i = 0; i < 4 && part !== undefined; i++) {
    const p = toArray(part)[0];
    const pn = isObject(p)
      ? typeof p["@id"] === "string" && Object.keys(p).length === 1
        ? (byId.get(p["@id"]) ?? p)
        : p
      : undefined;
    if (!pn) break;
    volume ??= ldString(pn.volumeNumber);
    issue ??= ldString(pn.issueNumber);
    const pt = typesOf(pn);
    const name = ldString(pn.name);
    if (
      name &&
      (pt.some((t) => /Periodical|Book|Series|Collection|Website|WebSite/.test(t)) ||
        !pt.some((t) => /Publication(Issue|Volume)/.test(t)))
    ) {
      container ??= name;
    }
    issn ??= ldString(pn.issn);
    part = pn.isPartOf;
  }
  if (volume) f.volume = volume;
  if (issue) f.issue = issue;
  if (container) f["container-title"] = container;
  if (issn) f.ISSN = issn;
  const start = ldString(node.pageStart);
  const end = ldString(node.pageEnd);
  const pagination = ldString(node.pagination);
  if (start) f.page = end ? `${start}-${end}` : start;
  else if (pagination) f.page = pagination;

  const isbn = ldIdentifiers(node).find((i) => i.kind === "isbn");
  if (isbn) f.ISBN = isbn.value;

  if (types.some((t) => /ScholarlyArticle|TechArticle/.test(t))) f.type = "article-journal";
  else if (types.includes("Chapter")) f.type = "chapter";
  else if (types.includes("Book")) f.type = "book";
  else if (types.includes("Thesis")) f.type = "thesis";
  else if (types.includes("Report")) f.type = "report";
  else if (types.includes("Dataset")) f.type = "dataset";
  else if (types.some((t) => /Article|BlogPosting|Review/.test(t))) f.type = "article";
  else f.type = "webpage";
  return f;
}

// Dates and names --------------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/** "2020/09/16", "2020-09", "March 2002", "16 Sep 2020", an ISO timestamp or "2020" to a CSL date. */
export function parseDate(input: string): string | undefined {
  const s = input.trim();
  const iso = /(?<![\d])(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?(?![\d])/.exec(s);
  if (iso?.[1] && Number(iso[2]) >= 1 && Number(iso[2]) <= 12) {
    const yy = iso[1];
    const mm = String(Number(iso[2])).padStart(2, "0");
    const d = Number(iso[3]);
    return d >= 1 && d <= 31 ? `${yy}-${mm}-${String(d).padStart(2, "0")}` : `${yy}-${mm}`;
  }
  const dmy = /\b(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})\b/.exec(s);
  const dmyMonth = dmy?.[2] ? MONTHS[dmy[2].toLowerCase()] : undefined;
  if (dmy?.[3] && dmy[1] && dmyMonth) {
    return `${dmy[3]}-${String(dmyMonth).padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }
  const text = /\b([A-Za-z]{3})[a-z]*\.?,?\s+(?:(\d{1,2}),?\s+)?(\d{4})\b/.exec(s);
  const month = text?.[1] ? MONTHS[text[1].toLowerCase()] : undefined;
  if (text?.[3] && month) {
    const mm = String(month).padStart(2, "0");
    return text[2] ? `${text[3]}-${mm}-${text[2].padStart(2, "0")}` : `${text[3]}-${mm}`;
  }
  const year = /(?<![\d])(1[5-9]\d{2}|20\d{2})(?![\d])/.exec(s)?.[1];
  return year;
}

const NOT_A_NAME = /^(unknown|anonymous|admin|editor|staff|redaktion|n\/a|none)$/i;

/**
 * Splits one author string that may hold several people: "Alex Williams and Nick Srnicek",
 * "A. Smith; B. Jones", "Ann Lee & Bo Kim". A comma separates people only when every part has at
 * least two words, so "Srnicek, Nick" stays one inverted name.
 */
export function splitNameList(value: string): string[] {
  const parts = value
    .split(/\s*;\s*|\s+(?:and|und|&)\s+|\s*&\s*/i)
    .map((p) => clean(p))
    .filter((p): p is string => Boolean(p));
  const out: string[] = [];
  for (const part of parts) {
    const byComma = part.split(/\s*,\s*/).filter(Boolean);
    if (byComma.length > 1 && byComma.every((c) => c.trim().split(/\s+/).length >= 2)) {
      out.push(...byComma);
    } else {
      out.push(part);
    }
  }
  return out;
}

function personsFrom(values: string[]): Creator[] {
  const out: Creator[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const whole = clean(v);
    if (!whole || NOT_A_NAME.test(whole) || /^https?:\/\//i.test(whole)) continue;
    for (const name of splitNameList(whole)) {
      const creator = splitPersonName(name);
      const key = JSON.stringify(creator);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(creator);
    }
  }
  return out;
}

// Tiers ------------------------------------------------------------------------------------------

function highwireFields(tags: Tags): MetadataFields {
  const f: MetadataFields = {};
  const title = first(tags, "citation_title", "bepress_citation_title");
  if (title) f.title = title;
  let authors = personsFrom(all(tags, "citation_author", "bepress_citation_author"));
  if (authors.length === 0) {
    authors = personsFrom((first(tags, "citation_authors") ?? "").split(/\s*;\s*/).filter(Boolean));
  }
  if (authors.length > 0) f.author = authors;
  const editors = personsFrom(all(tags, "citation_editor"));
  if (editors.length > 0) f.editor = editors;
  const date = first(
    tags,
    "citation_publication_date",
    "citation_date",
    "citation_online_date",
    "citation_cover_date",
    "citation_year",
    "bepress_citation_date",
    "bepress_citation_online_date",
  );
  const issued = date ? parseDate(date) : undefined;
  if (issued) f.issued = issued;
  const journal = first(tags, "citation_journal_title", "bepress_citation_journal_title");
  const conference = first(tags, "citation_conference_title", "citation_conference");
  const bookTitle = first(tags, "citation_inbook_title", "citation_book_title");
  const container = journal ?? conference ?? bookTitle;
  if (container) f["container-title"] = container;
  const volume = first(tags, "citation_volume", "bepress_citation_volume");
  if (volume) f.volume = volume;
  const issue = first(tags, "citation_issue", "bepress_citation_issue");
  if (issue) f.issue = issue;
  const firstPage = first(tags, "citation_firstpage", "bepress_citation_firstpage");
  const lastPage = first(tags, "citation_lastpage", "bepress_citation_lastpage");
  if (firstPage) f.page = lastPage ? `${firstPage}-${lastPage}` : firstPage;
  const publisher = first(
    tags,
    "citation_publisher",
    "citation_dissertation_institution",
    "citation_technical_report_institution",
  );
  if (publisher) f.publisher = publisher;
  const abstract = first(tags, "citation_abstract");
  if (abstract) f.abstract = abstract;
  const lang = first(tags, "citation_language");
  if (lang) {
    const l = lang.toLowerCase().replace(/_/g, "-");
    if (/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(l)) f.language = l;
  }
  const issn = first(tags, "citation_issn");
  if (issn) f.ISSN = issn;
  const isbn = first(tags, "citation_isbn", "bepress_citation_isbn");
  const isbnNorm = isbn ? asIdentifier(isbn, "isbn") : undefined;
  if (isbnNorm) f.ISBN = isbnNorm.value;

  if (f.title) {
    if (journal) f.type = "article-journal";
    else if (conference) f.type = "paper-conference";
    else if (first(tags, "citation_dissertation_institution", "citation_dissertation_name")) {
      f.type = "thesis";
    } else if (
      first(tags, "citation_technical_report_institution", "citation_technical_report_number")
    ) {
      f.type = "report";
    } else if (bookTitle) f.type = "chapter";
    else if (isbnNorm) f.type = "book";
    else f.type = "article";
  }
  return f;
}

function dublinCoreFields(tags: Tags): MetadataFields {
  const f: MetadataFields = {};
  const title = first(tags, "dc.title", "dcterms.title", "dc.title.alternative");
  if (title) f.title = title;
  const creators = personsFrom(
    all(tags, "dc.creator", "dcterms.creator", "dc.creator.personalname"),
  );
  if (creators.length > 0) f.author = creators;
  const date = first(
    tags,
    "dc.date.issued",
    "dcterms.issued",
    "dc.date",
    "dcterms.date",
    "dcterms.created",
    "dc.date.created",
  );
  const issued = date ? parseDate(date) : undefined;
  if (issued) f.issued = issued;
  const publisher = first(tags, "dc.publisher", "dcterms.publisher");
  if (publisher) f.publisher = publisher;
  const lang = first(tags, "dc.language", "dcterms.language");
  if (lang) {
    const l = lang.toLowerCase().replace(/_/g, "-");
    if (/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(l)) f.language = l;
  }
  const abstract = first(tags, "dcterms.abstract", "dc.description.abstract", "dc.description");
  if (abstract && abstract.length >= 60) f.abstract = abstract;
  if (f.title) {
    const type = (first(tags, "dc.type", "dcterms.type") ?? "").toLowerCase();
    if (/book/.test(type)) f.type = "book";
    else if (/thesis|dissertation/.test(type)) f.type = "thesis";
    else if (/report/.test(type)) f.type = "report";
    else if (/article/.test(type)) f.type = "article";
  }
  return f;
}

function openGraphFields(tags: Tags): MetadataFields {
  const f: MetadataFields = {};
  const title = first(tags, "og:title", "twitter:title");
  if (title) f.title = title;
  const authors = personsFrom([
    ...all(tags, "article:author", "og:article:author", "book:author"),
    ...all(tags, "author", "parsely-author", "sailthru.author"),
  ]);
  if (authors.length > 0) f.author = authors;
  const date = first(
    tags,
    "article:published_time",
    "og:article:published_time",
    "book:release_date",
    "date",
    "parsely-pub-date",
    "pubdate",
  );
  const issued = date ? parseDate(date) : undefined;
  if (issued) f.issued = issued;
  const site = first(tags, "og:site_name", "application-name");
  if (site) f["container-title"] = site;
  const locale = first(tags, "og:locale");
  if (locale) {
    const l = locale.toLowerCase().replace(/_/g, "-").split("-")[0];
    if (l && /^[a-z]{2,3}$/.test(l)) f.language = l;
  }
  return f;
}

/** The page's `<title>` without a trailing site name ("Title | SSRN", "Title - Publisher"). */
export function pageTitleOf(html: string, siteName?: string, url?: string): string | undefined {
  const raw = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  if (!raw) return undefined;
  return stripSiteName(clean(decodeEntities(raw.replace(/<[^>]+>/g, ""))), siteName, url);
}

/**
 * Removes a trailing or leading site name. A segment is a site name when it equals `og:site_name`
 * or when it contains the main label of the host ("papers.ssrn.com" gives "ssrn").
 */
export function stripSiteName(title: string, siteName?: string, url?: string): string {
  const parts = title.split(/\s+[|–—·•-]\s+|\s+::\s+/);
  if (parts.length < 2) return title;
  const known = new Set<string>();
  if (siteName) known.add(foldForCompare(siteName));
  if (url) {
    try {
      const labels = new URL(url).hostname.replace(/^www\./, "").split(".");
      const main = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
      if (main && main.length >= 3) known.add(foldForCompare(main));
    } catch {
      // not a URL
    }
  }
  const isSite = (s: string): boolean => {
    const f = foldForCompare(s);
    if (!f) return true;
    for (const k of known)
      if (f === k || (k.length >= 3 && f.includes(k) && f.split(" ").length <= 4)) return true;
    return false;
  };
  const last = parts[parts.length - 1] ?? "";
  if (isSite(last)) return parts.slice(0, -1).join(" - ");
  const head = parts[0] ?? "";
  if (isSite(head)) return parts.slice(1).join(" - ");
  return title;
}

const FIELD_ORDER: Array<keyof MetadataFields> = [
  "type",
  "title",
  "author",
  "editor",
  "issued",
  "container-title",
  "volume",
  "issue",
  "page",
  "publisher",
  "ISBN",
  "ISSN",
  "language",
  "edition",
  "number-of-pages",
  "abstract",
];

/** Reads the identifiers and fields a page names for itself. `url` is the address it came from. */
export function extractPageMetadata(html: string, url?: string): PageMetadata {
  const challenge = isChallengePage(html);
  if (challenge) return { identifiers: [], fields: {}, tiers: {}, challenge };

  const tags = readTags(html);
  const { nodes, byId } = flattenNodes(jsonLdBlocks(html));
  const main = mainNode(nodes, byId);

  const doi: Identifier[] = [];
  const isbn: Identifier[] = [];
  const arxiv: Identifier[] = [];
  const pmid: Identifier[] = [];
  const bucket = (id: Identifier): void => {
    const list =
      id.kind === "doi"
        ? doi
        : id.kind === "isbn"
          ? isbn
          : id.kind === "arxiv"
            ? arxiv
            : id.kind === "pmid"
              ? pmid
              : undefined;
    if (list && !list.some((x) => x.value === id.value)) list.push(id);
  };
  for (const id of metaIdentifiers(tags)) bucket(id);
  if (main) for (const id of ldIdentifiers(main)) bucket(id);
  for (const node of nodes) {
    if (node === main) continue;
    // a DOI named on the page by a sibling entity of the same kind, such as a second block
    if (typesOf(node).some((t) => LD_PRIORITY.indexOf(t) >= 0)) {
      for (const id of ldIdentifiers(node)) if (id.kind === "doi") bucket(id);
    }
  }

  const sources: Array<[PageTier, MetadataFields]> = [
    ["highwire", highwireFields(tags)],
    ["dublin-core", dublinCoreFields(tags)],
    ["json-ld", main ? ldFields(main, byId) : {}],
    ["opengraph", openGraphFields(tags)],
  ];
  const fields: MetadataFields = {};
  const tiers: PageMetadata["tiers"] = {};
  const out = fields as Record<string, unknown>;
  for (const key of FIELD_ORDER) {
    for (const [tier, f] of sources) {
      const v = f[key];
      if (v === undefined) continue;
      out[key] = v;
      tiers[key] = tier;
      break;
    }
  }
  if (fields.title === undefined) {
    const siteName = first(tags, "og:site_name");
    const t = pageTitleOf(html, siteName, url);
    if (t) {
      fields.title = t;
      tiers.title = "html";
    }
  } else if (tiers.title === "opengraph" || tiers.title === "json-ld") {
    fields.title = stripSiteName(fields.title, first(tags, "og:site_name"), url);
  }
  return { identifiers: [...doi, ...isbn, ...arxiv, ...pmid], fields, tiers, challenge };
}
