/**
 * Field-level merge with provenance. Rules (docs/research/metadata-sources.md section 12):
 *
 * - Citation fields come from the registration agency (Crossref, or DataCite and others through
 *   doi.org), then arXiv, then the library catalogues, then Open Library, then OpenAlex.
 * - OpenAlex fills ORCIDs on the authors the agency named, topics and references. Its title,
 *   DOI, year and type never beat a primary source.
 * - Abstracts come from whichever source has one.
 * - Values the user entered always win.
 *
 * Provenance maps each field name to "<source>@<YYYY-MM-DD>" (the pattern of ItemFrontmatter).
 */

import { foldForCompare } from "./text.js";
import type {
  Creator,
  Enrichment,
  FieldName,
  MetadataFields,
  SourceName,
  SourceRecord,
} from "./types.js";

type Order = SourceName[];

const CITATION: Order = [
  "crossref",
  "doi.org",
  "arxiv",
  "dnb",
  "k10plus",
  "openlibrary",
  "openalex",
];
const ABSTRACT: Order = [
  "crossref",
  "doi.org",
  "arxiv",
  "openalex",
  "dnb",
  "k10plus",
  "openlibrary",
];
const LANGUAGE: Order = [
  "crossref",
  "doi.org",
  "dnb",
  "k10plus",
  "arxiv",
  "openalex",
  "openlibrary",
];

/** Authority tiers for list fields. Inside a tier the most complete list wins. */
const LIST_TIERS: SourceName[][] = [
  ["crossref", "doi.org"],
  ["arxiv"],
  ["dnb", "k10plus", "openlibrary"],
  ["openalex"],
];

const SCALAR_ORDER: Partial<Record<FieldName, Order>> = {
  abstract: ABSTRACT,
  language: LANGUAGE,
};

const SCALAR_FIELDS: FieldName[] = [
  "type",
  "title",
  "issued",
  "container-title",
  "volume",
  "issue",
  "page",
  "publisher",
  "publisher-place",
  "DOI",
  "ISBN",
  "ISSN",
  "URL",
  "abstract",
  "language",
  "edition",
  "collection-title",
  "number-of-pages",
];

function present(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

export interface MergeOptions {
  /** Values the user entered. They always win. */
  user?: MetadataFields;
  /** ISO date for the "user" provenance entries. Default: today. */
  today?: string;
}

export interface MergeResult {
  fields: MetadataFields;
  /** Field name to "<source>@<date>". Also "author.orcid" and "ids.<key>". */
  provenance: Record<string, string>;
  enrichment: Enrichment;
}

function stamp(rec: SourceRecord): string {
  return `${rec.source}@${rec.fetchedAt}`;
}

function firstByOrder(
  records: SourceRecord[],
  order: Order,
  field: FieldName,
  allow?: (rec: SourceRecord) => boolean,
): SourceRecord | undefined {
  for (const source of order) {
    for (const rec of records) {
      if (rec.source !== source || (allow && !allow(rec))) continue;
      if (present(rec.fields[field])) return rec;
    }
  }
  return undefined;
}

function pickList(
  records: SourceRecord[],
  field: "author" | "editor",
): { rec: SourceRecord; list: Creator[] } | undefined {
  for (const tier of LIST_TIERS) {
    let best: { rec: SourceRecord; list: Creator[] } | undefined;
    for (const rec of records) {
      if (!tier.includes(rec.source)) continue;
      const list = rec.fields[field];
      if (list && list.length > (best?.list.length ?? 0)) best = { rec, list };
    }
    if (best) return best;
  }
  return undefined;
}

function nameKey(c: Creator): { family: string; initial: string } | undefined {
  if (!("family" in c)) return undefined;
  const family = foldForCompare(c.family);
  const given = c.given ? foldForCompare(c.given) : "";
  return { family, initial: given.slice(0, 1) };
}

function sameAuthor(a: Creator, b: Creator): boolean {
  const ka = nameKey(a);
  const kb = nameKey(b);
  if (!ka || !kb) return false;
  const lastA = ka.family.split(" ").pop();
  const lastB = kb.family.split(" ").pop();
  const familyMatch = ka.family === kb.family || (lastA === lastB && lastA !== undefined);
  if (!familyMatch) return false;
  return ka.initial === "" || kb.initial === "" || ka.initial === kb.initial;
}

/** Copies ORCIDs from other sources onto authors that have none. */
function fillOrcids(
  authors: Creator[],
  records: SourceRecord[],
  authorSource: SourceRecord,
): { authors: Creator[]; source: SourceRecord | undefined } {
  let filledFrom: SourceRecord | undefined;
  let hadOwn = false;
  const out = authors.map((a) => {
    if (!("family" in a)) return a;
    if (a.orcid) {
      hadOwn = true;
      return a;
    }
    for (const rec of records) {
      if (rec === authorSource) continue;
      const match = rec.fields.author?.find((o) => "family" in o && o.orcid && sameAuthor(a, o));
      if (match && "orcid" in match && match.orcid) {
        filledFrom ??= rec;
        return { ...a, orcid: match.orcid };
      }
    }
    return a;
  });
  return { authors: out, source: filledFrom ?? (hadOwn ? authorSource : undefined) };
}

export function mergeRecords(records: SourceRecord[], options: MergeOptions = {}): MergeResult {
  const fields: Record<string, unknown> = {};
  const provenance: Record<string, string> = {};
  const today = options.today ?? new Date().toISOString().slice(0, 10);

  // Title first: subtitle must come from the same record, otherwise it would be repeated.
  const titleRec = firstByOrder(records, CITATION, "title");
  if (titleRec?.fields.title) {
    fields.title = titleRec.fields.title;
    provenance.title = stamp(titleRec);
    if (titleRec.fields.subtitle) {
      fields.subtitle = titleRec.fields.subtitle;
      provenance.subtitle = stamp(titleRec);
    }
  }

  const finalDoi = firstByOrder(records, CITATION, "DOI")?.fields.DOI;
  for (const field of SCALAR_FIELDS) {
    if (field === "title") continue;
    const order = SCALAR_ORDER[field] ?? CITATION;
    // An arXiv abs URL describes the preprint; keep it only when the item is the preprint.
    const allow =
      field === "URL"
        ? (rec: SourceRecord) =>
            rec.source !== "arxiv" || finalDoi === undefined || finalDoi.startsWith("10.48550/")
        : undefined;
    const rec = firstByOrder(records, order, field, allow);
    if (rec) {
      fields[field] = rec.fields[field];
      provenance[field] = stamp(rec);
    }
  }

  const authors = pickList(records, "author");
  if (authors) {
    const filled = fillOrcids(authors.list, records, authors.rec);
    fields.author = filled.authors;
    provenance.author = stamp(authors.rec);
    if (filled.source) provenance["author.orcid"] = stamp(filled.source);
  }
  const editors = pickList(records, "editor");
  if (editors) {
    fields.editor = editors.list;
    provenance.editor = stamp(editors.rec);
  }

  // Identifiers: union, with the citation order deciding conflicts.
  const ids: Record<string, string> = {};
  for (const source of CITATION) {
    for (const rec of records) {
      if (rec.source !== source) continue;
      for (const [k, v] of Object.entries(rec.fields.ids ?? {})) {
        if (!(k in ids)) {
          ids[k] = v;
          provenance[`ids.${k}`] = stamp(rec);
        }
      }
    }
  }
  if (Object.keys(ids).length > 0) fields.ids = ids;

  const enrichment = mergeEnrichment(records);

  const user = options.user;
  if (user) {
    for (const [k, v] of Object.entries(user)) {
      if (!present(v)) continue;
      if (k === "ids") {
        fields.ids = { ...(fields.ids as Record<string, string> | undefined), ...(v as object) };
        for (const key of Object.keys(v as object)) provenance[`ids.${key}`] = `user@${today}`;
        continue;
      }
      fields[k] = v;
      provenance[k] = `user@${today}`;
      if (k === "title" && !("subtitle" in user)) {
        delete fields.subtitle;
        delete provenance.subtitle;
      }
    }
  }

  return { fields: fields as MetadataFields, provenance, enrichment };
}

function mergeEnrichment(records: SourceRecord[]): Enrichment {
  const out: Record<string, unknown> = {};
  for (const rec of records) {
    for (const [k, v] of Object.entries(rec.enrichment ?? {})) {
      if (k === "isRetracted") {
        if (v === true) out.isRetracted = true;
        continue;
      }
      if (!(k in out) && present(v)) out[k] = v;
    }
  }
  return out as Enrichment;
}
