import type { Creator, ItemFrontmatter } from "@citegeist/schema";
import { isoLanguage } from "./bibtex.js";
import { formatDateValue, fullTitle, type ItemDraft, parseDateValue } from "./csl.js";

export interface RisParseResult {
  items: ItemDraft[];
  errors: string[];
}

const RIS_TO_CSL_TYPE: Record<string, string> = {
  JOUR: "article-journal",
  EJOUR: "article-journal",
  JFULL: "article-journal",
  ABST: "article-journal",
  MGZN: "article-magazine",
  NEWS: "article-newspaper",
  BOOK: "book",
  EBOOK: "book",
  EDBOOK: "book",
  CHAP: "chapter",
  ECHAP: "chapter",
  CONF: "paper-conference",
  CPAPER: "paper-conference",
  THES: "thesis",
  RPRT: "report",
  ELEC: "webpage",
  BLOG: "post-weblog",
  UNPB: "manuscript",
  MANSCPT: "manuscript",
  COMP: "software",
  DATA: "dataset",
  PAT: "patent",
  SER: "periodical",
  GEN: "document",
};

const CSL_TO_RIS_TYPE: Record<string, string> = {
  "article-journal": "JOUR",
  "article-magazine": "MGZN",
  "article-newspaper": "NEWS",
  book: "BOOK",
  chapter: "CHAP",
  "paper-conference": "CPAPER",
  thesis: "THES",
  report: "RPRT",
  webpage: "ELEC",
  "post-weblog": "BLOG",
  manuscript: "UNPB",
  software: "COMP",
  dataset: "DATA",
  patent: "PAT",
  periodical: "SER",
};

function risName(raw: string): Creator | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  if (!value.includes(",")) return { literal: value };
  const [last = "", second = "", third = ""] = value.split(",").map((s) => s.trim());
  // "Last, First" or "Last, First, Suffix" (RIS puts the suffix last)
  const given = second;
  const suffix = third;
  const particle = /^((?:\p{Ll}+['’]?\s+)+)(\p{Lu}.*)$/u.exec(last);
  const out: Record<string, string> = { family: particle ? (particle[2] ?? last) : last };
  if (particle?.[1]) out["non-dropping-particle"] = particle[1].trim();
  if (given) out.given = given;
  if (suffix) out.suffix = suffix;
  return out as Creator;
}

function risDate(value: string | undefined): number | string | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split("/").map((p) => p.trim());
  const year = y ? /-?\d{1,4}/.exec(y)?.[0] : undefined;
  if (year === undefined) return undefined;
  const parts = [Number(year)];
  if (m && /^\d{1,2}$/.test(m)) parts.push(Number(m));
  if (m && d && /^\d{1,2}$/.test(d)) parts.push(Number(d));
  return formatDateValue(parts);
}

/** Reads RIS into item drafts. `ID` becomes `citekey` when present. */
export function parseRis(input: string): RisParseResult {
  const items: ItemDraft[] = [];
  const errors: string[] = [];
  let current: [string, string][] | undefined;
  let last: [string, string] | undefined;
  const flush = () => {
    if (!current) return;
    const draft = risRecord(current, errors);
    if (draft) items.push(draft);
    current = undefined;
    last = undefined;
  };
  for (const line of input.replace(/^﻿/, "").split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9]) {2}-\s?(.*)$/.exec(line);
    if (!m) {
      if (last && line.trim() !== "") last[1] = `${last[1]} ${line.trim()}`;
      continue;
    }
    const tag = m[1] ?? "";
    const value = (m[2] ?? "").trim();
    if (tag === "TY") {
      flush();
      current = [];
    }
    if (tag === "ER") {
      flush();
      continue;
    }
    if (!current) continue;
    last = [tag, value];
    current.push(last);
  }
  flush();
  return { items, errors };
}

function risRecord(rows: [string, string][], errors: string[]): ItemDraft | undefined {
  const all = (...names: string[]) => rows.filter(([t]) => names.includes(t)).map(([, v]) => v);
  const first = (...names: string[]) => all(...names).find((v) => v !== "");
  const tyRaw = first("TY") ?? "GEN";
  const title = first("TI", "T1");
  if (!title) {
    errors.push(`RIS record of type ${tyRaw} has no title and was skipped`);
    return undefined;
  }
  const type = RIS_TO_CSL_TYPE[tyRaw] ?? "document";
  const draft: Record<string, unknown> = { type, title };
  const id = first("ID");
  if (id) draft.citekey = id;
  const author = all("AU", "A1")
    .map(risName)
    .filter((c): c is Creator => c !== undefined);
  if (author.length > 0) draft.author = author;
  const editor = all("ED", "A2")
    .map(risName)
    .filter((c): c is Creator => c !== undefined);
  if (editor.length > 0) draft.editor = editor;
  const issued = risDate(first("DA")) ?? risDate(first("PY", "Y1"));
  if (issued !== undefined) draft.issued = issued;
  const container = first("JF", "JO", "T2", "BT");
  if (container) draft["container-title"] = container;
  const series = first("T3");
  if (series) draft["collection-title"] = series;
  const volume = first("VL");
  if (volume) draft.volume = volume;
  const issue = first("IS");
  if (issue) draft.issue = issue;
  const sp = first("SP");
  const ep = first("EP");
  if (sp) draft.page = ep && !sp.includes("-") ? `${sp}-${ep}` : sp;
  const publisher = first("PB");
  if (publisher) draft.publisher = publisher;
  const place = first("CY");
  if (place) draft["publisher-place"] = place;
  const abstract = first("AB", "N2");
  if (abstract) draft.abstract = abstract;
  const doi = first("DO");
  if (doi) draft.DOI = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
  const url = first("UR", "L1");
  if (url) draft.URL = url;
  for (const sn of all("SN").filter((v) => v !== "")) {
    const digits = sn.replace(/[^0-9Xx]/g, "");
    if (digits.length === 10 || digits.length === 13) draft.ISBN ??= sn;
    else draft.ISSN ??= sn;
  }
  const edition = first("ET");
  if (edition) draft.edition = edition;
  const note = first("N1");
  if (note) draft.note = note;
  const language = isoLanguage(first("LA"));
  if (language) draft.language = language;
  const tags = all("KW").filter((k) => k !== "");
  if (tags.length > 0) draft.tags = tags;
  return draft as ItemDraft;
}

function risCreator(c: Creator): string {
  if ("literal" in c) return c.literal;
  const family = [c["dropping-particle"], c["non-dropping-particle"], c.family]
    .filter(Boolean)
    .join(" ");
  return [family, c.given, c.suffix].filter((p): p is string => !!p).join(", ");
}

/** Writes items as RIS. Lines end with CRLF as the format requires. */
export function toRis(items: readonly ItemFrontmatter[]): string {
  const out: string[] = [];
  for (const item of items) {
    const lines: [string, string | undefined][] = [];
    lines.push(["TY", CSL_TO_RIS_TYPE[item.type] ?? "GEN"]);
    lines.push(["ID", item.citekey]);
    lines.push(["TI", fullTitle(item)]);
    for (const a of item.author ?? []) lines.push(["AU", risCreator(a)]);
    for (const e of item.editor ?? []) lines.push(["ED", risCreator(e)]);
    const container = item["container-title"];
    if (container) {
      const articleLike = item.type.startsWith("article") || item.type === "periodical";
      lines.push([articleLike ? "JO" : "T2", container]);
    }
    const rec = item as Record<string, unknown>;
    if (typeof rec["collection-title"] === "string") lines.push(["T3", rec["collection-title"]]);
    const parts = parseDateValue(item.issued);
    if (parts) {
      lines.push(["PY", String(parts[0])]);
      if (parts[1]) {
        const pad = (n: number) => String(n).padStart(2, "0");
        lines.push(["DA", `${parts[0]}/${pad(parts[1])}/${parts[2] ? pad(parts[2]) : ""}/`]);
      }
    }
    lines.push(["VL", item.volume], ["IS", item.issue]);
    if (item.page) {
      const m = /^(.+?)\s*[-–—]+\s*(.+)$/.exec(item.page);
      lines.push(["SP", m ? m[1] : item.page], ["EP", m ? m[2] : undefined]);
    }
    lines.push(["PB", item.publisher], ["CY", item["publisher-place"]]);
    lines.push(["AB", item.abstract?.replace(/\s*\n\s*/g, " ")]);
    lines.push(["DO", item.DOI], ["UR", item.URL]);
    lines.push(["SN", item.ISBN], ["SN", item.ISSN]);
    if (typeof rec.edition === "string") lines.push(["ET", rec.edition]);
    if (typeof rec.note === "string") lines.push(["N1", rec.note.replace(/\s*\n\s*/g, " ")]);
    lines.push(["LA", item.language]);
    for (const tag of item.tags) lines.push(["KW", tag]);
    for (const [tag, value] of lines) {
      if (value !== undefined && value !== "") out.push(`${tag}  - ${value}`);
    }
    out.push("ER  - ", "");
  }
  return out.join("\r\n");
}
