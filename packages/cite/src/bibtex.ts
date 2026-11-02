import type { Creator, ItemFrontmatter } from "@citegeist/schema";
import { type Creator as BibCreator, parse } from "@retorquere/bibtex-parser/js";
import { formatDateValue, fullTitle, type ItemDraft, parseDateValue } from "./csl.js";

export interface BibtexParseResult {
  items: ItemDraft[];
  /** Entries or syntax the parser could not read, as human readable messages. */
  errors: string[];
}

export interface BibtexWriteOptions {
  /** "biblatex" (default) writes date, journaltitle, location, subtitle. "bibtex" writes year, month, journal, address. */
  flavor?: "biblatex" | "bibtex";
}

const BIB_TO_CSL_TYPE: Record<string, string> = {
  article: "article-journal",
  book: "book",
  mvbook: "book",
  booklet: "pamphlet",
  inbook: "chapter",
  incollection: "chapter",
  suppbook: "chapter",
  bookinbook: "chapter",
  inproceedings: "paper-conference",
  conference: "paper-conference",
  proceedings: "book",
  mvproceedings: "book",
  collection: "collection",
  mvcollection: "collection",
  manual: "book",
  techreport: "report",
  report: "report",
  thesis: "thesis",
  phdthesis: "thesis",
  mastersthesis: "thesis",
  unpublished: "manuscript",
  online: "webpage",
  electronic: "webpage",
  www: "webpage",
  software: "software",
  dataset: "dataset",
  patent: "patent",
  periodical: "periodical",
  misc: "document",
  other: "document",
};

const CSL_TO_BIBLATEX_TYPE: Record<string, string> = {
  "article-journal": "article",
  "article-magazine": "article",
  "article-newspaper": "article",
  article: "article",
  book: "book",
  collection: "collection",
  chapter: "incollection",
  "paper-conference": "inproceedings",
  thesis: "thesis",
  report: "report",
  webpage: "online",
  post: "online",
  "post-weblog": "online",
  manuscript: "unpublished",
  software: "software",
  dataset: "dataset",
  patent: "patent",
  periodical: "periodical",
  pamphlet: "booklet",
};

const CSL_TO_BIBTEX_TYPE: Record<string, string> = {
  "article-journal": "article",
  "article-magazine": "article",
  "article-newspaper": "article",
  article: "article",
  book: "book",
  collection: "book",
  chapter: "incollection",
  "paper-conference": "inproceedings",
  thesis: "phdthesis",
  report: "techreport",
  manuscript: "unpublished",
  pamphlet: "booklet",
};

const LANGID_TO_ISO: Record<string, string> = {
  german: "de",
  ngerman: "de",
  austrian: "de",
  naustrian: "de",
  english: "en",
  american: "en",
  british: "en",
  usenglish: "en",
  ukenglish: "en",
  french: "fr",
  spanish: "es",
  italian: "it",
  dutch: "nl",
  portuguese: "pt",
};

/** Maps a BibLaTeX langid or free language text ("german", "de", "en-GB") to a BCP 47 tag. */
export function isoLanguage(raw: string | undefined): string | undefined {
  const v = raw?.trim().toLowerCase();
  if (!v) return undefined;
  return LANGID_TO_ISO[v] ?? (/^[a-z]{2,3}(-[a-z0-9]+)*$/.test(v) ? v : undefined);
}

const ISO_TO_LANGID: Record<string, string> = {
  de: "german",
  en: "english",
  fr: "french",
  es: "spanish",
  it: "italian",
  nl: "dutch",
  pt: "portuguese",
};

/** Bib field to CSL variable, for fields that map one to one. */
const SIMPLE_IN: [bib: string, csl: string][] = [
  ["volume", "volume"],
  ["doi", "DOI"],
  ["isbn", "ISBN"],
  ["issn", "ISSN"],
  ["url", "URL"],
  ["abstract", "abstract"],
  ["edition", "edition"],
  ["series", "collection-title"],
  ["note", "note"],
  ["pagetotal", "number-of-pages"],
  ["numpages", "number-of-pages"],
  ["version", "version"],
  ["eventtitle", "event-title"],
  ["venue", "event-place"],
  ["type", "genre"],
  ["chapter", "chapter-number"],
];

/** CSL variable to bib field, same set as SIMPLE_IN without the aliases. */
const SIMPLE_OUT: [csl: string, bib: string][] = [
  ["edition", "edition"],
  ["collection-title", "series"],
  ["event-title", "eventtitle"],
  ["event-place", "venue"],
  ["genre", "type"],
  ["chapter-number", "chapter"],
  ["number-of-pages", "pagetotal"],
  ["version", "version"],
  ["DOI", "doi"],
  ["ISBN", "isbn"],
  ["ISSN", "issn"],
  ["URL", "url"],
  ["abstract", "abstract"],
  ["note", "note"],
];

const VERBATIM_FIELDS = new Set(["doi", "isbn", "issn", "url", "eprint", "eprinttype", "pmid"]);

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

type Fields = Record<string, unknown>;

function text(fields: Fields, ...names: string[]): string | undefined {
  for (const name of names) {
    const v = fields[name];
    if (typeof v === "string" && v.trim() !== "") return v.trim().normalize("NFC");
    if (Array.isArray(v)) {
      const joined = v
        .filter((x): x is string => typeof x === "string")
        .join(" and ")
        .trim()
        .normalize("NFC");
      if (joined !== "") return joined;
    }
  }
  return undefined;
}

function monthNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  if (Number.isInteger(n) && n >= 1 && n <= 12) return n;
  const idx = MONTHS.indexOf(value.trim().slice(0, 3).toLowerCase());
  return idx >= 0 ? idx + 1 : undefined;
}

function bibDate(fields: Fields, dateKey: string, yearKey: string, monthKey: string) {
  const date = text(fields, dateKey);
  if (date) {
    const m = /^(-?\d{1,4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/.exec(date);
    if (m) return formatDateValue([m[1], m[2], m[3]].filter((x) => x !== undefined).map(Number));
  }
  const year = text(fields, yearKey);
  const ym = year ? /-?\d{1,4}/.exec(year)?.[0] : undefined;
  if (ym === undefined) return undefined;
  const month = monthNumber(text(fields, monthKey));
  return formatDateValue(month ? [Number(ym), month] : [Number(ym)]);
}

function normalizePages(pages: string): string {
  return pages.replace(/\s*[–]\s*|\s*-{1,3}\s*/g, "-");
}

function toCreator(c: BibCreator): Creator | undefined {
  const n = (s: string) => s.normalize("NFC");
  if (c.name) return { literal: n(c.name) };
  if (!c.lastName) return c.firstName ? { literal: n(c.firstName) } : undefined;
  const out: Record<string, string> = { family: n(c.lastName) };
  if (c.firstName) out.given = n(c.firstName);
  if (c.prefix) out["non-dropping-particle"] = n(c.prefix);
  if (c.suffix) out.suffix = n(c.suffix);
  return out as Creator;
}

function creators(value: unknown): Creator[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = (value as BibCreator[]).map(toCreator).filter((c): c is Creator => c !== undefined);
  return list.length > 0 ? list : undefined;
}

/** Reads BibTeX or BibLaTeX into item drafts. The entry key becomes `citekey`. */
export function parseBibtex(input: string): BibtexParseResult {
  const lib = parse(input, { sentenceCase: false, applyCrossRef: true });
  const errors = lib.errors.map((e) => String((e as { message?: string }).message ?? e));
  const items: ItemDraft[] = [];
  for (const entry of lib.entries) {
    const f = entry.fields as Fields;
    const bibType = entry.type.toLowerCase();
    const type = BIB_TO_CSL_TYPE[bibType] ?? "document";
    const title = text(f, "title");
    if (!title) {
      errors.push(`Entry ${entry.key} has no title and was skipped`);
      continue;
    }
    const draft: Record<string, unknown> = { type, title, citekey: entry.key };
    const subtitle = text(f, "subtitle");
    if (subtitle) draft.subtitle = subtitle;
    const author = creators(f.author);
    if (author) draft.author = author;
    const editor = creators(f.editor);
    if (editor) draft.editor = editor;
    const translator = creators(f.translator);
    if (translator) draft.translator = translator;
    const containerAuthor = creators(f.bookauthor);
    if (containerAuthor) draft["container-author"] = containerAuthor;

    const issued = bibDate(f, "date", "year", "month");
    if (issued !== undefined) draft.issued = issued;
    const accessed = bibDate(f, "urldate", "urlyear", "urlmonth");
    if (accessed !== undefined) {
      const parts = parseDateValue(accessed);
      if (parts) draft.accessed = { "date-parts": [parts] };
    }

    const isArticle = type.startsWith("article") || type === "periodical";
    const isInBook = type === "chapter" || type === "paper-conference";
    const container = isInBook
      ? text(f, "booktitle", "maintitle")
      : text(f, "journaltitle", "journal", "booktitle", "maintitle");
    if (container) draft["container-title"] = container;
    const number = text(f, "number");
    const issue = text(f, "issue");
    if (isArticle) {
      if (issue ?? number) draft.issue = issue ?? number;
    } else {
      if (issue) draft.issue = issue;
      if (number) draft.number = number;
    }
    const pages = text(f, "pages");
    if (pages) draft.page = normalizePages(pages);
    const publisher = text(f, "publisher", "institution", "organization", "school");
    if (publisher) draft.publisher = publisher;
    const place = text(f, "location", "address");
    if (place) draft["publisher-place"] = place;
    for (const [bib, csl] of SIMPLE_IN) {
      if (draft[csl] !== undefined) continue;
      const v = text(f, bib);
      if (v) draft[csl] = v;
    }

    const language = isoLanguage(text(f, "langid")) ?? isoLanguage(text(f, "language"));
    if (language) draft.language = language;

    const ids: Record<string, string> = {};
    const eprint = text(f, "eprint");
    const eprintType = text(f, "eprinttype", "archiveprefix")?.toLowerCase();
    if (eprint && (eprintType === "arxiv" || /^\d{4}\.\d{4,5}/.test(eprint))) ids.arxiv = eprint;
    else if (eprint) ids[eprintType ?? "eprint"] = eprint;
    const pmid = text(f, "pmid");
    if (pmid) ids.pmid = pmid;
    if (Object.keys(ids).length > 0) draft.ids = ids;

    const keywords = f.keywords;
    if (Array.isArray(keywords)) {
      const tags = keywords.filter((k): k is string => typeof k === "string" && k.trim() !== "");
      if (tags.length > 0) draft.tags = tags.map((t) => t.trim().normalize("NFC"));
    } else if (typeof keywords === "string" && keywords.trim() !== "") {
      draft.tags = keywords.split(/\s*[,;]\s*/).filter((t) => t !== "");
    }
    items.push(draft as ItemDraft);
  }
  return { items, errors };
}

// Writing ----------------------------------------------------------------------------------------------

function escapeBib(s: string): string {
  return s
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/[{}&%$#_]/g, (c) => `\\${c}`)
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

/** Wraps words with inner capitals (NASA, iPhone, DNA) in braces so BibTeX styles keep their case. */
function protectCase(escaped: string): string {
  return escaped.replace(/(?<![\\{\p{L}])(\p{L}+)(?![\p{L}}])/gu, (word) => {
    const rest = word.slice(1);
    return rest !== rest.toLowerCase() ? `{${word}}` : word;
  });
}

function bibName(c: Creator): string {
  if ("literal" in c) return `{${escapeBib(c.literal)}}`;
  const particles = [c["dropping-particle"], c["non-dropping-particle"]].filter(Boolean).join(" ");
  const family = escapeBib(c.family);
  const braced = /,|\band\b/.test(c.family) ? `{${family}}` : family;
  const last = particles ? `${escapeBib(particles)} ${braced}` : braced;
  const given = c.given ? escapeBib(c.given) : "";
  if (c.suffix && given) return `${last}, ${escapeBib(c.suffix)}, ${given}`;
  return given ? `${last}, ${given}` : last;
}

function bibNames(list: readonly Creator[]): string {
  return list.map(bibName).join(" and ");
}

function bibPages(page: string): string {
  return page.replace(/(?<=\w)\s*[-–]+\s*(?=\w)/g, "--");
}

function plainCreators(value: unknown): Creator[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter(
    (c): c is Creator => typeof c === "object" && c !== null && ("family" in c || "literal" in c),
  );
  return list.length > 0 ? list : undefined;
}

function publisherField(type: string, bibtex: boolean): string {
  if (type === "thesis") return bibtex ? "school" : "institution";
  if (type === "report") return "institution";
  return "publisher";
}

function entryFor(item: ItemFrontmatter, flavor: "biblatex" | "bibtex"): string {
  const bibtex = flavor === "bibtex";
  const rec = item as unknown as Record<string, unknown>;
  const type = (bibtex ? CSL_TO_BIBTEX_TYPE : CSL_TO_BIBLATEX_TYPE)[item.type] ?? "misc";
  const lines: [string, string][] = [];
  const add = (
    name: string,
    value: string | undefined,
    kind: "text" | "title" | "raw" = "text",
  ) => {
    if (value === undefined || value === "") return;
    const body =
      kind === "raw" ? value : kind === "title" ? protectCase(escapeBib(value)) : escapeBib(value);
    lines.push([name, body]);
  };
  const addNames = (name: string, list: readonly Creator[] | undefined) => {
    if (list && list.length > 0) lines.push([name, bibNames(list)]);
  };
  const str = (k: string): string | undefined => {
    const v = rec[k];
    return typeof v === "string" && v !== "" ? v : undefined;
  };

  addNames("author", item.author);
  addNames("editor", item.editor);
  addNames("translator", plainCreators(rec.translator));
  addNames("bookauthor", plainCreators(rec["container-author"]));
  if (bibtex) add("title", fullTitle(item), "title");
  else {
    add("title", item.title, "title");
    add("subtitle", item.subtitle, "title");
  }
  const isArticle = item.type.startsWith("article") || item.type === "periodical";
  const isInBook = item.type === "chapter" || item.type === "paper-conference";
  const container = item["container-title"];
  if (container) {
    if (isInBook) add("booktitle", container, "title");
    else add(bibtex ? "journal" : "journaltitle", container, "title");
  }
  const issued = parseDateValue(item.issued);
  if (issued) {
    if (bibtex) {
      add("year", String(issued[0]), "raw");
      if (issued[1]) lines.push(["month", MONTHS[issued[1] - 1] ?? String(issued[1])]);
    } else add("date", String(formatDateValue(issued)), "raw");
  }
  add("volume", item.volume);
  if (item.issue) add(isArticle ? "number" : "issue", item.issue);
  if (str("number")) add("number", str("number"));
  if (item.page) add("pages", bibPages(item.page));
  if (item.publisher) add(publisherField(item.type, bibtex), item.publisher);
  add(bibtex ? "address" : "location", item["publisher-place"]);
  for (const [csl, bib] of SIMPLE_OUT) {
    add(bib, str(csl), VERBATIM_FIELDS.has(bib) ? "raw" : "text");
  }
  const accessed = rec.accessed as { "date-parts"?: number[][] } | undefined;
  const accessedParts = accessed?.["date-parts"]?.[0];
  if (accessedParts) add("urldate", String(formatDateValue(accessedParts)), "raw");
  if (item.ids.arxiv) {
    add("eprint", item.ids.arxiv, "raw");
    add("eprinttype", "arxiv", "raw");
  } else {
    for (const [k, v] of Object.entries(item.ids)) {
      if (k === "pmid" || k === "pmcid" || k === "zotero") continue;
      add("eprint", v, "raw");
      add("eprinttype", k, "raw");
      break;
    }
  }
  add("pmid", item.ids.pmid, "raw");
  if (item.language) {
    const langid = ISO_TO_LANGID[item.language];
    if (langid) add("langid", langid, "raw");
    else add("language", item.language, "raw");
  }
  if (item.tags.length > 0) lines.push(["keywords", item.tags.map(escapeBib).join(", ")]);

  const body = lines.map(([k, v]) => `  ${k} = {${v}}`).join(",\n");
  return `@${type}{${item.citekey},\n${body},\n}`;
}

/** Writes items as BibLaTeX (default) or classic BibTeX. Entries are separated by a blank line. */
export function toBibtex(items: readonly ItemFrontmatter[], opts: BibtexWriteOptions = {}): string {
  const flavor = opts.flavor ?? "biblatex";
  return `${items.map((i) => entryFor(i, flavor)).join("\n\n")}\n`;
}
