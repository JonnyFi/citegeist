import type { GraphLookup, VersionLink } from "@citegeist/metadata";
import { normalizeDoi } from "@citegeist/metadata";
import type { Actor } from "@citegeist/schema";
import { loadItem, saveItem } from "../ingest/items.js";
import type { Library } from "../library.js";

/** One entry of the frontmatter key `versions`. `relation` is the role of the item that holds it. */
export interface VersionEntry {
  /** Wiki link to the other item. items.rename rewrites it. */
  item: string;
  relation: "preprint-of" | "has-preprint";
  doi?: string;
  arxiv?: string;
  source: VersionLink["source"];
}

export interface VersionReport {
  checked: number;
  /** Pairs of items that are now linked (new links only). */
  linked: Array<{ preprint: string; published: string; source: VersionLink["source"] }>;
  /** Other versions the library does not hold, so they can be added. */
  available: Array<
    { citekey: string } & Pick<VersionLink, "relation" | "doi" | "arxiv" | "source">
  >;
  errors: Array<{ citekey: string; message: string }>;
}

export interface LinkVersionsOptions {
  citekeys?: string[] | undefined;
  signal?: AbortSignal | undefined;
  progress?: ((fraction: number, message?: string) => void) | undefined;
}

function entriesOf(value: unknown): VersionEntry[] {
  return Array.isArray(value)
    ? value.filter(
        (e): e is VersionEntry =>
          typeof e === "object" && e !== null && typeof (e as VersionEntry).item === "string",
      )
    : [];
}

/** The `versions` entries of an item, as saved in its frontmatter. */
export function versionsOf(lib: Library, citekey: string): VersionEntry[] {
  return entriesOf(loadItem(lib, citekey).file.data?.versions);
}

/** The published version of a preprint that the library holds too, read from the graph links. */
export function publishedVersionOf(
  lib: Library,
  citekey: string,
): { citekey: string; doi: string; venue?: string; year?: number } | undefined {
  for (const entry of versionsOf(lib, citekey)) {
    if (entry.relation !== "preprint-of") continue;
    const target = /^\[\[([^\]|#]+)/.exec(entry.item)?.[1]?.trim();
    if (!target) continue;
    let fm: ReturnType<Library["getItem"]>["frontmatter"];
    try {
      fm = lib.getItem(target).frontmatter;
    } catch {
      continue;
    }
    const doi = fm.DOI ? normalizeDoi(fm.DOI) : entry.doi;
    if (!doi) continue;
    const year = Number.parseInt(String(fm.issued ?? "").slice(0, 4), 10);
    return {
      citekey: target,
      doi,
      ...(fm["container-title"] ? { venue: fm["container-title"] } : {}),
      ...(Number.isInteger(year) ? { year } : {}),
    };
  }
  return undefined;
}

/**
 * The published version of a preprint that is not necessarily in the library: the first link of
 * `findVersions` that names a DOI for the preprint. Same sources and same order as `linkVersions`.
 */
export async function findPublished(
  lookup: Pick<GraphLookup, "findVersions">,
  key: { doi?: string | undefined; arxiv?: string | undefined },
): Promise<{ link?: VersionLink & { doi: string }; errors: string[] }> {
  const result = await lookup.findVersions({
    ...(key.doi ? { doi: key.doi } : {}),
    ...(key.arxiv ? { arxiv: key.arxiv } : {}),
  });
  const link = result.links.find(
    (l): l is VersionLink & { doi: string } => l.relation === "preprint-of" && !!l.doi,
  );
  return { ...(link ? { link } : {}), errors: result.errors };
}

function findOther(lib: Library, link: VersionLink, self: string): string | undefined {
  if (link.doi) {
    const row = lib.index.get<{ citekey: string }>(
      "SELECT citekey FROM items WHERE lower(doi) = ? AND citekey <> ?",
      link.doi.toLowerCase(),
      self,
    );
    if (row) return row.citekey;
  }
  if (link.arxiv) {
    const row = lib.index.get<{ citekey: string }>(
      "SELECT citekey FROM items WHERE lower(json_extract(frontmatter_json, '$.ids.arxiv')) = ? AND citekey <> ?",
      link.arxiv.toLowerCase(),
      self,
    );
    if (row) return row.citekey;
  }
  return undefined;
}

function addEntry(
  lib: Library,
  actor: Actor,
  citekey: string,
  entry: VersionEntry,
  today: string,
): boolean {
  const item = loadItem(lib, citekey);
  const current = entriesOf(item.file.data?.versions);
  if (current.some((e) => e.item === entry.item && e.relation === entry.relation)) return false;
  const provenance = { ...(item.fm.provenance ?? {}), versions: `${entry.source}@${today}` };
  saveItem(lib, actor, item, { versions: [...current, entry], provenance });
  return true;
}

/**
 * Finds the preprint or the published version of items and links the two items when the library
 * holds both: each gets a `versions` entry naming the other. A version the library does not hold
 * is reported in `available`. Links only ever join two items that exist, so a wrong DOI in a
 * source cannot attach an unrelated work.
 */
export async function linkVersions(
  lib: Library,
  lookup: Pick<GraphLookup, "findVersions">,
  actor: Actor,
  options: LinkVersionsOptions = {},
): Promise<VersionReport> {
  const rows = (
    options.citekeys
      ? options.citekeys.map((c) => c)
      : lib.index
          .all<{ citekey: string }>("SELECT citekey FROM items ORDER BY citekey")
          .map((r) => r.citekey)
  ).map((citekey) => ({ citekey, fm: lib.getItem(citekey).frontmatter }));
  const report: VersionReport = { checked: 0, linked: [], available: [], errors: [] };
  const today = lib.stamp(actor).at.slice(0, 10);

  for (const [i, { citekey, fm }] of rows.entries()) {
    options.signal?.throwIfAborted();
    const doi = fm.DOI ? normalizeDoi(fm.DOI) : undefined;
    const arxiv = fm.ids.arxiv;
    if (!doi && !arxiv) continue;
    options.progress?.(i / rows.length, `looking for other versions of ${citekey}`);
    let result: Awaited<ReturnType<GraphLookup["findVersions"]>>;
    try {
      result = await lookup.findVersions({ ...(doi ? { doi } : {}), ...(arxiv ? { arxiv } : {}) });
    } catch (err) {
      if (options.signal?.aborted) throw err;
      report.errors.push({
        citekey,
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    report.checked++;
    for (const message of result.errors) report.errors.push({ citekey, message });
    for (const link of result.links) {
      const other = findOther(lib, link, citekey);
      if (!other) {
        report.available.push({
          citekey,
          relation: link.relation,
          ...(link.doi ? { doi: link.doi } : {}),
          ...(link.arxiv ? { arxiv: link.arxiv } : {}),
          source: link.source,
        });
        continue;
      }
      const otherFm = lib.getItem(other).frontmatter;
      const mine: VersionEntry = {
        item: `[[${other}]]`,
        relation: link.relation,
        ...(otherFm.DOI ? { doi: otherFm.DOI.toLowerCase() } : {}),
        ...(otherFm.ids.arxiv ? { arxiv: otherFm.ids.arxiv } : {}),
        source: link.source,
      };
      const theirs: VersionEntry = {
        item: `[[${citekey}]]`,
        relation: link.relation === "preprint-of" ? "has-preprint" : "preprint-of",
        ...(doi ? { doi } : {}),
        ...(arxiv ? { arxiv } : {}),
        source: link.source,
      };
      const a = addEntry(lib, actor, citekey, mine, today);
      const b = addEntry(lib, actor, other, theirs, today);
      if (a || b) {
        report.linked.push({
          preprint: link.relation === "preprint-of" ? citekey : other,
          published: link.relation === "preprint-of" ? other : citekey,
          source: link.source,
        });
      }
    }
  }
  options.progress?.(1);
  return report;
}
