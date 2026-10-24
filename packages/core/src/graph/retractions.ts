import { isDeepStrictEqual } from "node:util";
import type { GraphLookup, RetractionNotice, RetractionStatus } from "@citegeist/metadata";
import { normalizeDoi } from "@citegeist/metadata";
import { RetractionMarker } from "@citegeist/ops";
import type { Actor, ItemFrontmatter } from "@citegeist/schema";
import { loadItem, saveItem } from "../ingest/items.js";
import type { Library } from "../library.js";

export type MarkerStatus = RetractionMarker["status"];

export interface FlaggedItem {
  citekey: string;
  status: MarkerStatus;
  notices: RetractionMarker["notices"];
  changed: boolean;
}

export interface RetractionReport {
  checked: number;
  flagged: FlaggedItem[];
  cleared: string[];
  skipped: number;
  errors: Array<{ citekey: string; message: string }>;
}

export interface CheckOptions {
  /** Check only these items. Default: every item with a DOI. */
  citekeys?: string[] | undefined;
  signal?: AbortSignal | undefined;
  progress?: ((fraction: number, message?: string) => void) | undefined;
}

const SEVERITY: Array<[RetractionNotice["kind"], MarkerStatus]> = [
  ["retraction", "retracted"],
  ["withdrawal", "withdrawn"],
  ["expression-of-concern", "concern"],
  ["correction", "corrected"],
];

/** The worst notice decides: retracted before withdrawn before concern before corrected. */
export function markerStatus(notices: RetractionNotice[]): MarkerStatus | undefined {
  for (const [kind, status] of SEVERITY) {
    if (notices.some((n) => n.kind === kind)) return status;
  }
  return undefined;
}

/** The marker an item carries in its frontmatter, or undefined. */
export function retractionOf(
  fm: ItemFrontmatter | Record<string, unknown>,
): RetractionMarker | undefined {
  const parsed = RetractionMarker.safeParse((fm as Record<string, unknown>).retraction);
  return parsed.success ? parsed.data : undefined;
}

/** Every item that carries a marker, worst first. For the library banner and for reports. */
export function listFlagged(
  lib: Library,
): Array<{ citekey: string; title: string; status: MarkerStatus }> {
  const rows = lib.index.all<{ citekey: string; title: string; status: MarkerStatus }>(
    `SELECT citekey, title, json_extract(frontmatter_json, '$.retraction.status') AS status
     FROM items WHERE json_extract(frontmatter_json, '$.retraction.status') IS NOT NULL`,
  );
  const rank = (s: MarkerStatus): number => SEVERITY.findIndex(([, st]) => st === s);
  return rows.sort((a, b) => rank(a.status) - rank(b.status) || a.citekey.localeCompare(b.citekey));
}

function sortNotices(notices: RetractionNotice[]): RetractionNotice[] {
  return [...notices].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
}

/** Provenance value of the marker: Crossref carries the publisher notices and Retraction Watch. */
function provenanceSource(notices: RetractionNotice[]): string {
  return notices.every((n) => n.source === "openalex") ? "openalex" : "crossref";
}

function sameMarker(a: RetractionMarker | undefined, b: RetractionMarker | undefined): boolean {
  if (!a || !b) return a === b;
  return a.status === b.status && isDeepStrictEqual(a.notices, b.notices);
}

/** DOIs of arXiv are DataCite: Crossref and Retraction Watch do not list them. */
function checkable(doi: string | undefined): string | undefined {
  const normalized = doi ? normalizeDoi(doi) : undefined;
  return normalized && !normalized.startsWith("10.48550/arxiv.") ? normalized : undefined;
}

/**
 * Checks items with a DOI for retraction and correction notices and writes the result into the
 * frontmatter: a `retraction` key (status, the notices, the date of the check) and the
 * provenance entry `retraction: crossref@<date>`. An item whose notices are gone loses the key.
 * An item that is unchanged is not written again, so a weekly run leaves the folder quiet.
 */
export async function checkRetractions(
  lib: Library,
  lookup: Pick<GraphLookup, "retractionStatus">,
  actor: Actor,
  options: CheckOptions = {},
): Promise<RetractionReport> {
  const rows = options.citekeys
    ? options.citekeys.map((citekey) => ({ citekey, doi: lib.getItem(citekey).frontmatter.DOI }))
    : lib.index
        .all<{ citekey: string; doi: string | null }>(
          "SELECT citekey, doi FROM items ORDER BY citekey",
        )
        .map((r) => ({ citekey: r.citekey, doi: r.doi ?? undefined }));
  const report: RetractionReport = { checked: 0, flagged: [], cleared: [], skipped: 0, errors: [] };
  const today = lib.stamp(actor).at.slice(0, 10);

  for (const [i, row] of rows.entries()) {
    options.signal?.throwIfAborted();
    const doi = checkable(row.doi);
    if (!doi) {
      report.skipped++;
      continue;
    }
    options.progress?.(i / rows.length, `checking ${row.citekey}`);
    let status: RetractionStatus;
    try {
      status = await lookup.retractionStatus(doi);
    } catch (err) {
      if (options.signal?.aborted) throw err;
      report.errors.push({
        citekey: row.citekey,
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    report.checked++;
    // A DOI no source knows says nothing: the marker stays as it is.
    if (!status.known) continue;

    const item = loadItem(lib, row.citekey);
    const before = retractionOf(item.fm);
    const notices = sortNotices(status.notices);
    const worst = markerStatus(notices);
    const after: RetractionMarker | undefined = worst
      ? { status: worst, notices, checked: today }
      : undefined;

    if (sameMarker(before, after)) {
      if (before) {
        report.flagged.push({
          citekey: row.citekey,
          status: before.status,
          notices: before.notices,
          changed: false,
        });
      }
      continue;
    }
    const provenance = { ...(item.fm.provenance ?? {}) };
    if (after) provenance.retraction = `${provenanceSource(notices)}@${today}`;
    else delete provenance.retraction;
    saveItem(lib, actor, item, { retraction: after, provenance });
    if (after) {
      report.flagged.push({ citekey: row.citekey, status: after.status, notices, changed: true });
    } else {
      report.cleared.push(row.citekey);
    }
  }
  options.progress?.(1);
  return report;
}
