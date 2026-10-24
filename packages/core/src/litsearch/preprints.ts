import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GraphLookup, ResolveResult } from "@citegeist/metadata";
import type { LitsearchPreprint } from "@citegeist/ops";
import type { Actor } from "@citegeist/schema";
import { writeFileAtomic } from "../fsutil.js";
import { findInLibrary } from "../graph/marking.js";
import { findPublished, publishedVersionOf, type VersionReport } from "../graph/versions.js";
import type { Library } from "../library.js";

/**
 * Whether a tracked preprint has a published version. There is one source of truth and one
 * detection: `graph/versions.ts` (Crossref relations, the arXiv journal reference, OpenAlex
 * locations).
 *
 * - The preprint is in the library and so is its published version: the relation is the
 *   `versions` link of the library graph, written by `linkVersions`. This module only reads it.
 * - Every other tracked preprint (not in the library, or published somewhere the library does not
 *   hold): the result of the same lookup is kept in `preprint-checks.json`, because the graph has
 *   no item to hang it on. It is a cache of that one lookup, not a second detection.
 *
 * workers/research/scripts/preprints.py only lists which preprints are tracked and where an
 * OpenReview decision stands.
 */

/** One entry of `preprints.py list --json`. */
export interface RawPreprint {
  id: string;
  title?: string;
  doi?: string;
  arxiv_id?: string;
  origins?: string[];
  or_checked?: string | null;
  openreview?: { status?: string; venue?: string } | null;
}

interface CheckEntry {
  checked: string;
  published?: { doi: string; venue: string; year?: number };
}

/** What the core needs from the metadata and graph layer to check preprints. */
export interface PreprintVersionTools {
  lookup: Pick<GraphLookup, "findVersions">;
  /** `GraphService.linkVersions`: links the preprint and its article when the library holds both. */
  link(actor: Actor, citekeys: string[]): Promise<VersionReport>;
  /** The metadata record of a DOI; `resolve` of the metadata resolver. */
  resolve(doi: string): Promise<Pick<ResolveResult, "status" | "fields">>;
}

/** A preprint is looked at again after this long (the weekly check stays cheap). */
export const RECHECK_MS = 6 * 24 * 60 * 60 * 1000;

function checksPath(lib: Library): string {
  return join(lib.paths.litsearchWatchesDir, "preprint-checks.json");
}

function readChecks(lib: Library): Record<string, CheckEntry> {
  const path = checksPath(lib);
  if (!existsSync(path)) return {};
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, CheckEntry>)
      : {};
  } catch {
    return {};
  }
}

function writeChecks(lib: Library, checks: Record<string, CheckEntry>): void {
  writeFileAtomic(checksPath(lib), `${JSON.stringify(checks, null, 2)}\n`);
}

/** The library item that is this preprint, if the library holds it. */
function libraryItemOf(lib: Library, raw: RawPreprint): string | undefined {
  const doi = raw.doi?.trim().toLowerCase();
  return findInLibrary(lib, {
    ...(doi ? { doi } : {}),
    ...(raw.arxiv_id ? { arxiv: raw.arxiv_id.replace(/v\d+$/, "") } : {}),
  });
}

function yearOf(value: string | number | undefined): number | undefined {
  const year = Number.parseInt(String(value ?? "").slice(0, 4), 10);
  return Number.isInteger(year) ? year : undefined;
}

/** The tracked preprints as the app shows them: the graph or the check cache says what is published. */
export function describePreprints(
  lib: Library,
  raws: RawPreprint[],
): { preprints: LitsearchPreprint[]; lastCheck?: string } {
  const checks = readChecks(lib);
  let last = "";
  const preprints = raws.map((raw): LitsearchPreprint => {
    const citekey = libraryItemOf(lib, raw);
    const fromGraph = citekey ? publishedVersionOf(lib, citekey) : undefined;
    const cached = checks[raw.id];
    const published = fromGraph ?? cached?.published;
    const acceptedAt =
      raw.openreview?.status === "accepted" && raw.openreview.venue
        ? raw.openreview.venue
        : undefined;
    const checked = [cached?.checked, raw.or_checked ?? undefined]
      .filter((c): c is string => Boolean(c))
      .sort()
      .pop();
    if (checked && checked > last) last = checked;
    return {
      id: raw.id,
      title: raw.title ?? "",
      ...(raw.doi ? { doi: raw.doi } : {}),
      ...(raw.arxiv_id ? { arxiv: raw.arxiv_id } : {}),
      status: published ? "published" : acceptedAt ? "accepted" : "preprint",
      from: raw.origins ?? [],
      ...(checked ? { checked } : {}),
      ...(published
        ? {
            published: {
              doi: published.doi,
              venue: published.venue ?? "",
              ...(published.year !== undefined ? { year: published.year } : {}),
            },
          }
        : {}),
      ...(acceptedAt && !published ? { acceptedAt } : {}),
    };
  });
  return { preprints, ...(last ? { lastCheck: last } : {}) };
}

export interface PreprintCheckResult {
  checked: number;
  /** Preprints for which this check found a published version the graph or the cache did not have. */
  published: string[];
  errors: Array<{ id: string; message: string }>;
}

export interface PreprintCheckOptions {
  /** Look at every tracked preprint, not only those not checked for `RECHECK_MS`. */
  force: boolean;
  now: Date;
  signal?: AbortSignal | undefined;
  progress?: ((fraction: number, message?: string) => void) | undefined;
}

/**
 * Checks tracked preprints with the detection of the library graph. Preprints that are in the
 * library go through `linkVersions` (which links two library items); the rest through the same
 * `findVersions` lookup. A DOI only counts once the metadata resolver finds it.
 */
export async function checkPreprints(
  lib: Library,
  tools: PreprintVersionTools,
  actor: Actor,
  raws: RawPreprint[],
  options: PreprintCheckOptions,
): Promise<PreprintCheckResult> {
  const checks = readChecks(lib);
  const result: PreprintCheckResult = { checked: 0, published: [], errors: [] };
  const stamp = options.now.toISOString();
  const due = raws.filter((raw) => {
    if (options.force) return true;
    if (checks[raw.id]?.published) return false;
    const last = checks[raw.id]?.checked;
    return !last || options.now.getTime() - Date.parse(last) >= RECHECK_MS;
  });

  const held = new Map<string, RawPreprint[]>();
  const outside: RawPreprint[] = [];
  for (const raw of due) {
    const citekey = libraryItemOf(lib, raw);
    if (citekey && publishedVersionOf(lib, citekey)) {
      // The graph already links it; nothing of this preprint lives in the cache.
      checks[raw.id] = { checked: stamp };
      continue;
    }
    if (citekey) held.set(citekey, [...(held.get(citekey) ?? []), raw]);
    else outside.push(raw);
  }

  /** A DOI the lookup names, accepted when the resolver finds it. Venue and year come from there. */
  const confirm = async (doi: string): Promise<CheckEntry["published"] | undefined> => {
    const record = await tools.resolve(doi);
    if (record.status !== "resolved") return undefined;
    const year = yearOf(record.fields.issued);
    return {
      doi,
      venue: record.fields["container-title"] ?? "",
      ...(year !== undefined ? { year } : {}),
    };
  };
  const record = async (raw: RawPreprint, doi: string | undefined): Promise<void> => {
    let published: CheckEntry["published"];
    try {
      published = doi ? await confirm(doi) : undefined;
    } catch (err) {
      if (options.signal?.aborted) throw err;
      result.errors.push({ id: raw.id, message: err instanceof Error ? err.message : String(err) });
      return;
    }
    checks[raw.id] = { checked: stamp, ...(published ? { published } : {}) };
    result.checked++;
    if (published) result.published.push(raw.id);
  };
  const total = held.size + outside.length;
  let done = 0;
  const step = (message: string): void => options.progress?.(total ? done / total : 1, message);

  try {
    if (held.size > 0) {
      options.signal?.throwIfAborted();
      step("linking library preprints with their articles");
      const report = await tools.link(actor, [...held.keys()]);
      for (const [citekey, group] of held) {
        const error = report.errors.find((e) => e.citekey === citekey);
        const linked = publishedVersionOf(lib, citekey);
        // The published version exists but the library does not hold it: linkVersions lists it.
        const available = report.available.find(
          (a) => a.citekey === citekey && a.relation === "preprint-of" && a.doi,
        );
        for (const raw of group) {
          if (error && !linked && !available) {
            result.errors.push({ id: raw.id, message: error.message });
          } else if (linked) {
            checks[raw.id] = { checked: stamp };
            result.checked++;
            result.published.push(raw.id);
          } else {
            await record(raw, available?.doi);
          }
        }
      }
      done += held.size;
    }
    for (const raw of outside) {
      options.signal?.throwIfAborted();
      step(`looking for a published version of ${raw.title || raw.id}`);
      done++;
      try {
        const found = await findPublished(tools.lookup, {
          doi: raw.doi,
          arxiv: raw.arxiv_id,
        });
        // A source that failed may have been the one that knows; look again next time.
        if (!found.link && found.errors.length > 0) {
          result.errors.push({ id: raw.id, message: found.errors.join("; ") });
          continue;
        }
        await record(raw, found.link?.doi);
      } catch (err) {
        if (options.signal?.aborted) throw err;
        result.errors.push({
          id: raw.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    writeChecks(lib, checks);
  }
  options.progress?.(1);
  return result;
}
