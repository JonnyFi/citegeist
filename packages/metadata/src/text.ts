import type { Creator } from "./types.js";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: String.fromCodePoint(0x2014),
  hellip: "…",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
  szlig: "ß",
  eacute: "é",
  egrave: "è",
  aacute: "á",
  agrave: "à",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  ntilde: "ñ",
  ccedil: "ç",
};

/** Decodes numeric and the common named HTML entities (mEDRA records contain them). */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return safeCodePoint(Number.parseInt(body.slice(2), 16)) ?? whole;
    }
    if (body.startsWith("#")) return safeCodePoint(Number(body.slice(1))) ?? whole;
    return NAMED_ENTITIES[body] ?? whole;
  });
}

function safeCodePoint(n: number): string | undefined {
  try {
    return Number.isFinite(n) ? String.fromCodePoint(n) : undefined;
  } catch {
    return undefined;
  }
}

export function collapseWhitespace(s: string): string {
  // NFC: DNB delivers decomposed umlauts, which would break comparisons and sorting.
  return s.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** Plain text from titles that may carry markup: removes tags, decodes entities. */
export function cleanText(s: string): string {
  return collapseWhitespace(decodeEntities(s.replace(/<[^>]+>/g, "")));
}

/**
 * JATS abstract to plain text. Section titles ("Abstract", "Zusammenfassung") are dropped,
 * paragraphs are separated by a blank line.
 */
export function jatsToText(xml: string): string {
  const withoutTitles = xml.replace(/<(?:jats:)?title\b[^>]*>[\s\S]*?<\/(?:jats:)?title>/gi, "");
  const paragraphs = withoutTitles
    .split(/<\/(?:jats:)?p>/i)
    .map((p) => cleanText(p))
    .filter((p) => p.length > 0);
  return paragraphs.join("\n\n");
}

/** Lowercase, diacritics folded, punctuation removed. Used for comparing names and titles. */
export function foldForCompare(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const LANG3_TO_2: Record<string, string> = {
  ger: "de",
  deu: "de",
  eng: "en",
  fre: "fr",
  fra: "fr",
  spa: "es",
  ita: "it",
  dut: "nl",
  nld: "nl",
  por: "pt",
  rus: "ru",
  pol: "pl",
  tur: "tr",
  swe: "sv",
  dan: "da",
  nor: "no",
  lat: "la",
  chi: "zh",
  zho: "zh",
  jpn: "ja",
};

/** BCP 47 style tag from ISO 639-2 or 639-1 input, or undefined. */
export function normalizeLanguage(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const s = input.trim().toLowerCase().replace(/_/g, "-");
  if (/^[a-z]{3}$/.test(s)) return LANG3_TO_2[s] ?? s;
  if (/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(s)) return s;
  return undefined;
}

/** "2021-3-4" style or CSL date-parts to "2021", "2021-03" or "2021-03-04". */
export function dateFromParts(parts: unknown): string | undefined {
  if (!Array.isArray(parts) || !Array.isArray(parts[0])) return undefined;
  const [y, m, d] = parts[0] as unknown[];
  if (typeof y !== "number" || y < 0 || y > 9999) return undefined;
  const yy = String(y).padStart(4, "0");
  if (typeof m !== "number" || m < 1 || m > 12) return yy;
  const mm = String(m).padStart(2, "0");
  if (typeof d !== "number" || d < 1 || d > 31) return `${yy}-${mm}`;
  return `${yy}-${mm}-${String(d).padStart(2, "0")}`;
}

/** Year, month, day from a free date string ("2001", "March 2002", "Aug 1, 2000", ISO). */
export function dateFromText(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const iso = /(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(s);
  if (iso) return iso[3] ? `${iso[1]}-${iso[2]}-${iso[3]}` : `${iso[1]}-${iso[2]}`;
  const year = /\b(1[5-9]\d{2}|20\d{2})\b/.exec(s);
  return year?.[1];
}

const PARTICLES = new Set([
  "van",
  "von",
  "de",
  "der",
  "den",
  "di",
  "da",
  "del",
  "della",
  "du",
  "la",
  "le",
  "ten",
  "ter",
  "zu",
  "zur",
  "bin",
  "al",
]);

/** "Niklas Luhmann" to {given, family}. Lowercase particles stay with the family name. */
export function splitPersonName(name: string): Creator {
  const clean = collapseWhitespace(name.replace(/\s*\([^)]*\)\s*/g, " "));
  if (clean.includes(",")) {
    const [family, ...rest] = clean.split(",");
    const given = rest.join(",").trim();
    return given ? { family: (family ?? "").trim(), given } : { family: (family ?? "").trim() };
  }
  const tokens = clean.split(" ");
  if (tokens.length === 1) return { family: clean };
  let i = tokens.length - 1;
  while (i > 1 && PARTICLES.has((tokens[i - 1] ?? "").toLowerCase())) i--;
  return { given: tokens.slice(0, i).join(" "), family: tokens.slice(i).join(" ") };
}

/** ORCID as bare id ("0000-0002-1825-0097") from a URL or bare form, else undefined. */
export function normalizeOrcid(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = /(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/i.exec(s);
  return m?.[1]?.toUpperCase();
}

/** Removes undefined keys so objects satisfy exactOptionalPropertyTypes. */
export function compact<T extends object>(obj: { [K in keyof T]?: T[K] | undefined }): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    out[k] = v;
  }
  return out as T;
}

export function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Some publishers (CUP, OUP) deposit names in capitals ("FEARON", "JAMES D."). If a name has no
 * lowercase letter at all it is converted to title case, else it is left alone.
 */
export function fixShoutedName(s: string): string {
  if (!/\p{Lu}{2}/u.test(s) || /\p{Ll}/u.test(s)) return s;
  return s
    .toLowerCase()
    .replace(
      /(^|[\s\-'\u2019.])(\p{L})/gu,
      (_, sep: string, ch: string) => `${sep}${ch.toUpperCase()}`,
    );
}
