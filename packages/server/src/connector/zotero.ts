/**
 * Zotero translator JSON as the browser Connector sends it in /connector/saveItems, and its
 * mapping to what `items.add` accepts. The carrier is a BibLaTeX entry: `items.add` reads a
 * BibTeX snippet through the same parser as a .bib import, so no extra contract is needed.
 */

export interface ZoteroCreator {
  creatorType?: string;
  firstName?: string;
  lastName?: string;
  /** Single-field name (an institution) when `fieldMode` is 1. */
  name?: string;
  fieldMode?: number;
}

export interface ZoteroAttachment {
  id?: string;
  title?: string;
  url?: string;
  mimeType?: string;
  /** True for a page snapshot, false for a file such as a PDF. */
  snapshot?: boolean;
  [key: string]: unknown;
}

export interface ZoteroItem {
  /** Assigned by the Connector; attachments refer to it as `parentItemID`. */
  id?: string;
  itemType?: string;
  title?: string;
  creators?: ZoteroCreator[];
  date?: string;
  tags?: Array<string | { tag?: string; type?: number }>;
  attachments?: ZoteroAttachment[];
  notes?: Array<{ note?: string }>;
  [field: string]: unknown;
}

// Dates -----------------------------------------------------------------------------------------------

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
  // German, the translators run on whatever the page says
  mär: 3,
  mrz: 3,
  mai: 5,
  okt: 10,
  dez: 12,
};

function monthOf(word: string): number | undefined {
  const key = word.toLowerCase().replace(/[.,]/g, "").normalize("NFC").slice(0, 3);
  return MONTHS[key];
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Zotero dates are free text ("2020-03-05", "March 5, 2019", "5 March 2019", "Spring 2018").
 * Returns an ISO date with as many parts as the text carries, or undefined.
 */
export function parseZoteroDate(raw: string | undefined): string | undefined {
  const s = raw?.trim();
  if (!s) return undefined;
  // Zotero's own multipart form "2019-03-05 March 5, 2019" starts with the ISO date.
  const iso = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?(?!\d)/.exec(s);
  if (iso?.[1]) {
    const [, y, m, d] = iso;
    const month = m ? Number(m) : undefined;
    if (month && month >= 1 && month <= 12) {
      const day = d ? Number(d) : undefined;
      return day && day >= 1 && day <= 31 ? `${y}-${pad(month)}-${pad(day)}` : `${y}-${pad(month)}`;
    }
    return y;
  }
  const year = /\b(\d{4})\b/.exec(s)?.[1];
  if (!year) return undefined;
  const monthWord = /[A-Za-zÄÖÜäöü]{3,}/.exec(s.replace(year, ""))?.[0];
  const month = monthWord ? monthOf(monthWord) : undefined;
  if (!month) return year;
  const day = /\b(\d{1,2})(?:st|nd|rd|th)?\b/.exec(s.replace(year, ""))?.[1];
  const d = day ? Number(day) : undefined;
  return d && d >= 1 && d <= 31 ? `${year}-${pad(month)}-${pad(d)}` : `${year}-${pad(month)}`;
}

// BibLaTeX --------------------------------------------------------------------------------------------

const ESCAPES: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
  "{": "\\{",
  "}": "\\}",
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
};

/** Escapes text for a braced BibLaTeX value; the parser decodes it again. One pass, so the braces of \textbackslash{} stay. */
function esc(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\\~^{}&%$#_]/g, (c) => ESCAPES[c] ?? c);
}

/** Verbatim fields (identifiers, URLs) are not LaTeX; braces would only confuse the parser. */
function verbatim(s: string): string {
  return s.replace(/[{}\s]+/g, "");
}

const TYPE_MAP: Record<string, string> = {
  journalArticle: "article",
  magazineArticle: "article",
  newspaperArticle: "article",
  book: "book",
  bookSection: "incollection",
  conferencePaper: "inproceedings",
  thesis: "thesis",
  report: "report",
  webpage: "online",
  blogPost: "online",
  forumPost: "online",
  preprint: "online",
  manuscript: "unpublished",
  patent: "patent",
  computerProgram: "software",
  dataset: "dataset",
};

function str(item: ZoteroItem, ...fields: string[]): string | undefined {
  for (const f of fields) {
    const v = item[f];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
    if (typeof v === "number") return String(v);
  }
  return undefined;
}

function nameOf(c: ZoteroCreator): string | undefined {
  if (c.name || c.fieldMode === 1) {
    const n = c.name ?? c.lastName;
    return n?.trim() ? `{${esc(n)}}` : undefined;
  }
  const last = c.lastName?.trim();
  const first = c.firstName?.trim();
  if (!last) return first ? `{${esc(first)}}` : undefined;
  const family = /,|\band\b/.test(last) ? `{${esc(last)}}` : esc(last);
  return first ? `${family}, ${esc(first)}` : family;
}

function names(item: ZoteroItem, ...types: string[]): string | undefined {
  const out = (item.creators ?? [])
    .filter((c) => types.includes(c.creatorType ?? "author"))
    .map(nameOf)
    .filter((n): n is string => n !== undefined);
  return out.length > 0 ? out.join(" and ") : undefined;
}

/** Tags of an item as plain strings, without the empty ones. */
export function zoteroTags(item: ZoteroItem): string[] {
  const out = new Set<string>();
  for (const t of item.tags ?? []) {
    const tag = (typeof t === "string" ? t : t.tag)?.trim();
    if (tag) out.add(tag);
  }
  return [...out];
}

/** A BibTeX key that survives the parser: ASCII letters and digits. */
function entryKey(item: ZoteroItem): string {
  const first = item.creators?.[0];
  const family = (first?.lastName ?? first?.name ?? "zotero")
    .normalize("NFD")
    .replace(/[^A-Za-z]/g, "");
  const year = parseZoteroDate(item.date)?.slice(0, 4) ?? "";
  return `${(family || "zotero").toLowerCase()}${year}`;
}

export interface MappedItem {
  /** BibLaTeX entry for `items.add`. */
  bibtex: string;
  title: string;
  tags: string[];
  /** The page the Connector saved from, kept as a hint in the inbox reason. */
  url?: string;
}

/**
 * Maps one Zotero item to a BibLaTeX entry. Fields that BibLaTeX and the importer know carry
 * over; the rest (callNumber, rights, archive and similar) is dropped. Tags travel separately as
 * the `tags` input of items.add.
 */
export function mapZoteroItem(item: ZoteroItem): MappedItem {
  const itemType = item.itemType ?? "document";
  const type = TYPE_MAP[itemType] ?? "misc";
  const title = str(item, "title", "subject") ?? str(item, "url") ?? "Untitled";
  const lines: Array<[string, string]> = [];
  const text = (field: string, value: string | undefined) => {
    if (value) lines.push([field, `{${esc(value)}}`]);
  };
  const raw = (field: string, value: string | undefined) => {
    if (value) lines.push([field, `{${verbatim(value)}}`]);
  };
  const people = (field: string, value: string | undefined) => {
    if (value) lines.push([field, `{${value}}`]);
  };

  text("title", title);
  const shortTitle = str(item, "shortTitle");
  if (shortTitle && shortTitle !== title) text("shorttitle", shortTitle);
  people(
    "author",
    names(item, "author", "contributor", "inventor", "programmer", "podcaster", "interviewee"),
  );
  people("editor", names(item, "editor", "seriesEditor"));
  people("translator", names(item, "translator"));
  people("bookauthor", names(item, "bookAuthor"));
  const date = parseZoteroDate(item.date);
  raw("date", date);

  const container = str(
    item,
    "publicationTitle",
    "bookTitle",
    "proceedingsTitle",
    "websiteTitle",
    "blogTitle",
    "forumTitle",
    "programTitle",
  );
  if (container) {
    const inBook = type === "incollection" || type === "inproceedings";
    text(inBook ? "booktitle" : "journaltitle", container);
  }
  text("eventtitle", str(item, "conferenceName", "meetingName"));
  text("volume", str(item, "volume"));
  text("number", str(item, "issue", "reportNumber", "number", "patentNumber"));
  text("pages", str(item, "pages")?.replace(/\s*[-\u2013\u2014]+\s*/g, "--"));
  text("publisher", str(item, "publisher", "institution", "university", "company"));
  text("location", str(item, "place"));
  text("edition", str(item, "edition"));
  text("series", str(item, "series", "seriesTitle"));
  text("type", str(item, "thesisType", "reportType", "genre", "websiteType"));
  text("pagetotal", str(item, "numPages"));
  text("language", str(item, "language"));
  text("abstract", str(item, "abstractNote"));
  raw("doi", str(item, "DOI"));
  raw("isbn", str(item, "ISBN"));
  raw("issn", str(item, "ISSN"));
  raw("url", str(item, "url"));
  raw("urldate", parseZoteroDate(str(item, "accessDate")));
  const arxiv = /arxiv:?\s*(\d{4}\.\d{4,5}(?:v\d+)?)/i.exec(str(item, "extra") ?? "")?.[1];
  if (arxiv) {
    raw("eprint", arxiv);
    raw("eprinttype", "arXiv");
  }
  const pmid = /^PMID:\s*(\d+)/im.exec(str(item, "extra") ?? "")?.[1];
  raw("pmid", pmid);

  const body = lines.map(([k, v]) => `  ${k} = ${v},`).join("\n");
  const url = str(item, "url");
  return {
    bibtex: `@${type}{${entryKey(item)},\n${body}\n}\n`,
    title,
    tags: zoteroTags(item),
    ...(url ? { url } : {}),
  };
}
