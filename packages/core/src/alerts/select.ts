import type { AlertWork } from "@citegeist/metadata";
import type { AlertDef, AlertRun } from "@citegeist/ops";
import { findInLibrary } from "../graph/marking.js";
import type { Library } from "../library.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** How far back the first run of an alert looks. */
export const FIRST_LOOKBACK_DAYS = 7;
/** The window never reaches further back than this, however long the app stayed closed. */
export const MAX_LOOKBACK_DAYS = 30;

/** Scores texts against a query, one per text in 0..1, or undefined when nothing can rank. */
export type Ranker = (query: string, texts: string[]) => Promise<number[] | undefined>;

/** True when the alert should run: it is on and its interval has passed since the last run. */
export function isDue(
  alert: Pick<AlertDef, "enabled" | "intervalHours">,
  lastRun: Pick<AlertRun, "at"> | undefined,
  now: number,
): boolean {
  if (!alert.enabled) return false;
  if (!lastRun) return true;
  const last = Date.parse(lastRun.at);
  return Number.isNaN(last) || now - last >= alert.intervalHours * HOUR;
}

/** When the next run is due, or undefined for a paused alert. An alert that never ran is due now. */
export function nextRunAt(
  alert: Pick<AlertDef, "enabled" | "intervalHours">,
  lastRun: Pick<AlertRun, "at"> | undefined,
  now: number,
): string | undefined {
  if (!alert.enabled) return undefined;
  const last = lastRun ? Date.parse(lastRun.at) : Number.NaN;
  const at = Number.isNaN(last) ? now : Math.max(last + alert.intervalHours * HOUR, now);
  return new Date(at).toISOString();
}

/**
 * The first day of the window (YYYY-MM-DD). Sources know publication dates by the day, so the
 * window starts one day before the last successful run; the list of proposed works removes what
 * that day brings twice.
 */
export function windowStart(cursor: string | undefined, now: number): string {
  const earliest = now - MAX_LOOKBACK_DAYS * DAY;
  const parsed = cursor ? Date.parse(cursor) : Number.NaN;
  const from = Number.isNaN(parsed) ? now - FIRST_LOOKBACK_DAYS * DAY : parsed - DAY;
  return new Date(Math.max(from, earliest)).toISOString().slice(0, 10);
}

/** The keys that tell two records of one work apart from two works. */
export function workKeys(w: Pick<AlertWork, "doi" | "arxiv" | "openalex">): string[] {
  return [
    ...(w.doi ? [`doi:${w.doi.toLowerCase()}`] : []),
    ...(w.arxiv ? [`arxiv:${w.arxiv.toLowerCase()}`] : []),
    ...(w.openalex ? [`openalex:${w.openalex}`] : []),
  ];
}

/** The string items.add understands: the arXiv id first (it brings the full text), else the DOI. */
export function identifierOf(w: Pick<AlertWork, "doi" | "arxiv">): string | undefined {
  if (w.arxiv) return `arXiv:${w.arxiv}`;
  return w.doi;
}

export interface Dedupe {
  /** Works that are new, in the order the source gave them. */
  fresh: AlertWork[];
  /** Works that carry no DOI or arXiv id, so that nothing could be added. */
  unaddable: number;
  inLibrary: number;
  seen: number;
}

/**
 * Removes the works that are not new: repeats within the batch, works the alert proposed before,
 * works that sit in the library or in the inbox, and works without an identifier to add them by.
 */
export function dedupe(lib: Library, works: AlertWork[], seen: ReadonlySet<string>): Dedupe {
  const out: Dedupe = { fresh: [], unaddable: 0, inLibrary: 0, seen: 0 };
  const batch = new Set<string>();
  for (const w of works) {
    const keys = workKeys(w);
    if (keys.some((k) => batch.has(k))) continue;
    for (const k of keys) batch.add(k);
    if (!identifierOf(w)) {
      out.unaddable++;
      continue;
    }
    if (keys.some((k) => seen.has(k))) {
      out.seen++;
      continue;
    }
    if (findInLibrary(lib, w)) {
      out.inLibrary++;
      continue;
    }
    out.fresh.push(w);
  }
  return out;
}

/** The text the ranker compares with the brief: title and abstract. */
export function rankText(w: Pick<AlertWork, "title" | "abstract">): string {
  return [w.title, w.abstract].filter(Boolean).join("\n");
}

/** Characters of the brief that go into the ranking query. */
const QUERY_CHARS = 4000;

/**
 * Orders works by their similarity to the query, best first. Equal scores keep the order of the
 * source (newest first). Returns undefined when the ranker cannot score, so that the caller
 * keeps the order of the source.
 */
export async function rankWorks(
  works: AlertWork[],
  query: string,
  rank: Ranker | undefined,
): Promise<AlertWork[] | undefined> {
  const q = query.trim().slice(0, QUERY_CHARS);
  if (!rank || q === "" || works.length === 0) return undefined;
  let scores: number[] | undefined;
  try {
    scores = await rank(q, works.map(rankText));
  } catch {
    return undefined;
  }
  if (!scores || scores.length !== works.length) return undefined;
  return works
    .map((work, i) => ({ work, i, score: scores[i] ?? 0 }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((r) => r.work);
}
