import { type Creator, CslType, ItemFrontmatter, Language } from "@citegeist/schema";

/** A CSL-JSON item. Loosely typed on purpose: CSL-JSON in the wild carries many optional variables. */
export type CslItem = { id: string; type: string } & Record<string, unknown>;

/** Frontmatter keys that belong to citegeist and never go into CSL-JSON. */
const INTERNAL_KEYS = new Set([
  "id",
  "citekey",
  "zotero_type",
  "subtitle",
  "ids",
  "tags",
  "projects",
  "status",
  "ai_language",
  "inbox",
  "sources",
  "provenance",
  "created",
  "modified",
  "title",
  "author",
  "editor",
  "issued",
]);

/** An item before it has an id, a timestamp and a final citekey. Produced by all importers. */
export type ItemDraft = Pick<ItemFrontmatter, "type" | "title"> &
  Partial<
    Pick<
      ItemFrontmatter,
      | "subtitle"
      | "author"
      | "editor"
      | "issued"
      | "container-title"
      | "volume"
      | "issue"
      | "page"
      | "publisher"
      | "publisher-place"
      | "DOI"
      | "ISBN"
      | "ISSN"
      | "URL"
      | "abstract"
      | "language"
      | "ids"
      | "tags"
      | "provenance"
    >
  > & {
    /** The key in the source file. May not be a valid Citekey; see resolveImportedCitekey. */
    citekey?: string;
    [csl: string]: unknown;
  };

export function parseDateValue(value: number | string | undefined): number[] | undefined {
  if (value === undefined) return undefined;
  const m = /^(-?\d{1,4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(String(value));
  if (!m) return undefined;
  const parts = [Number(m[1])];
  if (m[2]) parts.push(Number(m[2]));
  if (m[3]) parts.push(Number(m[3]));
  return parts;
}

/** [1984, 3] gives "1984-03"; [1984] gives the number 1984. */
export function formatDateValue(parts: readonly number[]): number | string | undefined {
  const [y, m, d] = parts;
  if (y === undefined || !Number.isFinite(y)) return undefined;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (m === undefined) return y;
  const base = `${String(y).padStart(4, "0")}-${pad(m)}`;
  return d === undefined ? base : `${base}-${pad(d)}`;
}

/** Title as CSL sees it: CSL has no subtitle variable, so the two are joined. */
export function fullTitle(item: Pick<ItemFrontmatter, "title" | "subtitle">): string {
  if (!item.subtitle) return item.title;
  return /[.:?!]$/.test(item.title)
    ? `${item.title} ${item.subtitle}`
    : `${item.title}: ${item.subtitle}`;
}

function creatorsToCsl(
  list: readonly Creator[] | undefined,
): Record<string, unknown>[] | undefined {
  if (!list || list.length === 0) return undefined;
  return list.map((c) => {
    if ("literal" in c) return { literal: c.literal };
    const { orcid: _orcid, ...rest } = c;
    return { ...rest };
  });
}

/** Maps item frontmatter to a CSL-JSON item whose `id` is the citekey. */
export function itemToCsl(item: ItemFrontmatter): CslItem {
  const out: CslItem = {
    id: item.citekey,
    type: item.type,
    "citation-key": item.citekey,
    title: fullTitle(item),
  };
  const author = creatorsToCsl(item.author);
  if (author) out.author = author;
  const editor = creatorsToCsl(item.editor);
  if (editor) out.editor = editor;
  const parts = parseDateValue(item.issued);
  if (parts) out.issued = { "date-parts": [parts] };
  for (const [key, value] of Object.entries(item)) {
    if (INTERNAL_KEYS.has(key) || value === undefined || value === null) continue;
    out[key] = value;
  }
  if (item.tags.length > 0) out.keyword = item.tags.join(", ");
  if (item.ids.pmid) out.PMID = item.ids.pmid;
  if (item.ids.pmcid) out.PMCID = item.ids.pmcid;
  return out;
}

function csl2creator(value: unknown): Creator | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  const str = (k: string) =>
    typeof v[k] === "string" && v[k] !== "" ? (v[k] as string) : undefined;
  const family = str("family");
  const literal = str("literal");
  const given = str("given");
  if (!family) {
    const lit = literal ?? given;
    return lit ? { literal: lit } : undefined;
  }
  const out: Record<string, string> = { family };
  if (given) out.given = given;
  for (const k of ["non-dropping-particle", "dropping-particle", "suffix"]) {
    const s = str(k);
    if (s) out[k] = s;
  }
  const orcid = str("orcid") ?? str("ORCID");
  if (orcid) out.orcid = orcid;
  return out as Creator;
}

function csl2creators(value: unknown): Creator[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.map(csl2creator).filter((c): c is Creator => c !== undefined);
  return list.length > 0 ? list : undefined;
}

function csl2date(value: unknown): number | string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as { "date-parts"?: unknown; raw?: unknown; literal?: unknown };
  const dp = v["date-parts"];
  if (Array.isArray(dp) && Array.isArray(dp[0])) {
    const nums = (dp[0] as unknown[]).map(Number).filter((n) => Number.isFinite(n));
    return formatDateValue(nums);
  }
  const text = typeof v.raw === "string" ? v.raw : typeof v.literal === "string" ? v.literal : "";
  const m = /(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/.exec(text);
  if (!m) return undefined;
  return formatDateValue([m[1], m[2], m[3]].filter((x) => x !== undefined).map(Number));
}

const IMPORT_SKIP = new Set([
  "id",
  "type",
  "title",
  "author",
  "editor",
  "issued",
  "citation-key",
  "keyword",
  "PMID",
  "PMCID",
  "_graph",
]);

/** Maps a CSL-JSON item to an ItemDraft. The CSL `citation-key` (or `id`) is kept as `citekey`. */
export function cslToDraft(csl: Record<string, unknown>): ItemDraft {
  const type = CslType.safeParse(csl.type);
  const draft: Record<string, unknown> = {
    type: type.success ? type.data : "document",
    title: typeof csl.title === "string" && csl.title.trim() !== "" ? csl.title.trim() : "Untitled",
  };
  const key = typeof csl["citation-key"] === "string" ? csl["citation-key"] : csl.id;
  if (typeof key === "string" && key !== "") draft.citekey = key;
  const author = csl2creators(csl.author);
  if (author) draft.author = author;
  const editor = csl2creators(csl.editor);
  if (editor) draft.editor = editor;
  const issued = csl2date(csl.issued);
  if (issued !== undefined) draft.issued = issued;
  for (const [k, v] of Object.entries(csl)) {
    if (IMPORT_SKIP.has(k) || v === undefined || v === null || v === "") continue;
    if (k === "language" && !Language.safeParse(v).success) continue;
    if (typeof v === "number") draft[k] = String(v);
    else draft[k] = v;
  }
  if (typeof csl.keyword === "string" && csl.keyword.trim() !== "") {
    draft.tags = csl.keyword
      .split(/\s*[,;]\s*/)
      .map((t) => t.trim())
      .filter((t) => t !== "");
  }
  const ids: Record<string, string> = {};
  if (csl.PMID !== undefined) ids.pmid = String(csl.PMID);
  if (csl.PMCID !== undefined) ids.pmcid = String(csl.PMCID);
  if (Object.keys(ids).length > 0) draft.ids = ids;
  return draft as ItemDraft;
}

export interface FinalizeOptions {
  /** ULID for the item. */
  id: string;
  /** ISO timestamp for `created`. */
  at: string;
  /** Actor that created the item, default "system". */
  by?: string;
  /** Provenance tag, for example "bibtex" or "ris". Fields present get "<tag>@<date>". */
  provenanceTag?: string;
}

/** Turns a draft plus a final citekey into a validated ItemFrontmatter. */
export function finalizeDraft(
  draft: ItemDraft,
  citekey: string,
  opts: FinalizeOptions,
): ItemFrontmatter {
  const provenance: Record<string, string> = { ...(draft.provenance ?? {}) };
  if (opts.provenanceTag) {
    const date = opts.at.slice(0, 10);
    for (const field of Object.keys(draft)) {
      if (["citekey", "ids", "tags", "provenance"].includes(field)) continue;
      provenance[field] ??= `${opts.provenanceTag}@${date}`;
    }
  }
  return ItemFrontmatter.parse({
    ...draft,
    id: opts.id,
    citekey,
    created: { at: opts.at, by: opts.by ?? "system" },
    provenance,
  });
}
