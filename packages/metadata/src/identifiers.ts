/**
 * Identifier detection and extraction. Input is always text: a user input string, the text of the
 * first PDF pages, or XMP packets. Reading PDFs is not done here.
 */

export type IdentifierKind = "doi" | "arxiv" | "isbn" | "pmid" | "url";

export interface Identifier {
  kind: IdentifierKind;
  /**
   * Normalised value. DOI: lowercase without prefix. arXiv: id without version. ISBN: ISBN-13
   * digits. PMID: digits. URL: the URL.
   */
  value: string;
  /** The text this identifier was read from. */
  raw: string;
  /** arXiv only, e.g. "v7". */
  version?: string;
  /** Offset in the scanned text. */
  index?: number;
  /** Set when a DOI, arXiv id or PMID was found inside a URL. */
  via?: "url";
}

const DOI_CORE = String.raw`10\.\d{4,9}/[^\s"'<>‘’“”]+`;
const DOI_RE = new RegExp(DOI_CORE, "gi");
const DOI_EXACT_RE = /^10\.\d{4,9}\/\S+$/;

const ARXIV_ARCHIVES = new Set([
  "astro-ph",
  "cond-mat",
  "gr-qc",
  "hep-ex",
  "hep-lat",
  "hep-ph",
  "hep-th",
  "math-ph",
  "nlin",
  "nucl-ex",
  "nucl-th",
  "physics",
  "quant-ph",
  "math",
  "cs",
  "q-bio",
  "q-fin",
  "stat",
  "alg-geom",
  "chao-dyn",
  "cmp-lg",
  "comp-gas",
  "dg-ga",
  "funct-an",
  "patt-sol",
  "solv-int",
  "supr-con",
  "adap-org",
  "ao-sci",
  "atom-ph",
  "bayes-an",
  "chem-ph",
  "mtrl-th",
  "acc-phys",
  "plasm-ph",
  "econ",
  "eess",
]);

const ARXIV_NEW = String.raw`(\d{2})(\d{2})\.(\d{4,5})(v\d+)?`;
const ARXIV_OLD = String.raw`([a-z]+(?:-[a-z]+)*)(?:\.[A-Za-z]{2})?/(\d{2})(\d{2})(\d{3})(v\d+)?`;

function arxivNewValid(yy: string, mm: string, seq: string): boolean {
  const month = Number(mm);
  if (month < 1 || month > 12) return false;
  const ym = Number(yy + mm);
  if (ym < 704) return false;
  // 4 digit sequence numbers until 1412, 5 digits from 1501.
  return seq.length === 4 ? ym <= 1412 : ym >= 1501;
}

function arxivOldValid(archive: string, mm: string): boolean {
  const month = Number(mm);
  return ARXIV_ARCHIVES.has(archive.toLowerCase()) && month >= 1 && month <= 12;
}

/** Parses a bare arXiv id ("1706.03762v7", "hep-th/9711200"). */
function parseArxivId(s: string): { id: string; version?: string } | undefined {
  const n = new RegExp(`^${ARXIV_NEW}$`).exec(s);
  if (n) {
    const [, yy, mm, seq, v] = n;
    if (yy && mm && seq && arxivNewValid(yy, mm, seq)) {
      return withVersion(`${yy}${mm}.${seq}`, v);
    }
    return undefined;
  }
  const o = new RegExp(`^${ARXIV_OLD}$`, "i").exec(s);
  if (o) {
    const [, archive, yy, mm, seq, v] = o;
    if (archive && yy && mm && seq && arxivOldValid(archive, mm)) {
      // A subject class ("math.GT/0309136") is only an alias; the canonical id has none.
      return withVersion(`${archive.toLowerCase()}/${yy}${mm}${seq}`, v);
    }
  }
  return undefined;
}

function withVersion(id: string, version: string | undefined): { id: string; version?: string } {
  return version ? { id, version } : { id };
}

export function normalizeDoi(input: string): string | undefined {
  let s = input.trim();
  s = s.replace(/^(?:https?:\/\/)?(?:dx\.|www\.)?doi\.org\//i, "");
  s = s.replace(/^(?:doi|urn:doi|info:doi)[:/]?\s*/i, "");
  s = safeDecode(s);
  s = trimDoiTail(s);
  if (!DOI_EXACT_RE.test(s)) return undefined;
  return s.toLowerCase();
}

function trimDoiTail(doi: string): string {
  let s = doi;
  for (;;) {
    const before = s;
    s = s.replace(/[.,;:!?'"’”]+$/, "");
    for (const [open, close] of [
      ["(", ")"],
      ["[", "]"],
      ["{", "}"],
    ] as const) {
      while (s.endsWith(close) && count(s, close) > count(s, open)) s = s.slice(0, -1);
    }
    if (s === before) return s;
  }
}

function count(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

function safeDecode(s: string): string {
  if (!s.includes("%")) return s;
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function isValidIsbn13(digits: string): boolean {
  if (!/^\d{13}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(digits[12]);
}

export function isValidIsbn10(chars: string): boolean {
  if (!/^\d{9}[\dX]$/.test(chars)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const c = chars[i] as string;
    sum += (c === "X" ? 10 : Number(c)) * (10 - i);
  }
  return sum % 11 === 0;
}

export function isbn10To13(isbn10: string): string {
  const body = `978${isbn10.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

/** Returns the ISBN-13 digits for a valid ISBN-10 or ISBN-13 (separators allowed), else undefined. */
export function normalizeIsbn(input: string): string | undefined {
  const s = input.replace(/[\s‐-―-]/g, "").toUpperCase();
  if (s.length === 13 && isValidIsbn13(s) && /^97[89]/.test(s)) return s;
  if (s.length === 10 && isValidIsbn10(s)) return isbn10To13(s);
  return undefined;
}

export function normalizeArxivId(input: string): { id: string; version?: string } | undefined {
  const s = input
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf|html)\//i, "")
    .replace(/^arxiv\s*:\s*/i, "")
    .replace(/\.pdf$/i, "");
  return parseArxivId(s);
}

const ISBN_SEP = String.raw`[\s‐-―-]?`;

/** Detects what a single input string is. Returns undefined for free text. */
export function detectIdentifier(input: string): Identifier | undefined {
  const raw = input.trim();
  if (!raw) return undefined;

  if (/^https?:\/\//i.test(raw)) return detectUrl(raw);

  if (/^(?:doi|urn:doi|info:doi)\b/i.test(raw) || raw.startsWith("10.")) {
    const doi = normalizeDoi(raw);
    if (doi) return { kind: "doi", value: doi, raw };
  }

  const arxiv = normalizeArxivId(raw);
  if (arxiv) return arxivIdentifier(arxiv, raw);

  const isbnLabel = /^(?:urn:)?isbn(?:-1[03])?\s*:?\s*/i;
  const isbnBody = raw.replace(isbnLabel, "");
  if (/^[\dXx][\dXx\s‐-―-]{8,16}[\dXx]$/.test(isbnBody)) {
    const isbn = normalizeIsbn(isbnBody);
    if (isbn) return { kind: "isbn", value: isbn, raw };
  }

  const pmid = /^(?:pmid\s*:?\s*)?(\d{1,9})$/i.exec(raw);
  if (pmid?.[1]) return { kind: "pmid", value: String(Number(pmid[1])), raw };

  return undefined;
}

function arxivIdentifier(a: { id: string; version?: string }, raw: string): Identifier {
  return a.version
    ? { kind: "arxiv", value: a.id, version: a.version, raw }
    : { kind: "arxiv", value: a.id, raw };
}

function detectUrl(raw: string): Identifier | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = safeDecode(url.pathname);

  if (host === "doi.org" || host === "dx.doi.org") {
    const doi = normalizeDoi(path.slice(1));
    if (doi) return { kind: "doi", value: doi, raw, via: "url" };
  }

  if (host === "arxiv.org" || host === "export.arxiv.org") {
    const m = /^\/(?:abs|pdf|html)\/(.+?)(?:\.pdf)?\/?$/i.exec(path);
    const a = m?.[1] ? parseArxivId(m[1]) : undefined;
    if (a) return { ...arxivIdentifier(a, raw), via: "url" };
  }

  if (host === "pubmed.ncbi.nlm.nih.gov" || host === "ncbi.nlm.nih.gov") {
    const m = /^\/(?:pubmed\/)?(\d{1,9})\/?$/.exec(path);
    if (m?.[1]) return { kind: "pmid", value: String(Number(m[1])), raw, via: "url" };
  }

  if (host === "nature.com") {
    const m = /^\/articles\/(s\d{5}-\d{3}-\d{4,5}-[\dx]|nature\d+|ncomms\d+)\/?$/i.exec(path);
    if (m?.[1]) return { kind: "doi", value: `10.1038/${m[1].toLowerCase()}`, raw, via: "url" };
  }

  // SSRN serves a bot challenge to unknown clients, but its DOI follows from the paper number.
  if (host === "ssrn.com" || host.endsWith(".ssrn.com")) {
    const number =
      url.searchParams.get("abstract_id") ??
      url.searchParams.get("abstractid") ??
      /\/abstract=(\d+)/i.exec(path)?.[1] ??
      /SSRN_ID(\d+)/i.exec(path)?.[1];
    if (number && /^\d{3,9}$/.test(number)) {
      return { kind: "doi", value: `10.2139/ssrn.${Number(number)}`, raw, via: "url" };
    }
  }

  const embedded = /10\.\d{4,9}\/[^\s"'<>?#&]+/i.exec(path + url.search);
  if (embedded) {
    const doi = normalizeDoi(embedded[0].replace(/\.pdf$/i, ""));
    if (doi) return { kind: "doi", value: doi, raw, via: "url" };
  }

  return { kind: "url", value: url.toString(), raw };
}

const REFERENCES_HEADING =
  /^[ \t]*(?:\d+\.?[ \t]+)?(?:references|bibliography|works cited|literatur(?:verzeichnis)?|quellen(?:verzeichnis)?|references and notes)[ \t]*$/im;

export interface ExtractOptions {
  /** Ignore everything after a references heading (default true). */
  stopAtReferences?: boolean;
}

/**
 * Finds identifiers in the text of the first PDF pages (or any text), in order of appearance,
 * without duplicates. ISBN-10 and PMID need their label to avoid matching arbitrary numbers.
 */
export function extractIdentifiers(text: string, options: ExtractOptions = {}): Identifier[] {
  let body = text;
  if (options.stopAtReferences !== false) {
    const m = REFERENCES_HEADING.exec(body);
    if (m && m.index > 0) body = body.slice(0, m.index);
  }
  const found: Identifier[] = [];

  for (const m of body.matchAll(DOI_RE)) {
    const doi = normalizeDoi(m[0]);
    if (doi) found.push({ kind: "doi", value: doi, raw: m[0], index: m.index });
  }

  const arxivLoose = String.raw`[a-z][a-z-]*(?:\.[A-Za-z]{2})?/\d{7}(?:v\d+)?|\d{4}\.\d{4,5}(?:v\d+)?`;
  const labelled = new RegExp(
    String.raw`\barxiv\s*:\s*(${arxivLoose})|arxiv\.org/(?:abs|pdf|html)/(${arxivLoose})`,
    "gi",
  );
  for (const m of body.matchAll(labelled)) {
    const a = parseArxivId((m[1] ?? m[2] ?? "").replace(/\.pdf$/i, ""));
    if (a) found.push({ ...arxivIdentifier(a, m[0]), index: m.index });
  }

  const isbnRe = new RegExp(
    String.raw`ISBN(?:-1[03])?\s*:?\s*((?:97[89]${ISBN_SEP})?\d(?:${ISBN_SEP}\d){8}${ISBN_SEP}[\dXx])|\b(97[89](?:${ISBN_SEP}\d){10})\b`,
    "gi",
  );
  for (const m of body.matchAll(isbnRe)) {
    const isbn = normalizeIsbn(m[1] ?? m[2] ?? "");
    if (isbn) found.push({ kind: "isbn", value: isbn, raw: m[0], index: m.index });
  }

  for (const m of body.matchAll(/\bPMID\s*:?\s*(\d{1,9})\b/gi)) {
    if (m[1]) {
      found.push({ kind: "pmid", value: String(Number(m[1])), raw: m[0], index: m.index });
    }
  }

  found.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return dedupe(found);
}

function dedupe(list: Identifier[]): Identifier[] {
  const seen = new Set<string>();
  const out: Identifier[] = [];
  for (const id of list) {
    const key = `${id.kind}:${id.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

const XMP_TAGS = [
  "prism:doi",
  "pdfx:doi",
  "dc:identifier",
  "prism:isbn",
  "prism:url",
  "xmp:identifier",
  "dc:source",
  "dc:relation",
];

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Reads DOI, ISBN, URL and arXiv identifiers out of an XMP packet (as string). */
export function extractFromXmp(xmp: string): Identifier[] {
  const pieces: string[] = [];
  for (const tag of XMP_TAGS) {
    const name = tag;
    const elementRe = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "gi");
    for (const m of xmp.matchAll(elementRe)) {
      const inner = decodeXml((m[1] ?? "").replace(/<[^>]+>/g, " "));
      pieces.push(...inner.split(/\s+/));
    }
    const attrRe = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "gi");
    for (const m of xmp.matchAll(attrRe)) pieces.push(decodeXml(m[1] ?? ""));
  }
  const out: Identifier[] = [];
  for (const piece of pieces) {
    const p = piece.trim();
    if (!p) continue;
    const direct = detectIdentifier(p);
    // Bare digit strings in dc:identifier are not PMIDs, only labelled ones count.
    if (direct && !(direct.kind === "pmid" && !/pmid/i.test(p))) {
      out.push(direct);
      continue;
    }
    out.push(...extractIdentifiers(p, { stopAtReferences: false }));
  }
  return dedupe(out);
}

const KIND_RANK: Record<IdentifierKind, number> = { doi: 0, arxiv: 1, isbn: 2, pmid: 3, url: 4 };

/** Picks the identifier to resolve first: DOI, then arXiv, ISBN, PMID, URL. */
export function pickPrimary(ids: Identifier[]): Identifier | undefined {
  return [...ids].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind])[0];
}
