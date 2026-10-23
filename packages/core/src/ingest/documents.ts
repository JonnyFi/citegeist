import { existsSync, readFileSync } from "node:fs";
import { Block, DerivedManifest } from "@citegeist/schema";
import type { Library } from "../library.js";
import { problem } from "./items.js";

export interface ReadInput {
  citekey: string;
  pages?: string | undefined;
  section?: string | undefined;
  blocks?: string[] | undefined;
  maxChars: number;
}

export interface ReadResult {
  markdown: string;
  truncated: boolean;
  manifest?: DerivedManifest;
}

interface Unit {
  /** The text of the block or marker, without trailing blank lines. */
  text: string;
  blockId?: string;
  /** Heading level, 0 for other units. */
  level: number;
  /** Page marker: index and label. */
  marker?: { index: number; label: string };
  /** Labels of inner `<!-- p:label -->` marks in this block. */
  inner: string[];
  /** Label of the page this unit starts on. */
  page?: string;
}

const MARKER = /^<!--\s*page\s+(\d+)\s+label=(.*?)\s*-->$/;
const INNER = /<!--\s*p:(.*?)\s*-->/g;
const BLOCK_END = /\s\^(b[0-9a-z]{6,12})\s*$/;
const HEADING = /^(#{1,6})\s+/;

/** Splits doc.md into units: page markers and blocks (paragraphs separated by blank lines). */
export function parseDocMd(md: string): Unit[] {
  const units: Unit[] = [];
  let page: string | undefined;
  for (const chunk of md.split(/\n[ \t]*\n/)) {
    const text = chunk.replace(/^\n+|\s+$/g, "");
    if (text === "") continue;
    const m = MARKER.exec(text);
    if (m) {
      page = m[2] ?? "";
      units.push({ text, level: 0, marker: { index: Number(m[1]), label: page }, inner: [] });
      continue;
    }
    const id = BLOCK_END.exec(text)?.[1];
    const heading = HEADING.exec(text);
    const inner = [...text.matchAll(INNER)].map((x) => x[1] ?? "");
    units.push({
      text,
      level: heading?.[1]?.length ?? 0,
      inner,
      ...(id ? { blockId: id } : {}),
      ...(page !== undefined ? { page } : {}),
    });
  }
  return units;
}

function labelsOf(units: Unit[]): string[] {
  const labels: string[] = [];
  for (const u of units) if (u.marker) labels.push(u.marker.label);
  return labels;
}

const isNumeric = (s: string): boolean => /^\d+$/.test(s);

/** Parses "12", "12-15", "iii-v" or "12,14,20-22" into predicate pieces over printed labels. */
function pageSelector(spec: string, labels: string[], citekey: string): Set<string> {
  const wanted = new Set<string>();
  const lower = labels.map((l) => l.toLowerCase());
  const missing = (label: string): never => {
    throw problem(
      "PAGE_NOT_FOUND",
      `printed page '${label}' is not in the converted text of ${citekey} (pages ${labels[0] ?? "?"} to ${labels[labels.length - 1] ?? "?"})`,
      "Use a printed page label from the document, or read by section or block ids.",
      { citekey, page: label, first: labels[0] ?? null, last: labels[labels.length - 1] ?? null },
    );
  };
  for (const part of spec.split(",")) {
    const p = part.trim();
    if (p === "") continue;
    const range = /^(.+?)\s*[-–]\s*(.+)$/.exec(p);
    const a = (range?.[1] ?? p).trim();
    const b = (range?.[2] ?? p).trim();
    if (isNumeric(a) && isNumeric(b)) {
      const lo = Number(a);
      const hi = Number(b);
      const hit = labels.filter((l) => isNumeric(l) && Number(l) >= lo && Number(l) <= hi);
      if (hit.length === 0) missing(p);
      for (const l of hit) wanted.add(l);
      continue;
    }
    const i = lower.indexOf(a.toLowerCase());
    const j = lower.lastIndexOf(b.toLowerCase());
    if (i < 0) missing(a);
    if (j < 0) missing(b);
    for (const l of labels.slice(i, j + 1)) wanted.add(l);
  }
  return wanted;
}

export function readDocument(lib: Library, input: ReadInput): ReadResult {
  const { frontmatter } = lib.getItem(input.citekey);
  const candidates = frontmatter.sources.filter((s) =>
    existsSync(lib.paths.docMd(input.citekey, s.hash)),
  );
  if (candidates.length === 0) {
    throw problem(
      "NOT_CONVERTED",
      `item ${input.citekey} has no converted text (${frontmatter.sources.length} source files)`,
      frontmatter.sources.length > 0
        ? "Call documents.convert for this item and poll the returned job with jobs.get."
        : "The item has no source file. Add a PDF to the item first.",
      { citekey: input.citekey, sources: frontmatter.sources.length },
      "do-first",
    );
  }
  const withPages = candidates.filter((s) => existsSync(lib.paths.pages(input.citekey, s.hash)));
  const source = (input.pages ? withPages[0] : undefined) ?? candidates[0];
  if (!source) throw problem("NOT_CONVERTED", "no source", "Call documents.convert.");
  const md = readFileSync(lib.paths.docMd(input.citekey, source.hash), "utf8");
  let units = parseDocMd(md);

  if (input.pages) {
    if (labelsOf(units).length === 0) {
      throw problem(
        "NO_PAGES",
        `the converted text of ${input.citekey} has no page marks, so a page range cannot be read`,
        "Read by section or block ids instead.",
        { citekey: input.citekey },
      );
    }
    const wanted = pageSelector(input.pages, labelsOf(units), input.citekey);
    units = units.filter((u) => {
      if (u.marker) return wanted.has(u.marker.label);
      return (u.page !== undefined && wanted.has(u.page)) || u.inner.some((l) => wanted.has(l));
    });
  }

  if (input.section) {
    units = sectionUnits(lib, input.citekey, source.hash, units, input.section);
    if (units.length === 0) {
      throw problem(
        "SECTION_NOT_FOUND",
        `no section '${input.section}' in the converted text of ${input.citekey}`,
        "Use the heading text or its number (for example '2.1'); read without a filter to see the headings.",
        { citekey: input.citekey, section: input.section },
      );
    }
  }

  if (input.blocks && input.blocks.length > 0) {
    const ids = new Set(input.blocks.map((b) => b.replace(/^\^/, "")));
    const hit = units.filter((u) => u.blockId && ids.has(u.blockId));
    const found = new Set(hit.map((u) => u.blockId));
    const missing = [...ids].filter((i) => !found.has(i));
    if (missing.length > 0) {
      throw problem(
        "BLOCK_NOT_FOUND",
        `block ids not found in ${input.citekey}: ${missing.join(", ")}`,
        "Block ids change after a re-conversion; look them up again with search.query.",
        { citekey: input.citekey, missing },
      );
    }
    units = withPageContext(units, hit);
  }

  const { markdown, truncated } = render(units, input.maxChars);
  const manifestPath = lib.paths.derivedManifest(input.citekey, source.hash);
  let manifest: DerivedManifest | undefined;
  if (existsSync(manifestPath)) {
    const m = DerivedManifest.safeParse(JSON.parse(readFileSync(manifestPath, "utf8")));
    if (m.success) manifest = m.data;
  }
  return { markdown, truncated, ...(manifest ? { manifest } : {}) };
}

/** Selected units, each preceded by the page marker of its page when the marker was not selected. */
function withPageContext(all: Unit[], selected: Unit[]): Unit[] {
  const markers = new Map<string, Unit>();
  for (const u of all) if (u.marker) markers.set(u.marker.label, u);
  const out: Unit[] = [];
  let lastPage: string | undefined;
  for (const u of selected) {
    if (u.page !== undefined && u.page !== lastPage) {
      const marker = markers.get(u.page);
      if (marker) out.push(marker);
      lastPage = u.page;
    }
    out.push(u);
  }
  return out;
}

function sectionUnits(
  lib: Library,
  citekey: string,
  hash: string,
  units: Unit[],
  section: string,
): Unit[] {
  const secOf = new Map<string, string>();
  const blocksPath = lib.paths.blocks(citekey, hash);
  if (existsSync(blocksPath)) {
    for (const line of readFileSync(blocksPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const b = Block.safeParse(JSON.parse(line));
      if (b.success && b.data.type === "heading" && b.data.sec) secOf.set(b.data.id, b.data.sec);
    }
  }
  const wanted = section.trim().toLowerCase();
  const titleOf = (u: Unit): string =>
    u.text.replace(HEADING, "").replace(BLOCK_END, "").trim().toLowerCase();
  const start = units.findIndex(
    (u) =>
      u.level > 0 &&
      (secOf.get(u.blockId ?? "")?.toLowerCase() === wanted ||
        titleOf(u) === wanted ||
        titleOf(u).replace(/^[\d.]+\s+/, "") === wanted),
  );
  const first =
    start >= 0 ? start : units.findIndex((u) => u.level > 0 && titleOf(u).includes(wanted));
  if (first < 0) return [];
  const head = units[first];
  if (!head) return [];
  let end = units.length;
  for (let i = first + 1; i < units.length; i++) {
    const u = units[i];
    if (u && u.level > 0 && u.level <= head.level) {
      end = i;
      break;
    }
  }
  return withPageContext(
    units,
    units.slice(first, end).filter((u) => !u.marker),
  );
}

function render(units: Unit[], maxChars: number): { markdown: string; truncated: boolean } {
  const parts: string[] = [];
  let used = 0;
  for (const u of units) {
    const add = u.text.length + (parts.length > 0 ? 2 : 0);
    if (used + add > maxChars) {
      if (parts.length === 0) {
        return { markdown: `${u.text.slice(0, maxChars)}\n`, truncated: true };
      }
      return { markdown: `${parts.join("\n\n")}\n`, truncated: true };
    }
    parts.push(u.text);
    used += add;
  }
  return { markdown: parts.length > 0 ? `${parts.join("\n\n")}\n` : "", truncated: false };
}
