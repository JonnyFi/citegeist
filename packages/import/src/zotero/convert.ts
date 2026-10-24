import { basename, extname } from "node:path";
import type { ItemDraft } from "@citegeist/cite";
import type { Creator } from "@citegeist/schema";
import { htmlToMarkdown, noteTitle } from "../html.js";
import type {
  ImportOptions,
  ImportProblem,
  SourceAnnotation,
  SourceAttachment,
  SourceBundle,
  SourceItem,
  SourceNote,
} from "../types.js";
import { usableCitekey } from "../util.js";
import {
  BASE_FIELD,
  CREATOR_TO_CSL,
  FIELD_TO_CSL,
  languageTag,
  PRIMARY_CREATOR,
  ZOTERO_TO_CSL_TYPE,
} from "./mapping.js";
import type { RawCreator, RawItem, RawLibrary } from "./raw.js";

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatParts(parts: number[]): number | string | undefined {
  const [y, m, d] = parts;
  if (y === undefined || y <= 0) return undefined;
  if (m === undefined) return y;
  const base = `${String(y).padStart(4, "0")}-${pad(m)}`;
  return d === undefined ? base : `${base}-${pad(d)}`;
}

/** Date parts from Zotero's SQL form ("2020-03-00 March 2020"), the API's parsed date or free text. */
export function zoteroDateParts(raw: string | undefined, parsed?: string): number[] | undefined {
  for (const candidate of [parsed, raw]) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:\s|$)/.exec(candidate?.trim() ?? "");
    if (m) {
      const parts = [Number(m[1])];
      if (Number(m[2]) > 0) {
        parts.push(Number(m[2]));
        if (Number(m[3]) > 0) parts.push(Number(m[3]));
      }
      return parts[0] ? parts : undefined;
    }
  }
  const text = (raw ?? "").replace(/^\d{4}-\d{2}-\d{2}\s+/, "");
  const year = /\b(\d{4})\b/.exec(text)?.[1];
  if (!year) return undefined;
  const lower = text.toLowerCase();
  const month = MONTHS.findIndex((name) => lower.includes(name.slice(0, 3)));
  const parts = [Number(year)];
  if (month >= 0) {
    parts.push(month + 1);
    const day = /\b(\d{1,2})\b/.exec(text.replace(year, ""))?.[1];
    if (day && Number(day) >= 1 && Number(day) <= 31) parts.push(Number(day));
  }
  return parts;
}

function normalizeDoi(raw: string): string {
  return raw
    .trim()
    .replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "")
    .trim();
}

/** Lines of `extra` that carry data, as Zotero and Better BibTeX write them. */
interface ExtraData {
  citationKey?: string;
  pmid?: string;
  pmcid?: string;
  arxiv?: string;
  doi?: string;
  rest: string;
}

export function parseExtra(extra: string | undefined): ExtraData {
  const rest: string[] = [];
  const out: ExtraData = { rest: "" };
  for (const line of (extra ?? "").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z][A-Za-z .-]*?)\s*:\s*(.+?)\s*$/.exec(line);
    const key = m?.[1]?.toLowerCase().replace(/[\s._-]+/g, "");
    const value = m?.[2];
    if (key && value) {
      if (key === "citationkey") {
        out.citationKey = value;
        continue;
      }
      if (key === "pmid") {
        out.pmid = value;
        continue;
      }
      if (key === "pmcid") {
        out.pmcid = value;
        continue;
      }
      if (key === "arxiv" || key === "arxivid") {
        out.arxiv = value.replace(/^arxiv:\s*/i, "");
        continue;
      }
      if (key === "doi") {
        out.doi = normalizeDoi(value);
        continue;
      }
    }
    rest.push(line);
  }
  out.rest = rest.join("\n").trim();
  return out;
}

function creatorOf(c: RawCreator): Creator | undefined {
  const name = c.name?.trim();
  if (name) return { literal: name };
  const family = c.last?.trim();
  const given = c.first?.trim();
  if (family) return given ? { family, given } : { family };
  return given ? { family: given } : undefined;
}

function creatorsByRole(itemType: string, creators: RawCreator[]): Record<string, Creator[]> {
  const out: Record<string, Creator[]> = {};
  const primary = PRIMARY_CREATOR[itemType];
  for (const c of creators) {
    const creator = creatorOf(c);
    if (!creator) continue;
    const role = c.type === primary ? "author" : (CREATOR_TO_CSL[c.type] ?? "contributor");
    const list = out[role] ?? [];
    list.push(creator);
    out[role] = list;
  }
  return out;
}

/** Field values by base field name: a type-specific field fills its base field when that is empty. */
function canonicalFields(fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  // Plain names first, so that an explicit base field wins over a type-specific one.
  for (const [k, v] of Object.entries(fields)) {
    if (v.trim() !== "" && !(k in BASE_FIELD)) out[k] = v.trim();
  }
  for (const [k, v] of Object.entries(fields)) {
    const base = BASE_FIELD[k];
    if (base && v.trim() !== "") out[base] ??= v.trim();
  }
  return out;
}

const NAMED_TITLE_FALLBACKS = ["shortTitle", "publicationTitle"];

/** Maps one regular Zotero item (not a note, attachment or annotation) to a draft. */
export function itemToDraft(item: RawItem, problems: ImportProblem[]): ItemDraft {
  const f = canonicalFields(item.fields);
  const extra = parseExtra(f.extra);
  const cslType = ZOTERO_TO_CSL_TYPE[item.itemType];
  if (!cslType) {
    problems.push({
      code: "ZOTERO_TYPE_UNKNOWN",
      severity: "warning",
      message: `item type '${item.itemType}' is not known, imported as a document`,
      ref: item.key,
    });
  }
  let title = f.title;
  if (!title) {
    title = NAMED_TITLE_FALLBACKS.map((k) => f[k]).find((v) => v) ?? "Untitled";
    problems.push({
      code: "TITLE_MISSING",
      severity: "info",
      message: `item has no title, using '${title}'`,
      ref: item.key,
    });
  }
  const draft: ItemDraft = {
    type: (cslType ?? "document") as ItemDraft["type"],
    title,
    zotero_type: item.itemType,
  };

  const roles = creatorsByRole(item.itemType, item.creators);
  for (const [role, list] of Object.entries(roles)) draft[role] = list;

  const issued = formatParts(zoteroDateParts(f.date, item.parsedDate) ?? []);
  if (issued !== undefined) draft.issued = issued;
  const accessParts = zoteroDateParts(f.accessDate);
  if (accessParts) draft.accessed = { "date-parts": [accessParts] };

  for (const [zotero, csl] of Object.entries(FIELD_TO_CSL)) {
    const v = f[zotero];
    if (v && !(csl in draft)) draft[csl] = v;
  }
  if (f.pages) draft.page = f.pages.replace(/\s*[–—]\s*/g, "-");
  if (f.url) draft.URL = f.url;
  const doi = f.DOI ? normalizeDoi(f.DOI) : extra.doi;
  if (doi) draft.DOI = doi;
  if (f.ISBN) draft.ISBN = f.ISBN;
  if (f.ISSN) draft.ISSN = f.ISSN;
  const language = languageTag(f.language);
  if (language) draft.language = language;
  if (extra.rest) draft.note = extra.rest;

  const ids: Record<string, string> = { zotero: item.key };
  const pmid = f.PMID ?? extra.pmid;
  if (pmid) ids.pmid = pmid;
  const pmcid = f.PMCID ?? extra.pmcid;
  if (pmcid) ids.pmcid = pmcid;
  const arxiv =
    extra.arxiv ??
    (item.itemType === "preprint" && /arxiv/i.test(f.publisher ?? "")
      ? f.number?.replace(/^arxiv:\s*/i, "")
      : undefined);
  if (arxiv) ids.arxiv = arxiv;
  draft.ids = ids;

  const usable = usableCitekey(f.citationKey ?? extra.citationKey);
  if (usable) draft.citekey = usable;
  return draft;
}

/** Collection path such as "Thesis/Chapter 2" for every collection key. */
export function collectionPaths(
  collections: readonly { key: string; name: string; parentKey?: string | undefined }[],
): Map<string, string> {
  const byKey = new Map(collections.map((c) => [c.key, c]));
  const paths = new Map<string, string>();
  for (const c of collections) {
    const names: string[] = [];
    const seen = new Set<string>();
    for (
      let cur: typeof c | undefined = c;
      cur && !seen.has(cur.key);
      cur = cur.parentKey ? byKey.get(cur.parentKey) : undefined
    ) {
      seen.add(cur.key);
      names.unshift(cur.name.replace(/\//g, "-").trim());
    }
    paths.set(c.key, names.join("/"));
  }
  return paths;
}

const SUPPORTED_TYPES: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/epub+zip": ".epub",
  "text/html": ".html",
};

function attachmentFilename(item: RawItem): string {
  const a = item.attachment;
  const fromPath = a?.path ? basename(a.path.replace(/^(?:storage|attachments):/, "")) : undefined;
  return a?.filename || fromPath || item.fields.title || `${item.key}.pdf`;
}

/** Why an attachment cannot be imported, or undefined when its type is supported. */
function unsupportedReason(item: RawItem): string | undefined {
  const a = item.attachment;
  if (!a) return "not an attachment";
  if (a.linkMode === "embedded_image") return "image inside a note";
  if (a.linkMode === "linked_url") return "web link without a file";
  const ext = extname(attachmentFilename(item)).toLowerCase();
  const type = (a.contentType ?? "").toLowerCase();
  if (type in SUPPORTED_TYPES || [".pdf", ".epub", ".html", ".htm"].includes(ext)) {
    // Snapshots of web pages are only worth keeping when Zotero downloaded them.
    if (type === "text/html" && a.linkMode === "linked_file") return "linked HTML file";
    return undefined;
  }
  return `file type ${type || ext || "unknown"} is not supported`;
}

function annotationOf(item: RawItem): SourceAnnotation | undefined {
  const a = item.annotation;
  if (!a) return undefined;
  return {
    ref: item.key,
    type: a.type,
    text: a.text,
    comment: a.comment,
    ...(a.color ? { color: a.color } : {}),
    ...(a.pageLabel ? { pageLabel: a.pageLabel } : {}),
    ...(a.sortIndex ? { sortIndex: a.sortIndex } : {}),
    position: a.position,
    tags: item.tags.map((t) => t.name),
  };
}

export interface ConvertOptions {
  options: Pick<
    ImportOptions,
    "attachments" | "notes" | "annotations" | "automaticTags" | "linkedFilesBase"
  >;
}

/** Turns the raw Zotero data into entries with notes, files and annotations attached. */
export async function bundleFromZotero(
  lib: RawLibrary,
  opts: ConvertOptions,
): Promise<SourceBundle> {
  const problems: ImportProblem[] = [];
  const paths = collectionPaths(lib.collections);
  const children = new Map<string, RawItem[]>();
  const tops: RawItem[] = [];
  const known = new Set(lib.items.map((i) => i.key));
  for (const it of lib.items) {
    if (it.parentKey) {
      if (!known.has(it.parentKey)) continue;
      const list = children.get(it.parentKey) ?? [];
      list.push(it);
      children.set(it.parentKey, list);
    } else tops.push(it);
  }

  const noteOf = (it: RawItem): SourceNote | undefined => {
    const md = htmlToMarkdown(it.note ?? "");
    if (md === "") return undefined;
    const title = noteTitle(md);
    return { ref: it.key, ...(title ? { title } : {}), markdown: md };
  };

  const attachmentOf = async (it: RawItem): Promise<SourceAttachment | undefined> => {
    const a = it.attachment;
    if (!a) return undefined;
    const unsupported = unsupportedReason(it);
    if (unsupported === "image inside a note" || unsupported === "web link without a file") {
      return undefined;
    }
    const filename = attachmentFilename(it);
    const att: SourceAttachment = {
      ref: it.key,
      filename,
      ...(a.contentType ? { contentType: a.contentType } : {}),
      linkMode: a.linkMode,
      ...(it.fields.url ? { url: it.fields.url } : {}),
      annotations: [],
    };
    if (unsupported) {
      att.missing = unsupported;
      return att;
    }
    if (opts.options.attachments) {
      const base = opts.options.linkedFilesBase;
      const found = await lib.resolveFile(it, { fetch: false, linkedFilesBase: base });
      if (found.path) att.path = found.path;
      if (found.missing) att.missing = found.missing;
      if (!found.path && !found.missing) {
        att.resolve = () => lib.resolveFile(it, { fetch: true, linkedFilesBase: base });
      }
    }
    if (opts.options.annotations) {
      for (const child of children.get(it.key) ?? []) {
        const ann = annotationOf(child);
        if (ann) att.annotations.push(ann);
      }
      att.annotations.sort((a, b) => (a.sortIndex ?? "").localeCompare(b.sortIndex ?? ""));
    }
    return att;
  };

  const items: SourceItem[] = [];
  const standaloneNotes: SourceNote[] = [];
  for (const it of tops) {
    if (it.itemType === "note") {
      if (opts.options.notes) {
        const n = noteOf(it);
        if (n) standaloneNotes.push(n);
      }
      continue;
    }
    if (it.itemType === "annotation") continue;
    const kids = children.get(it.key) ?? [];
    const attachments: SourceAttachment[] = [];
    const notes: SourceNote[] = [];

    if (it.itemType === "attachment") {
      // A file that sits in the library without a parent item becomes an item of its own.
      const att = await attachmentOf(it);
      const generic = /^(pdf|full text( pdf)?|snapshot|attachment|epub)$/i;
      const stem = att ? basename(att.filename, extname(att.filename)).replace(/[_]+/g, " ") : "";
      const own = it.fields.title && !generic.test(it.fields.title.trim()) ? it.fields.title : "";
      const draft = itemToDraft(
        {
          ...it,
          itemType: "document",
          fields: { ...it.fields, title: own || stem || "Untitled" },
        },
        problems,
      );
      draft.zotero_type = "attachment";
      items.push({
        ref: it.key,
        draft: applyTags(draft, it, opts.options.automaticTags),
        collections: it.collections.map((k) => paths.get(k)).filter((p): p is string => !!p),
        notes: [],
        attachments: att ? [att] : [],
        ...(it.dateAdded ? { dateAdded: it.dateAdded } : {}),
      });
      continue;
    }

    for (const kid of kids) {
      if (kid.itemType === "note" && opts.options.notes) {
        const n = noteOf(kid);
        if (n) notes.push(n);
      } else if (kid.itemType === "attachment") {
        const att = await attachmentOf(kid);
        if (att) attachments.push(att);
      }
    }
    items.push({
      ref: it.key,
      draft: applyTags(itemToDraft(it, problems), it, opts.options.automaticTags),
      collections: it.collections.map((k) => paths.get(k)).filter((p): p is string => !!p),
      notes,
      attachments,
      ...(it.dateAdded ? { dateAdded: it.dateAdded } : {}),
    });
  }

  return {
    label: lib.label,
    tag: "zotero",
    items,
    standaloneNotes,
    collections: [...paths.values()],
    problems,
    filesChecked: lib.canCheckFiles,
    ...(lib.dispose ? { dispose: lib.dispose } : {}),
  };
}

function applyTags(draft: ItemDraft, it: RawItem, automatic: boolean): ItemDraft {
  const names = it.tags.filter((t) => automatic || !t.auto).map((t) => t.name.trim());
  const tags = [...new Set(names.filter((n) => n !== ""))];
  if (tags.length > 0) draft.tags = tags;
  return draft;
}
