/**
 * MARC21 XML from SRU services (DNB, K10plus) to MetadataFields. Both libraries use the same
 * MARC21 slim format with RDA, so one mapper serves both.
 */

import { XMLParser } from "fast-xml-parser";
import { normalizeIsbn } from "../identifiers.js";
import {
  cleanText,
  collapseWhitespace,
  compact,
  dateFromText,
  decodeEntities,
  normalizeLanguage,
  splitPersonName,
} from "../text.js";
import {
  type Creator,
  type Enrichment,
  type MetadataFields,
  SourceError,
  type SourceName,
  type SourceRecord,
} from "../types.js";
import { makeRecord, type SourceContext } from "./context.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => ["record", "datafield", "subfield", "controlfield"].includes(name),
});

type Node = Record<string, unknown>;

export interface MarcField {
  tag: string;
  ind1: string;
  ind2: string;
  sub: Array<{ code: string; value: string }>;
}

export interface MarcRecord {
  control: Map<string, string>;
  fields: MarcField[];
}

/** Records inside an SRU searchRetrieveResponse. */
export function parseSru(xml: string): MarcRecord[] {
  let doc: Node;
  try {
    doc = parser.parse(xml) as Node;
  } catch {
    throw new SourceError("sru", "response is not XML");
  }
  const response = (doc.searchRetrieveResponse ?? {}) as Node;
  const wrapper = (response.records ?? {}) as Node;
  const sruRecords = (wrapper.record ?? []) as Node[];
  const out: MarcRecord[] = [];
  for (const r of sruRecords) {
    const data = (r.recordData ?? {}) as Node;
    const marcList = (data.record ?? []) as Node[];
    for (const m of marcList) out.push(toMarc(m));
  }
  return out;
}

function toMarc(m: Node): MarcRecord {
  const control = new Map<string, string>();
  for (const c of (m.controlfield ?? []) as Node[]) {
    const tag = c["@_tag"];
    const value = c["#text"];
    if (typeof tag === "string" && typeof value === "string") control.set(tag, value);
  }
  const fields: MarcField[] = [];
  for (const d of (m.datafield ?? []) as Node[]) {
    const sub = ((d.subfield ?? []) as Node[]).flatMap((s) => {
      const code = s["@_code"];
      const value = s["#text"];
      return typeof code === "string" && typeof value === "string" ? [{ code, value }] : [];
    });
    fields.push({
      tag: String(d["@_tag"] ?? ""),
      ind1: String(d["@_ind1"] ?? " "),
      ind2: String(d["@_ind2"] ?? " "),
      sub,
    });
  }
  return { control, fields };
}

function sub(f: MarcField, code: string): string | undefined {
  return f.sub.find((s) => s.code === code)?.value;
}

function subs(f: MarcField, code: string): string[] {
  return f.sub.filter((s) => s.code === code).map((s) => s.value);
}

function all(r: MarcRecord, tag: string): MarcField[] {
  return r.fields.filter((f) => f.tag === tag);
}

/** Strips ISBD punctuation, non-sorting marks and brackets from a MARC string. */
export function cleanMarc(s: string | undefined): string | undefined {
  if (!s) return undefined;
  // The XML parser leaves numeric references such as &#152; (DNB non-sorting marks) untouched.
  const cleaned = collapseWhitespace(
    decodeEntities(s)
      .replace(/[\u0098\u009c¬]/g, "")
      .replace(/^\[(.*)\]$/, "$1")
      .replace(/\s*[:;,/=]\s*$/, ""),
  );
  return cleaned.length > 0 ? cleaned : undefined;
}

const RELATOR_AUTHOR = new Set(["aut", "cre", "verfasser", "verfasserin", "author"]);
const RELATOR_EDITOR = new Set(["edt", "herausgeber", "herausgeberin", "hrsg.", "editor"]);

function relators(f: MarcField): string[] {
  return [...subs(f, "4"), ...subs(f, "e")].map((r) =>
    (r.split("/").pop() ?? r).toLowerCase().replace(/[,.]$/, ""),
  );
}

function marcCreator(f: MarcField): Creator | undefined {
  const a = cleanMarc(sub(f, "a"));
  if (!a) return undefined;
  if (f.tag === "110" || f.tag === "710") {
    const b = cleanMarc(sub(f, "b"));
    return { literal: b ? `${a}. ${b}` : a };
  }
  const c = splitPersonName(a);
  return "family" in c && c.family ? c : { literal: a };
}

export interface MarcOptions {
  /** ISBN-13 that was searched for. */
  isbn: string;
  source: Extract<SourceName, "dnb" | "k10plus">;
}

/** Picks the record whose ISBN matches (earliest year wins among printings), else the first. */
export function pickRecord(records: MarcRecord[], isbn: string): MarcRecord | undefined {
  const matches = records.filter((r) =>
    all(r, "020").some((f) =>
      [...subs(f, "a"), ...subs(f, "9")].some((v) => normalizeIsbn(v) === isbn),
    ),
  );
  const pool = matches.length > 0 ? matches : records;
  return [...pool].sort((a, b) => (yearOf(a) ?? 9999) - (yearOf(b) ?? 9999))[0];
}

function yearOf(r: MarcRecord): number | undefined {
  const d = dateOf(r);
  return d ? Number(d.slice(0, 4)) : undefined;
}

function dateOf(r: MarcRecord): string | undefined {
  const imprint = all(r, "264").find((f) => f.ind2 === "1") ?? all(r, "260")[0] ?? all(r, "264")[0];
  const fromImprint = dateFromText(imprint ? sub(imprint, "c") : undefined);
  if (fromImprint) return fromImprint;
  const f008 = r.control.get("008");
  const y = f008 ? /^\d{7}[ste](\d{4})/.exec(f008)?.[1] : undefined;
  return y && y !== "uuuu" ? y : undefined;
}

export function marcToRecord(
  r: MarcRecord,
  opts: MarcOptions,
  fetchedAtMs: number,
): SourceRecord | undefined {
  const f245 = all(r, "245")[0];
  const title = cleanMarc(f245 ? sub(f245, "a") : undefined);
  if (!f245 || !title) return undefined;
  const part = [cleanMarc(sub(f245, "n")), cleanMarc(sub(f245, "p"))].filter(Boolean).join(": ");

  const authors: Creator[] = [];
  const editors: Creator[] = [];
  for (const f of r.fields.filter((x) => ["100", "110", "700", "710"].includes(x.tag))) {
    const creator = marcCreator(f);
    if (!creator) continue;
    const roles = relators(f);
    if (roles.some((x) => RELATOR_EDITOR.has(x))) editors.push(creator);
    else if (roles.some((x) => RELATOR_AUTHOR.has(x)) || (roles.length === 0 && f.tag === "100")) {
      authors.push(creator);
    }
  }

  const imprint = all(r, "264").find((f) => f.ind2 === "1") ?? all(r, "260")[0] ?? all(r, "264")[0];
  const place = cleanMarc(imprint ? sub(imprint, "a") : undefined)
    ?.replace(/\s*\[(?:u\.\s?a\.|etc\.?)\]/gi, "")
    .split(/\s*;\s*/)[0];
  const publisher = cleanMarc(imprint ? sub(imprint, "b") : undefined);

  const f041 = all(r, "041")[0];
  const f008 = r.control.get("008");
  const language = normalizeLanguage(
    (f041 ? sub(f041, "a") : undefined) ?? (f008 ? f008.slice(35, 38) : undefined),
  );

  const f250 = all(r, "250")[0];
  const f300 = all(r, "300")[0];
  const pages = f300
    ? /(\d+)\s*(?:S\.|Seiten|p\.|pages)/i.exec(sub(f300, "a") ?? "")?.[1]
    : undefined;
  const series = cleanMarc(all(r, "490")[0] ? sub(all(r, "490")[0] as MarcField, "a") : undefined);

  const doiField = all(r, "024").find((f) => sub(f, "2")?.toLowerCase() === "doi");

  const fields = compact<MetadataFields>({
    type: "book",
    title: cleanText(part ? `${title}: ${part}` : title),
    subtitle: cleanMarc(sub(f245, "b")),
    author: authors,
    editor: editors,
    issued: dateOf(r),
    publisher,
    "publisher-place": place,
    ISBN: opts.isbn,
    DOI: doiField ? sub(doiField, "a")?.toLowerCase() : undefined,
    language,
    edition: cleanMarc(f250 ? sub(f250, "a") : undefined),
    "collection-title": series,
    "number-of-pages": pages,
    ids: compact<Record<string, string>>({
      dnb:
        opts.source === "dnb"
          ? all(r, "016")[0]?.sub.find((s) => s.code === "a")?.value
          : undefined,
      ppn: opts.source === "k10plus" ? r.control.get("001") : undefined,
    }),
  });

  const toc = all(r, "856")
    .filter((f) => /inhaltsverzeichnis/i.test(sub(f, "3") ?? ""))
    .map((f) => sub(f, "u"))[0];
  const enrichment: Enrichment = compact<Enrichment>({ tocUrl: toc });
  return makeRecord(opts.source, opts.isbn, fetchedAtMs, fields, enrichment);
}

/** Runs an SRU query and maps the best matching record. */
export async function sruLookup(
  ctx: SourceContext,
  opts: MarcOptions & { url: string },
): Promise<SourceRecord | undefined> {
  const res = await ctx.http.get({
    source: opts.source,
    url: opts.url,
    accept: "application/xml",
  });
  if (res.status === 404) return undefined;
  if (!res.ok)
    throw new SourceError(opts.source, `HTTP ${res.status} for ${opts.isbn}`, res.status);
  const records = parseSru(res.body);
  const best = pickRecord(records, opts.isbn);
  return best ? marcToRecord(best, opts, res.fetchedAt) : undefined;
}
