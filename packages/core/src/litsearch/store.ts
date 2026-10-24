import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  LitsearchPaper,
  LitsearchRunMeta,
  LitsearchRunStatus,
  LitsearchRunSummary,
  LitsearchStage,
} from "@citegeist/ops";
import { csvRecords } from "./csv.js";

// Reads the run folders that workers/research writes: run.json (written by the runner here and by
// watch.py), papers.csv (render.write_csv) and progress.jsonl (pipeline.py --progress-jsonl).

/** A paper of papers.csv before the library marks it. */
export type RunPaper = Omit<LitsearchPaper, "status" | "citekey">;

const STATUSES = new Set<LitsearchRunStatus>([
  "running",
  "done",
  "failed",
  "cancelled",
  "interrupted",
]);

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const int = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isInteger(v) ? v : undefined;
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];

function counts(v: unknown): Record<string, number> {
  if (!v || typeof v !== "object") return {};
  return Object.fromEntries(
    Object.entries(v).filter((e): e is [string, number] => Number.isInteger(e[1]) && e[1] >= 0),
  );
}

/** run.json of a run folder, or undefined when the folder is not a run. */
export function readRunMeta(dir: string, id: string): LitsearchRunMeta | undefined {
  const raw = readJson(join(dir, "run.json"));
  if (!raw) return undefined;
  const status = str(raw.status) as LitsearchRunStatus | undefined;
  return {
    id,
    topic: str(raw.topic) ?? id,
    status: status && STATUSES.has(status) ? status : "interrupted",
    queries: strings(raw.queries),
    ...(int(raw.since) !== undefined ? { since: int(raw.since) } : {}),
    ...(int(raw.top) !== undefined ? { top: int(raw.top) } : {}),
    created: str(raw.created) ?? "",
    ...(str(raw.finished) ? { finished: str(raw.finished) } : {}),
    counts: counts(raw.counts),
    ...(str(raw.watchlist) ? { watch: str(raw.watchlist) } : {}),
    droppedQueries: strings(raw.dropped_queries),
    attempts: int(raw.attempts) ?? 0,
    ...(str(raw.error) ? { error: str(raw.error) } : {}),
  };
}

/** What a run needs to start again: its pid while running and the sources it switched off. */
export function readRunState(dir: string): { pid?: number; disableSources: string[] } {
  const raw = readJson(join(dir, "run.json")) ?? {};
  const pid = int(raw.pid);
  return { ...(pid && pid > 0 ? { pid } : {}), disableSources: strings(raw.disabled_sources) };
}

/** All runs under `runsDir`, newest first. */
export function listRunSummaries(runsDir: string): LitsearchRunSummary[] {
  if (!existsSync(runsDir)) return [];
  const runs: LitsearchRunSummary[] = [];
  for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const meta = readRunMeta(join(runsDir, entry.name), entry.name);
    if (!meta) continue;
    const { droppedQueries: _d, attempts: _a, error: _e, ...summary } = meta;
    runs.push(summary);
  }
  return runs.sort((a, b) => b.created.localeCompare(a.created) || b.id.localeCompare(a.id));
}

/** The same key as workers/research/scripts/papers.py: OpenAlex id, else a hash of DOI or title. */
export function paperKey(row: Record<string, string>): string {
  const oid = (row.openalex_id ?? "").trim();
  if (/^W\d+$/.test(oid)) return oid;
  const basis = (row.verified_doi || row.doi || row.title || "").toLowerCase();
  return `p${createHash("sha1").update(basis, "utf8").digest("hex").slice(0, 12)}`;
}

const num = (s: string | undefined): number | undefined => {
  if (s === undefined || s.trim() === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};
const intOf = (s: string | undefined): number | undefined => {
  const n = num(s);
  return n !== undefined && Number.isInteger(n) ? n : undefined;
};
const list = (s: string | undefined): string[] =>
  (s ?? "")
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean);
const opt = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> =>
  value === undefined || value === "" ? {} : ({ [key]: value } as Record<K, V>);

const SECTIONS = new Set(["main", "preprint", "grey", "rejected"]);

/** papers.csv of a run as typed rows, in file order. Rows with an unknown section are skipped. */
export function readRunPapers(dir: string): RunPaper[] {
  const path = join(dir, "papers.csv");
  if (!existsSync(path)) return [];
  const seen = new Set<string>();
  const papers: RunPaper[] = [];
  for (const row of csvRecords(readFileSync(path, "utf8"))) {
    if (!SECTIONS.has(row.section ?? "")) continue;
    const key = paperKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    const citedBy = intOf(row.cited_by_count);
    const hIndex = intOf(row.max_h_index);
    papers.push({
      key,
      section: row.section as RunPaper["section"],
      ...opt("rank", intOf(row.rank)),
      score: num(row.score) ?? 0,
      scoreParts: {
        relevance: num(row.score_relevance) ?? 0,
        venue: num(row.score_venue) ?? 0,
        author: num(row.score_author) ?? 0,
        citations: num(row.score_citations) ?? 0,
      },
      why: row.why_selected ?? "",
      foundVia: row.found_via ?? "",
      title: row.title ?? "",
      authors: list(row.authors),
      ...opt("year", intOf(row.year)),
      venue: row.venue ?? "",
      ...opt("venueTier", intOf(row.venue_tier)),
      type: row.type ?? "",
      ...opt("doi", row.verified_doi || row.doi),
      verified: Boolean(row.verified_doi),
      ...opt("arxiv", row.arxiv_id),
      ...opt("openalex", /^W\d+$/.test(row.openalex_id ?? "") ? row.openalex_id : undefined),
      ...opt("citedBy", citedBy !== undefined && citedBy >= 0 ? citedBy : undefined),
      ...opt("citationsPerYear", num(row.citations_per_year)),
      ...opt("fwci", num(row.fwci)),
      ...opt("maxHIndex", hIndex !== undefined && hIndex >= 0 ? hIndex : undefined),
      abstract: row.abstract ?? "",
      summary: row.summary ?? "",
      queries: list(row.queries),
      ...opt("link", row.link),
      ...opt("rejectedReason", row.rejected_reason),
      ...opt("reviewStatus", row.openreview_status),
    });
  }
  return papers;
}

interface ProgressEvent {
  type?: string;
  stage?: string;
  status?: string;
  seconds?: number;
  done?: number;
  total?: number;
  label?: string;
  msg?: string;
  stages?: Array<{ id?: string; label?: string }>;
}

/** Stage states from progress events, in plan order. Unknown events are ignored. */
export function stagesFromEvents(events: Iterable<ProgressEvent>): {
  stages: LitsearchStage[];
  error?: string;
} {
  const stages = new Map<string, LitsearchStage>();
  let error: string | undefined;
  const at = (id: string): LitsearchStage => {
    let s = stages.get(id);
    if (!s) {
      s = { id, label: id, status: "pending" };
      stages.set(id, s);
    }
    return s;
  };
  for (const e of events) {
    if (e.type === "plan" && Array.isArray(e.stages)) {
      for (const p of e.stages) if (p.id) at(p.id).label = p.label ?? p.id;
    } else if (e.type === "stage" && e.stage) {
      const s = at(e.stage);
      if (e.status === "started") s.status = "running";
      else if (e.status === "finished") {
        s.status = "done";
        if (typeof e.seconds === "number" && e.seconds >= 0) s.seconds = e.seconds;
      } else if (e.status === "failed") s.status = "failed";
      else if (e.status === "skipped") s.status = "skipped";
    } else if (e.type === "counter" && e.stage) {
      const s = at(e.stage);
      if (Number.isInteger(e.done) && (e.done ?? -1) >= 0) s.done = e.done;
      if (Number.isInteger(e.total) && (e.total ?? -1) >= 0) s.total = e.total;
      if (e.label) s.note = e.label;
    } else if (e.type === "error" && e.msg) {
      error = e.msg;
    }
  }
  return { stages: [...stages.values()], ...(error ? { error } : {}) };
}

/** Parses progress.jsonl, skipping lines that are not JSON (a crash can cut the last one). */
export function readProgressEvents(dir: string): ProgressEvent[] {
  const path = join(dir, "progress.jsonl");
  if (!existsSync(path)) return [];
  const events: ProgressEvent[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as ProgressEvent);
    } catch {
      // a partial last line while the run writes
    }
  }
  return events;
}

/**
 * Share of the work done, 0 to 1: finished, failed and skipped stages over all planned stages,
 * with the running stage counted by its own counter.
 */
export function progressOf(stages: LitsearchStage[]): number {
  if (stages.length === 0) return 0;
  let done = 0;
  for (const s of stages) {
    if (s.status === "done" || s.status === "skipped" || s.status === "failed") done += 1;
    else if (s.status === "running" && s.total) done += Math.min(1, (s.done ?? 0) / s.total);
  }
  return Math.min(1, done / stages.length);
}
