import { existsSync, readFileSync } from "node:fs";
import {
  arxivFromDoi,
  extractIdentifiers,
  type GraphLookup,
  normalizeDoi,
  type ReferencePage,
  type WorkRef,
} from "@citegeist/metadata";
import type { GraphWork, MarkedWork } from "@citegeist/ops";
import type { ItemFrontmatter } from "@citegeist/schema";
import { problem } from "../ingest/items.js";
import type { Library } from "../library.js";
import { type Counts, markWorks } from "./marking.js";

export type ReferenceSource = "refs.jsonl" | "crossref" | "openalex";

export interface ReferenceList {
  citekey: string;
  source?: ReferenceSource;
  total: number;
  references: MarkedWork[];
  counts: Counts;
  errors: string[];
}

export interface CitingList {
  citekey: string;
  total: number;
  citing: MarkedWork[];
  counts: Counts;
  next?: string;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Family names as the graph shows them: first three, then "et al." from five authors on. */
function familyNames(names: string[]): string | undefined {
  const families = names
    .map((n) => (n.includes(",") ? n.split(",")[0] : n.trim().split(/\s+/).pop()) ?? "")
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
  if (families.length === 0) return undefined;
  return families.length > 4 ? `${families.slice(0, 3).join(", ")} et al.` : families.join(", ");
}

interface RefsEntry {
  key?: unknown;
  raw?: unknown;
  title?: unknown;
  venue?: unknown;
  authors?: unknown;
  year?: unknown;
  doi?: unknown;
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;

/** One line of refs.jsonl (the worker's reference entry) as a graph work. */
export function workFromRefsEntry(entry: RefsEntry): GraphWork {
  const raw = str(entry.raw);
  const found = raw ? extractIdentifiers(raw, { stopAtReferences: false }) : [];
  const doi =
    normalizeDoi(str(entry.doi) ?? "") ?? found.find((i) => i.kind === "doi")?.value ?? undefined;
  const arxiv =
    (doi ? arxivFromDoi(doi) : undefined) ?? found.find((i) => i.kind === "arxiv")?.value;
  const authors = Array.isArray(entry.authors)
    ? familyNames(entry.authors.filter((a): a is string => typeof a === "string"))
    : undefined;
  const year = Number(str(entry.year)?.slice(0, 4));
  return {
    ...(str(entry.key) ? { key: str(entry.key) as string } : {}),
    ...(doi ? { doi } : {}),
    ...(arxiv ? { arxiv } : {}),
    ...(str(entry.title) ? { title: str(entry.title) as string } : {}),
    ...(authors ? { authors } : {}),
    ...(Number.isInteger(year) && year > 0 ? { year } : {}),
    ...(str(entry.venue) ? { container: str(entry.venue) as string } : {}),
    ...(raw ? { raw } : {}),
  };
}

/** The reference list a conversion left in refs.jsonl, from the first source that has one. */
export function readRefsJsonl(lib: Library, fm: ItemFrontmatter): GraphWork[] | undefined {
  const sources = [...fm.sources].sort(
    (a, b) => Number(b.role === "main") - Number(a.role === "main"),
  );
  for (const source of sources) {
    const file = lib.paths.refs(fm.citekey, source.hash);
    if (!existsSync(file)) continue;
    const works: GraphWork[] = [];
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        works.push(workFromRefsEntry(JSON.parse(line) as RefsEntry));
      } catch {
        // A damaged line costs one reference, not the list.
      }
    }
    if (works.length > 0) return works;
  }
  return undefined;
}

function keyOf(fm: ItemFrontmatter): { doi?: string; openalex?: string; arxiv?: string } {
  const doi = fm.DOI ? normalizeDoi(fm.DOI) : undefined;
  const openalex = fm.ids.openalex;
  const arxiv = fm.ids.arxiv;
  return {
    ...(doi ? { doi } : {}),
    ...(openalex ? { openalex } : {}),
    ...(arxiv ? { arxiv } : {}),
  };
}

function asWork(w: WorkRef): GraphWork {
  return w;
}

/**
 * The works an item cites. The reference list of the converted paper comes first, because it
 * is the list the author printed. Without a conversion the Crossref deposit follows, and OpenAlex
 * `referenced_works` is the last resort.
 */
export async function listReferences(
  lib: Library,
  lookup: GraphLookup,
  input: { citekey: string; limit: number },
): Promise<ReferenceList> {
  const { frontmatter: fm } = lib.getItem(input.citekey);
  const errors: string[] = [];
  const done = (source: ReferenceSource, total: number, works: GraphWork[]): ReferenceList => {
    const { marked, counts } = markWorks(lib, works.slice(0, input.limit));
    return { citekey: input.citekey, source, total, references: marked, counts, errors };
  };

  const local = readRefsJsonl(lib, fm);
  if (local) return done("refs.jsonl", local.length, local);

  const key = keyOf(fm);
  if (!key.doi && !key.openalex && !key.arxiv) {
    throw problem(
      "NO_REFERENCE_SOURCE",
      `item ${input.citekey} has no converted reference list and no DOI, arXiv id or OpenAlex id to look the references up`,
      "Convert the item's PDF with documents.convert, or set a DOI with items.update.",
      { citekey: input.citekey },
      "do-first",
    );
  }

  let page: ReferencePage | undefined;
  if (key.doi) {
    try {
      page = await lookup.crossrefReferences(key.doi, input.limit);
    } catch (err) {
      errors.push(`crossref: ${messageOf(err)}`);
    }
    if (page && page.total > 0) return done("crossref", page.total, page.works.map(asWork));
  }
  try {
    page = await lookup.openAlexReferences(key, input.limit);
  } catch (err) {
    errors.push(`openalex: ${messageOf(err)}`);
  }
  if (page && page.total > 0) return done("openalex", page.total, page.works.map(asWork));
  return {
    citekey: input.citekey,
    total: 0,
    references: [],
    counts: { library: 0, inbox: 0, new: 0 },
    errors,
  };
}

/** The works that cite an item, most cited first. */
export async function listCiting(
  lib: Library,
  lookup: GraphLookup,
  input: { citekey: string; limit: number; cursor?: string | undefined },
): Promise<CitingList> {
  const { frontmatter: fm } = lib.getItem(input.citekey);
  const key = keyOf(fm);
  if (!key.doi && !key.openalex && !key.arxiv) {
    throw problem(
      "NO_CITATION_SOURCE",
      `item ${input.citekey} has no DOI, arXiv id or OpenAlex id to look its citations up`,
      "Set a DOI with items.update.",
      { citekey: input.citekey },
      "do-first",
    );
  }
  let page: Awaited<ReturnType<GraphLookup["openAlexCiting"]>>;
  try {
    page = await lookup.openAlexCiting(key, { limit: input.limit, cursor: input.cursor });
  } catch (err) {
    throw problem(
      "GRAPH_SOURCE_UNAVAILABLE",
      `OpenAlex did not answer for ${input.citekey}: ${messageOf(err)}`,
      "Try again in a minute.",
      { citekey: input.citekey },
      "retry",
    );
  }
  if (!page) {
    return {
      citekey: input.citekey,
      total: 0,
      citing: [],
      counts: { library: 0, inbox: 0, new: 0 },
    };
  }
  const { marked, counts } = markWorks(lib, page.works.map(asWork));
  return {
    citekey: input.citekey,
    total: page.total,
    citing: marked,
    counts,
    ...(page.next ? { next: page.next } : {}),
  };
}
