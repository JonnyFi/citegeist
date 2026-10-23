/**
 * Mapping of CSL-JSON (doi.org content negotiation) and Crossref work records to MetadataFields.
 * Both look alike but differ: Crossref uses arrays for title and container-title, its own type
 * names and ORCID URLs; CSL-JSON from DataCite, mEDRA and others varies in what it fills.
 */

import { CslType } from "@citegeist/schema";
import { normalizeDoi, normalizeIsbn } from "./identifiers.js";
import {
  cleanText,
  compact,
  dateFromParts,
  decodeEntities,
  fixShoutedName,
  jatsToText,
  normalizeLanguage,
  normalizeOrcid,
} from "./text.js";
import type { Creator, MetadataFields } from "./types.js";

type Json = Record<string, unknown>;
type CslTypeName = NonNullable<MetadataFields["type"]>;

export function asString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

export function firstString(v: unknown): string | undefined {
  if (Array.isArray(v)) {
    for (const item of v) {
      const s = asString(item);
      if (s?.trim()) return s;
    }
    return undefined;
  }
  const s = asString(v);
  return s?.trim() ? s : undefined;
}

const CSL_TYPES = new Set<string>(CslType.options);

const CROSSREF_TYPES: Record<string, CslTypeName> = {
  "journal-article": "article-journal",
  "book-chapter": "chapter",
  "book-section": "chapter",
  "book-part": "chapter",
  "book-track": "chapter",
  book: "book",
  monograph: "book",
  "edited-book": "book",
  "reference-book": "book",
  "book-set": "book",
  "book-series": "book",
  "proceedings-article": "paper-conference",
  proceedings: "book",
  "posted-content": "article",
  dataset: "dataset",
  report: "report",
  "report-component": "report",
  "report-series": "report",
  dissertation: "thesis",
  "reference-entry": "entry",
  "peer-review": "review",
  standard: "standard",
  "standard-series": "standard",
  journal: "periodical",
  "journal-issue": "periodical",
  "journal-volume": "periodical",
  database: "dataset",
  other: "document",
  component: "document",
  grant: "document",
};

/** Maps a Crossref or CSL type name to a CSL type, or undefined. */
export function mapType(t: string | undefined): CslTypeName | undefined {
  if (!t) return undefined;
  const crossref = CROSSREF_TYPES[t];
  if (crossref) return crossref;
  return CSL_TYPES.has(t) ? (t as CslTypeName) : undefined;
}

function mapCreators(v: unknown): Creator[] {
  if (!Array.isArray(v)) return [];
  const out: Creator[] = [];
  for (const raw of v) {
    if (typeof raw !== "object" || raw === null) continue;
    const a = raw as Json;
    const family = asString(a.family)?.trim();
    const given = asString(a.given)?.trim();
    const literal = asString(a.literal)?.trim() ?? asString(a.name)?.trim();
    const orcid = normalizeOrcid(asString(a.ORCID) ?? asString(a.orcid));
    if (family) {
      const particle = asString(a["non-dropping-particle"])?.trim();
      const dropping = asString(a["dropping-particle"])?.trim();
      const suffix = asString(a.suffix)?.trim();
      out.push(
        compact({
          family: fixShoutedName(decodeEntities(family)),
          given: given ? fixShoutedName(decodeEntities(given)) : undefined,
          "non-dropping-particle": particle,
          "dropping-particle": dropping,
          suffix,
          orcid,
        }),
      );
    } else if (literal) {
      out.push({ literal: decodeEntities(literal) });
    }
  }
  return out;
}

function mapIssn(item: Json): string | undefined {
  let value: string | undefined;
  const types = item["issn-type"];
  if (Array.isArray(types)) {
    const print = types.find(
      (t): t is Json => typeof t === "object" && t !== null && (t as Json).type === "print",
    );
    value = asString(print?.value);
  }
  value ??= firstString(item.ISSN);
  if (!value) return undefined;
  const digits = value.replace(/[^0-9Xx]/g, "").toUpperCase();
  return digits.length === 8 ? `${digits.slice(0, 4)}-${digits.slice(4)}` : value;
}

function mapIsbn(item: Json): string | undefined {
  const types = item["isbn-type"];
  const candidates: string[] = [];
  if (Array.isArray(types)) {
    const sorted = [...types].sort(
      (a, b) => Number((b as Json).type === "print") - Number((a as Json).type === "print"),
    );
    for (const t of sorted) {
      const v = asString((t as Json).value);
      if (v) candidates.push(v);
    }
  }
  const raw = item.ISBN;
  if (Array.isArray(raw)) for (const v of raw) candidates.push(asString(v) ?? "");
  else if (typeof raw === "string") candidates.push(raw);
  for (const c of candidates) {
    const isbn = normalizeIsbn(c.replace(/^.*\/isbn\//i, ""));
    if (isbn) return isbn;
  }
  return undefined;
}

function mapIssued(item: Json): string | undefined {
  for (const key of ["issued", "published", "published-print", "published-online"]) {
    const v = item[key];
    if (typeof v === "object" && v !== null) {
      const d = dateFromParts((v as Json)["date-parts"]);
      if (d) return d;
    }
  }
  return undefined;
}

function mapPage(v: unknown): string | undefined {
  const s = asString(v)?.trim();
  return s ? s.replace(/[‐-―]/g, "-") : undefined;
}

function mapAbstract(v: unknown): string | undefined {
  const s = asString(v);
  if (!s) return undefined;
  const text = /[<&]/.test(s) ? jatsToText(s) : s.trim();
  return text.length > 0 ? text : undefined;
}

/** Works for Crossref `message` objects and for CSL-JSON. */
export function mapCslLike(item: Json): MetadataFields {
  const doiRaw = asString(item.DOI);
  const doi = doiRaw ? normalizeDoi(doiRaw) : undefined;
  const titleRaw = firstString(item.title);
  const subtitle = firstString(item.subtitle);
  const url = asString(item.URL);
  const arxivDoi = doi ? /^10\.48550\/arxiv\.(.+)$/.exec(doi) : null;

  return compact<MetadataFields>({
    type: mapType(asString(item.type)),
    title: titleRaw ? cleanText(titleRaw) : undefined,
    subtitle: subtitle ? cleanText(subtitle) : undefined,
    author: mapCreators(item.author),
    editor: mapCreators(item.editor),
    issued: mapIssued(item),
    "container-title": cleanOpt(firstString(item["container-title"])),
    volume: asString(item.volume)?.trim(),
    issue: asString(item.issue)?.trim(),
    page: mapPage(item.page),
    publisher: cleanOpt(asString(item.publisher)),
    "publisher-place": mapPlace(
      asString(item["publisher-place"]) ?? asString(item["publisher-location"]),
    ),
    DOI: doi,
    ISBN: mapIsbn(item),
    ISSN: mapIssn(item),
    URL: url && !/^https?:\/\/(dx\.)?doi\.org\//i.test(url) ? url : undefined,
    abstract: mapAbstract(item.abstract),
    language: normalizeLanguage(asString(item.language)),
    ids: arxivDoi?.[1] ? { arxiv: arxivDoi[1] } : undefined,
  });
}

function cleanOpt(s: string | undefined): string | undefined {
  return s ? cleanText(s) : undefined;
}

/** mEDRA and the EU Publications Office put country codes ("IT", "LU") into publisher-place. */
function mapPlace(s: string | undefined): string | undefined {
  const place = cleanOpt(s);
  return place && !/^[A-Z]{2}$/.test(place) ? place : undefined;
}
