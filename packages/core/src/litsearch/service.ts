import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { planSuggestedQueries } from "@citegeist/ai";
import type {
  GraphWork,
  LitsearchPaper,
  LitsearchRunMeta,
  LitsearchRunSummary,
} from "@citegeist/ops";
import { type Actor, CitegeistError, type Job } from "@citegeist/schema";
import { writeFileAtomic } from "../fsutil.js";
import { markWorks } from "../graph/marking.js";
import type { JobContext, JobQueue } from "../jobs/queue.js";
import type { Library } from "../library.js";
import {
  checkPreprints,
  describePreprints,
  type PreprintVersionTools,
  type RawPreprint,
} from "./preprints.js";
import {
  type LitsearchCommand,
  type RunRequest,
  runPipeline,
  runScript,
  writeQueuedMeta,
} from "./runner.js";
import {
  listRunSummaries,
  progressOf,
  RUN_ID,
  type RunPaper,
  readProgressEvents,
  readRunMeta,
  readRunPapers,
  readRunState,
  stagesFromEvents,
} from "./store.js";

/** Bare lowercase DOI, as the library index stores it. */
function bareDoi(doi: string | undefined): string | undefined {
  const d = doi
    ?.trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
    .replace(/^doi:/, "");
  return d ? d : undefined;
}

/** Family name of "Ana Ruiz" or "Ruiz, Ana". */
function family(name: string): string {
  const n = name.trim();
  if (n.includes(",")) return n.split(",")[0]?.trim() ?? n;
  return n.split(/\s+/).pop() ?? n;
}

/** A paper as the citation graph describes works, for matching against the library. */
export function workOf(p: RunPaper): GraphWork {
  const doi = bareDoi(p.doi);
  return {
    ...(doi ? { doi } : {}),
    ...(p.openalex ? { openalex: p.openalex } : {}),
    ...(p.arxiv ? { arxiv: p.arxiv.replace(/v\d+$/, "") } : {}),
    ...(p.title ? { title: p.title } : {}),
    ...(p.year !== undefined ? { year: p.year } : {}),
    ...(p.authors.length ? { authors: p.authors.map(family).join(", ") } : {}),
  };
}

/**
 * Keys a paper is recognised by in another run: DOI, OpenAlex id and the normalised title (only
 * when it is longer than 15 characters).
 */
export function matchKeys(p: Pick<RunPaper, "doi" | "openalex" | "title">): string[] {
  const doi = (p.doi ?? "").toLowerCase();
  const title = p.title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]+/gu, " ")
    .trim();
  return [
    ...(doi ? [`doi:${doi}`] : []),
    ...(p.openalex ? [`oa:${p.openalex}`] : []),
    ...(title.length > 15 ? [`t:${title}`] : []),
  ];
}

const EXPORT_FILES = {
  md: "papers.md",
  csv: "papers.csv",
  bib: "references.bib",
  summaries: "summaries.md",
} as const;
const JOB_KIND = "litsearch.run";

/** Folder name of a new run: date and topic, like research-pipeline's. */
export function runIdFor(topic: string, date: Date, taken: (id: string) => boolean): string {
  const slug =
    topic
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/, "") || "run";
  const base = `${date.toISOString().slice(0, 10)}-${slug}`;
  let id = base;
  for (let n = 2; taken(id); n++) id = `${base}-${n}`;
  return id;
}

/**
 * True when `pid` runs on this machine. run.json is synced between Macs, so
 * a pid counts only together with the host that wrote it; without a host it is not trusted.
 */
function pidAlive(pid: number | undefined, host: string | undefined): boolean {
  if (!pid || host !== hostname()) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** One added paper, as items.add answers. */
interface Added {
  citekey: string;
  job: string;
  duplicateOf?: string | undefined;
}

/** What a run needs from the machine: how to start the scripts and what to pass them. */
export interface LitsearchDeps {
  /** items.add of the ingest service. "system" puts a paper into the inbox (D7). */
  addItem?: (
    actor: Actor,
    input: {
      identifier: string;
      projects: string[];
      tags: string[];
      target: "inbox" | "library";
      why?: string;
    },
  ) => Promise<Added>;
  /** DOI of an OpenAlex work, for papers without DOI or arXiv id in papers.csv. */
  openAlexDoi?: (openalex: string) => Promise<string | undefined>;
  /** Runs AI tasks with the routing the user set (litsearch.suggestQueries). */
  ai?: {
    run(
      task: "litsearch.suggestQueries",
      input: unknown,
      opts?: { actor?: string },
    ): Promise<{ output: unknown }>;
  };
  /** The job queue of the runtime. Without it (a one-shot CLI) runs cannot start. */
  queue?: JobQueue;
  command?: LitsearchCommand;
  /** workers/research/scripts */
  scriptsDir?: string;
  /** Machine-local lookup cache. */
  cacheDir?: string;
  /** The version detection of the library graph, which also decides when a tracked preprint is published. */
  versions?: PreprintVersionTools;
  /** OpenAlex key from the Keychain and the contact address from the settings, read per run. */
  credentials?: () => Promise<{ openalexKey?: string | undefined; mailto?: string | undefined }>;
  now?: () => Date;
}

/** What a pipeline alert hands to `alertSearch`. */
export interface AlertSearchInput {
  /** Id of the alert. The run is tagged with it, and the next check compares with the run before. */
  alert: string;
  topic: string;
  queries: string[];
  since?: number | undefined;
  top?: number | undefined;
  /** The run to compare with while the alert has no run of its own. */
  baseRun?: string | undefined;
  /** Keys (`matchKeys`) of the papers the alert offered before. */
  seen: ReadonlySet<string>;
  /** How many items to add to the inbox at most. */
  limit: number;
  projects: string[];
  /** The reason of an inbox item. */
  why(paper: { score: number; why: string; title: string }, runId: string): string;
}

export interface AlertSearchResult {
  runId: string;
  /** Papers of the run without the rejected ones. */
  fetched: number;
  /** New papers that were candidates for the inbox. */
  found: number;
  /** The items added to the inbox. */
  citekeys: string[];
  /** `matchKeys` of the papers that were offered, so that the alert does not offer them again. */
  proposed: string[];
}

const PREPRINTS_JOB = "litsearch.preprints";

interface PreprintsJobInput {
  /** True for the button of the app: check every tracked preprint, not only the due ones. */
  force: boolean;
}

interface RunJobInput {
  runId: string;
  request: RunRequest;
}

/** Runs of the literature search in <library>/research/runs. */
export class LitsearchService {
  constructor(
    private readonly lib: Library,
    private readonly deps: LitsearchDeps = {},
  ) {
    deps.queue?.register(JOB_KIND, (ctx) => this.runJob(ctx), { maxAttempts: 1 });
    deps.queue?.register(PREPRINTS_JOB, (ctx) => this.checkPreprints(ctx), { maxAttempts: 1 });
    if (deps.queue) this.endRecoveredJobs(deps.queue);
  }

  /**
   * The queue starts before this service registers its kinds, so a litsearch job that a crash left
   * behind (queued again by JobQueue.start) would wait forever and block every new run. They end
   * as cancelled here; the run itself reads as interrupted and the user resumes it on purpose.
   */
  private endRecoveredJobs(queue: JobQueue): void {
    for (const job of queue.open()) {
      if (job.kind === JOB_KIND) {
        queue.cancel(job.id, "interrupted by a restart of the app; resume the run to continue");
      } else if (job.kind === PREPRINTS_JOB) {
        queue.cancel(job.id, "interrupted by a restart of the app; check the preprints again");
      }
    }
  }

  runDir(runId: string): string {
    if (!RUN_ID.test(runId)) {
      throw new CitegeistError({
        code: "LITSEARCH_RUN_ID_INVALID",
        message: `"${runId}" is not a run id.`,
        fix: "Take the id from litsearch.runs.",
        recovery: "fix-and-retry",
        sideEffects: "none",
      });
    }
    return this.lib.paths.litsearchRunDir(runId);
  }

  /** The open job of a run, if one is queued or running. */
  private openJob(runId?: string): Job | undefined {
    return this.deps.queue
      ?.open()
      .find(
        (j) => j.kind === JOB_KIND && (!runId || (j.input as RunJobInput | null)?.runId === runId),
      );
  }

  /** `running` in run.json only while a job or process is alive; otherwise the run was interrupted. */
  private live<T extends { id: string; status: LitsearchRunSummary["status"] }>(meta: T): T {
    if (meta.status !== "running") return meta;
    if (this.openJob(meta.id)) return meta;
    const state = readRunState(this.lib.paths.litsearchRunDir(meta.id));
    if (pidAlive(state.pid, state.host)) return meta;
    return { ...meta, status: "interrupted" };
  }

  runs(input: { limit: number; cursor?: string | undefined }): {
    runs: LitsearchRunSummary[];
    next?: string;
  } {
    const all = listRunSummaries(this.lib.paths.litsearchRunsDir);
    const start = input.cursor ? Number.parseInt(input.cursor, 10) || 0 : 0;
    const page = all.slice(start, start + input.limit).map((r) => this.live(r));
    const end = start + page.length;
    return { runs: page, ...(end < all.length ? { next: String(end) } : {}) };
  }

  private meta(runId: string): LitsearchRunMeta {
    const dir = this.runDir(runId);
    const meta = existsSync(dir) ? readRunMeta(dir, runId) : undefined;
    if (!meta) {
      throw new CitegeistError({
        code: "LITSEARCH_RUN_NOT_FOUND",
        message: `There is no literature search run "${runId}".`,
        fix: "Take the id from litsearch.runs.",
        recovery: "fix-and-retry",
        sideEffects: "none",
      });
    }
    return this.live(meta);
  }

  get(runId: string) {
    const meta = this.meta(runId);
    const dir = this.runDir(runId);
    const { stages, error } = stagesFromEvents(readProgressEvents(dir));
    return {
      run: { ...meta, ...(meta.error || !error ? {} : { error }) },
      stages,
      papers: withNewInAlert(this.mark(readRunPapers(dir), dir), dir),
    };
  }

  /**
   * Marks each paper as in the library, in the inbox or new, like the citation graph does. A paper
   * this run sent to the inbox is found through inbox.json too, in case its metadata has not
   * arrived yet; a citekey the library no longer has (rejected in the inbox) counts as new.
   */
  mark(papers: RunPaper[], dir?: string): LitsearchPaper[] {
    const { marked } = markWorks(this.lib, papers.map(workOf));
    const sent = dir ? readSent(dir) : {};
    return papers.map((p, i) => {
      const m = marked[i];
      if (m && m.status !== "new") {
        return { ...p, status: m.status, ...(m.citekey ? { citekey: m.citekey } : {}) };
      }
      const citekey = sent[p.key]?.citekey;
      const row = citekey
        ? this.lib.index.get<{ inbox: number }>(
            "SELECT inbox FROM items WHERE citekey = ?",
            citekey,
          )
        : undefined;
      if (citekey && row) {
        return { ...p, status: row.inbox === 1 ? "inbox" : "library", citekey };
      }
      return { ...p, status: "new" };
    });
  }

  /**
   * What changed from run `a` to run `b`: papers only in `b`, papers `b` no longer has and papers
   * whose rank moved within the same section. Rejected papers do not count.
   */
  compare(a: string, b: string) {
    this.meta(a);
    this.meta(b);
    const load = (id: string) => {
      const dir = this.runDir(id);
      return this.mark(
        readRunPapers(dir).filter((p) => p.section !== "rejected"),
        dir,
      );
    };
    const before = load(a);
    const after = load(b);
    const index = (papers: LitsearchPaper[]) => {
      const map = new Map<string, LitsearchPaper>();
      for (const p of papers) for (const k of matchKeys(p)) if (!map.has(k)) map.set(k, p);
      return map;
    };
    const beforeByKey = index(before);
    const afterByKey = index(after);
    const find = (p: LitsearchPaper, map: Map<string, LitsearchPaper>) =>
      matchKeys(p)
        .map((k) => map.get(k))
        .find(Boolean);
    const byRank = (x: LitsearchPaper, y: LitsearchPaper) =>
      x.section.localeCompare(y.section) || (x.rank ?? 1e9) - (y.rank ?? 1e9);
    const added = after.filter((p) => !find(p, beforeByKey)).sort(byRank);
    const dropped = before.filter((p) => !find(p, afterByKey)).sort(byRank);
    const moved: Array<{ paper: LitsearchPaper; from: number; to: number }> = [];
    for (const p of after) {
      const old = find(p, beforeByKey);
      if (old && old.section === p.section && old.rank && p.rank && old.rank !== p.rank) {
        moved.push({ paper: p, from: old.rank, to: p.rank });
      }
    }
    moved.sort((x, y) => byRank(x.paper, y.paper));
    return { added, dropped, moved };
  }

  /**
   * Sends papers of a run to the inbox with the search as the reason (D7: as "system", so a human's
   * request still waits for review). Which paper became which item is kept in <run>/inbox.json.
   */
  async toInbox(input: { runId: string; keys: string[]; projects: string[] }) {
    const meta = this.meta(input.runId);
    return this.sendToInbox(
      input.runId,
      input.keys,
      input.projects,
      (p) =>
        `Literatursuche „${meta.topic}“: Score ${p.score.toFixed(1)}${p.why ? `, ${p.why}` : ""}`,
    );
  }

  private async sendToInbox(
    runId: string,
    keys: string[],
    projects: string[],
    whyOf: (paper: RunPaper) => string,
  ) {
    const dir = this.runDir(runId);
    const addItem = this.deps.addItem;
    if (!addItem) throw unavailable("adding papers needs the ingest service of the app");
    const papers = new Map(readRunPapers(dir).map((p) => [p.key, p]));
    const sent = readSent(dir);
    const results: Array<{
      key: string;
      identifier: string;
      status: "added" | "duplicate" | "failed";
      citekey?: string;
      job?: string;
      reason?: string;
    }> = [];
    for (const key of [...new Set(keys)]) {
      const p = papers.get(key);
      if (!p) {
        results.push({ key, identifier: key, status: "failed", reason: "not a paper of this run" });
        continue;
      }
      let identifier: string | undefined = p.doi ?? (p.arxiv ? `arXiv:${p.arxiv}` : undefined);
      if (!identifier && p.openalex && this.deps.openAlexDoi) {
        identifier = await this.deps.openAlexDoi(p.openalex).catch(() => undefined);
      }
      if (!identifier) {
        results.push({
          key,
          identifier: p.openalex ?? p.title,
          status: "failed",
          reason: "the paper has no DOI or arXiv id to look it up by",
        });
        continue;
      }
      try {
        const added = await addItem("system", {
          identifier,
          projects,
          tags: [],
          target: "inbox",
          why: whyOf(p),
        });
        const citekey = added.duplicateOf ?? added.citekey;
        sent[key] = { citekey, at: (this.deps.now ?? (() => new Date()))().toISOString() };
        results.push({
          key,
          identifier,
          status: added.duplicateOf ? "duplicate" : "added",
          citekey,
          job: added.job,
        });
      } catch (err) {
        results.push({
          key,
          identifier,
          status: "failed",
          reason: err instanceof CitegeistError ? err.detail.message : String(err),
        });
      }
    }
    writeFileAtomic(join(dir, "inbox.json"), `${JSON.stringify(sent, null, 2)}\n`);
    const count = (s: string) => results.filter((r) => r.status === s).length;
    return {
      results,
      added: count("added"),
      duplicates: count("duplicate"),
      failed: count("failed"),
    };
  }

  /** True while a literature search run is queued or running (one at a time per library). */
  busy(): boolean {
    return this.openJob() !== undefined;
  }

  /**
   * One check of a pipeline alert: starts a run for it as a `litsearch.run` job, waits for the run,
   * compares it with the alert's previous run and puts the best new papers into the inbox. The new
   * papers are those the previous run lacked, that are neither in the library nor in the inbox and
   * that the alert did not offer before. They go in by score, highest first, until `limit` items
   * were added. <run>/alert.json lists them, so the run view can flag them.
   */
  async alertSearch(
    input: AlertSearchInput,
    ctx: {
      actor: Actor;
      signal?: AbortSignal;
      progress?: (fraction: number, message?: string) => void;
    },
  ): Promise<AlertSearchResult> {
    const queue = this.requireQueue();
    const { runId, job } = this.start(
      ctx.actor,
      {
        topic: input.topic,
        queries: input.queries,
        since: input.since,
        top: input.top,
        disableSources: [],
      },
      input.alert,
    );
    const onJob = (j: Job): void => {
      if (j.id === job) ctx.progress?.(0.02 + 0.88 * j.progress, j.message);
    };
    const onAbort = (): void => {
      queue.cancel(job, "the alert check was cancelled");
    };
    queue.on("job", onJob);
    if (ctx.signal?.aborted) onAbort();
    else ctx.signal?.addEventListener("abort", onAbort, { once: true });
    let final: Job;
    try {
      final = await queue.waitFor(job);
    } finally {
      queue.off("job", onJob);
      ctx.signal?.removeEventListener("abort", onAbort);
    }
    if (final.status !== "succeeded") {
      throw new CitegeistError({
        code: "LITSEARCH_RUN_FAILED",
        message:
          final.error?.message ?? `The literature search run ${runId} ended as ${final.status}.`,
        fix: "Open the run to see the stage that failed; the alert tries again at its next check.",
        recovery: "retry",
        sideEffects: "partial",
      });
    }

    const dir = this.runDir(runId);
    const previous = this.previousRun(input.alert, runId, input.baseRun);
    const marked = this.mark(
      readRunPapers(dir).filter((p) => p.section !== "rejected"),
      dir,
    );
    const lacking = previous ? this.compare(previous, runId).added : marked;
    writeFileAtomic(
      join(dir, "alert.json"),
      `${JSON.stringify(
        {
          alert: input.alert,
          ...(previous ? { previous } : {}),
          created: (this.deps.now ?? (() => new Date()))().toISOString(),
          new: lacking.map((p) => ({ key: p.key, title: p.title })),
        },
        null,
        2,
      )}\n`,
    );
    const candidates = lacking
      .filter((p) => p.status === "new" && !matchKeys(p).some((k) => input.seen.has(k)))
      .sort((a, b) => b.score - a.score);
    ctx.progress?.(0.92, `${candidates.length} new papers`);

    const citekeys: string[] = [];
    const proposed: string[] = [];
    for (let at = 0; citekeys.length < input.limit && at < candidates.length; ) {
      ctx.signal?.throwIfAborted();
      const chunk = candidates.slice(at, at + input.limit - citekeys.length);
      at += chunk.length;
      const sent = await this.sendToInbox(
        runId,
        chunk.map((p) => p.key),
        input.projects,
        (p) => input.why(p, runId),
      );
      for (const p of chunk) proposed.push(...matchKeys(p));
      for (const r of sent.results) {
        if (r.status === "added" && r.citekey) citekeys.push(r.citekey);
      }
    }
    return { runId, fetched: marked.length, found: candidates.length, citekeys, proposed };
  }

  /** The run an alert's new run is compared with: its last finished run, else the run it was saved from. */
  private previousRun(
    alert: string,
    current: string,
    base: string | undefined,
  ): string | undefined {
    const own = listRunSummaries(this.lib.paths.litsearchRunsDir).find(
      (r) => r.alert === alert && r.id !== current && r.status === "done",
    );
    const id = own?.id ?? base;
    return id && id !== current && existsSync(this.lib.paths.litsearchRunDir(id)) ? id : undefined;
  }

  async suggest(
    input: { topic: string; maxQueries: number },
    actor?: Actor,
  ): Promise<{ queries: string[] }> {
    if (!this.deps.ai) throw unavailable("query suggestions need the AI router of the app");
    const res = await this.deps.ai.run("litsearch.suggestQueries", input, actor ? { actor } : {});
    const output = res.output as Parameters<typeof planSuggestedQueries>[0];
    return { queries: planSuggestedQueries(output, input.maxQueries).map((q) => q.query) };
  }

  start(
    actor: Actor,
    input: {
      topic: string;
      queries: string[];
      since?: number | undefined;
      top?: number | undefined;
      disableSources: string[];
    },
    alert?: string,
  ): { runId: string; job: string } {
    const queue = this.requireQueue();
    this.refuseSecondRun();
    const queries = input.queries
      .map((q) => q.split(/\s+/).filter(Boolean).join(" "))
      .filter(Boolean);
    if (queries.length === 0) {
      throw new CitegeistError({
        code: "LITSEARCH_QUERIES_EMPTY",
        message: "The literature search has no query to run.",
        fix: "Pass at least one non-empty query, for example from litsearch.suggest.",
        recovery: "fix-and-retry",
        sideEffects: "none",
      });
    }
    const now = (this.deps.now ?? (() => new Date()))();
    const runsDir = this.lib.paths.litsearchRunsDir;
    mkdirSync(runsDir, { recursive: true });
    const runId = runIdFor(input.topic, now, (id) => existsSync(join(runsDir, id)));
    mkdirSync(join(runsDir, runId));
    const request: RunRequest = {
      topic: input.topic.trim(),
      queries,
      ...(input.since !== undefined ? { since: input.since } : {}),
      ...(input.top !== undefined ? { top: input.top } : {}),
      ...(input.disableSources.length ? { disableSources: input.disableSources } : {}),
      ...(alert ? { alert } : {}),
    };
    // The app opens the run as soon as start returns; run.json has to exist by then.
    writeQueuedMeta(join(runsDir, runId), runId, request, () => now);
    const job = queue.enqueue({ kind: JOB_KIND, input: { runId, request }, by: actor });
    return { runId, job: job.id };
  }

  resume(actor: Actor, runId: string): { runId: string; job: string } {
    const queue = this.requireQueue();
    const meta = this.meta(runId);
    if (meta.status === "done" || meta.status === "running") {
      throw new CitegeistError({
        code: "LITSEARCH_RUN_NOT_RESUMABLE",
        message: `Run "${runId}" is ${meta.status}; only failed, cancelled or interrupted runs continue.`,
        fix: "Start a new search with litsearch.start.",
        recovery: "fix-and-retry",
        sideEffects: "none",
      });
    }
    this.refuseSecondRun();
    const { disableSources } = readRunState(this.runDir(runId));
    const request: RunRequest = {
      topic: meta.topic,
      queries: meta.queries,
      ...(meta.since !== undefined ? { since: meta.since } : {}),
      ...(meta.top !== undefined ? { top: meta.top } : {}),
      ...(disableSources.length ? { disableSources } : {}),
      ...(meta.alert ? { alert: meta.alert } : {}),
    };
    writeQueuedMeta(this.runDir(runId), runId, request, this.deps.now);
    const job = queue.enqueue({ kind: JOB_KIND, input: { runId, request }, by: actor });
    return { runId, job: job.id };
  }

  cancel(runId: string): { ok: true } {
    this.runDir(runId);
    const job = this.openJob(runId);
    if (!job) {
      throw new CitegeistError({
        code: "LITSEARCH_RUN_NOT_RUNNING",
        message: `Run "${runId}" is not running in this app.`,
        fix: "Only runs of this app can be stopped here; a run that another Mac started ends on its own.",
        recovery: "fix-and-retry",
        sideEffects: "none",
      });
    }
    this.deps.queue?.cancel(job.id);
    return { ok: true };
  }

  /** A run's output file and its text, for a download in the app. */
  export(runId: string, format: "md" | "csv" | "bib" | "summaries") {
    const meta = this.meta(runId);
    const file = EXPORT_FILES[format];
    const path = join(this.runDir(runId), file);
    if (!existsSync(path)) {
      throw new CitegeistError({
        code: "LITSEARCH_OUTPUT_MISSING",
        message: `Run "${runId}" has no ${file}; it is ${meta.status}.`,
        fix: "Exports exist once a run is done. Resume the run first.",
        recovery: "fix-and-retry",
        sideEffects: "none",
      });
    }
    return { path, filename: `${runId}-${file}`, content: readFileSync(path, "utf8") };
  }

  /** Writes report.html with report.py and returns it. */
  async report(runId: string) {
    const meta = this.meta(runId);
    const dir = this.runDir(runId);
    if (!existsSync(join(dir, "papers.csv"))) {
      throw new CitegeistError({
        code: "LITSEARCH_OUTPUT_MISSING",
        message: `Run "${runId}" has no results yet; it is ${meta.status}.`,
        fix: "The report exists once a run is done.",
        recovery: "fix-and-retry",
        sideEffects: "none",
      });
    }
    const { command, scriptsDir } = this.deps;
    if (!command || !scriptsDir) throw unavailable("the report is written by the citegeist app");
    const path = join(dir, "report.html");
    const res = await runScript({
      command,
      script: join(scriptsDir, "report.py"),
      args: [dir, "--out", path],
      env: {
        dataDir: this.lib.paths.researchDir,
        cacheDir: this.deps.cacheDir ?? join(this.lib.local.cacheDir, "litsearch"),
      },
    });
    if (res.code !== 0 || !existsSync(path)) {
      throw new CitegeistError({
        code: "LITSEARCH_REPORT_FAILED",
        message: `The report could not be written: ${res.stderr.trim().split("\n").pop() || `exit ${res.code}`}`,
        fix: "Check that the run folder holds papers.csv and papers.md.",
        recovery: "fix-and-retry",
        sideEffects: "none",
      });
    }
    return { path, filename: `${runId}-report.html`, html: readFileSync(path, "utf8") };
  }

  /** Environment of a short script: folders, library id, Keychain service, contact address. */
  private async env() {
    type Creds = Awaited<ReturnType<NonNullable<LitsearchDeps["credentials"]>>>;
    const creds: Creds = (await this.deps.credentials?.().catch(() => ({}))) ?? {};
    return {
      dataDir: this.lib.paths.researchDir,
      cacheDir: this.deps.cacheDir ?? join(this.lib.local.cacheDir, "litsearch"),
      mailto: creds.mailto,
    };
  }

  /** Runs a script of workers/research and parses the JSON on its last output line. */
  private async script(name: string, args: string[], timeoutMs?: number): Promise<unknown> {
    const { command, scriptsDir } = this.deps;
    if (!command || !scriptsDir) throw unavailable("the scripts are started by the citegeist app");
    const res = await runScript({
      command,
      script: join(scriptsDir, name),
      args,
      env: await this.env(),
      ...(timeoutMs ? { timeoutMs } : {}),
    });
    if (res.code !== 0) {
      throw new CitegeistError({
        code: "LITSEARCH_SCRIPT_FAILED",
        message: res.stderr.trim().split("\n").pop() || `${name} exited with ${res.code}`,
        fix: "Look at the script's stderr in the app log; a Python or uv problem often prints there.",
        recovery: "fix-and-retry",
        sideEffects: "none",
      });
    }
    const line = res.stdout.trim().split("\n").pop() ?? "null";
    try {
      return JSON.parse(line) as unknown;
    } catch {
      throw new CitegeistError({
        code: "LITSEARCH_SCRIPT_OUTPUT_INVALID",
        message: `${name} did not answer with JSON: ${line.slice(0, 200) || "no output"}`,
        fix: "Look at the script's stderr in the app log; a Python or uv problem often prints there.",
        recovery: "fix-and-retry",
        sideEffects: "none",
      });
    }
  }

  /** Tracked preprints of the library, after collecting those of all runs. */
  async preprints() {
    const { preprints, lastCheck } = describePreprints(this.lib, await this.trackedPreprints());
    return {
      tracked: preprints.filter((p) => p.status !== "published"),
      published: preprints.filter((p) => p.status === "published"),
      ...(lastCheck ? { lastCheck } : {}),
    };
  }

  /** The list preprints.py keeps: every preprint of a run or an imported reference list. */
  private async trackedPreprints(): Promise<RawPreprint[]> {
    const out = (await this.script("preprints.py", ["list", "--json"])) as {
      items?: RawPreprint[];
    };
    return out.items ?? [];
  }

  /** Tracks the preprints cited in a references.bib or a Markdown reference list. */
  async preprintsImport(path: string): Promise<{ added: number }> {
    if (!existsSync(path)) {
      throw new CitegeistError({
        code: "LITSEARCH_IMPORT_FILE_MISSING",
        message: `There is no file at ${path}.`,
        fix: "Pick a references.bib or a Markdown reference list.",
        recovery: "fix-and-retry",
        sideEffects: "none",
      });
    }
    const before = (await this.trackedPreprints()).length;
    const { command, scriptsDir } = this.deps;
    if (!command || !scriptsDir) throw unavailable("preprints are tracked by the citegeist app");
    const res = await runScript({
      command,
      script: join(scriptsDir, "preprints.py"),
      args: ["import", path],
      env: await this.env(),
    });
    if (res.code !== 0) {
      throw new CitegeistError({
        code: "LITSEARCH_IMPORT_FAILED",
        message: res.stderr.trim().split("\n").pop() || `preprints.py exited with ${res.code}`,
        fix: "Check that the file is BibTeX or a Markdown list of references.",
        recovery: "fix-and-retry",
        sideEffects: "none",
      });
    }
    const after = (await this.trackedPreprints()).length;
    return { added: Math.max(0, after - before) };
  }

  /** Starts the check of every tracked preprint as a job (network, minutes for long lists). */
  preprintsCheck(actor: Actor): { job: string } {
    const queue = this.requireQueue();
    const open = queue.open().find((j) => j.kind === PREPRINTS_JOB);
    if (open) return { job: open.id };
    const input: PreprintsJobInput = { force: true };
    return { job: queue.enqueue({ kind: PREPRINTS_JOB, input, by: actor }).id };
  }

  /**
   * Queues a check of the tracked preprints once a week while the app runs: a preprint that was
   * looked at less than six days ago is skipped. The timer does not keep the process alive.
   */
  schedulePreprintChecks(
    options: { intervalMs?: number; firstDelayMs?: number; pollMs?: number } = {},
  ): { tick(): string | undefined; stop(): void } {
    const queue = this.deps.queue;
    if (!queue || !this.deps.versions) return { tick: () => undefined, stop: () => undefined };
    const interval = options.intervalMs ?? 7 * 24 * 60 * 60 * 1000;
    const now = this.deps.now ?? (() => new Date());
    const tick = (): string | undefined => {
      if (queue.open().some((j) => j.kind === PREPRINTS_JOB)) return undefined;
      const last = queue
        .list({ status: "succeeded", limit: 100 })
        .jobs.find((j) => j.kind === PREPRINTS_JOB);
      if (last && now().getTime() - Date.parse(last.updatedAt) < interval) return undefined;
      const input: PreprintsJobInput = { force: false };
      return queue.enqueue({ kind: PREPRINTS_JOB, input, by: "system", maxAttempts: 1 }).id;
    };
    let timer: NodeJS.Timeout | undefined;
    let first: NodeJS.Timeout | undefined = setTimeout(
      () => {
        first = undefined;
        tick();
        timer = setInterval(tick, options.pollMs ?? 60 * 60 * 1000);
        timer.unref();
      },
      options.firstDelayMs ?? 10 * 60 * 1000,
    );
    first.unref();
    return {
      tick,
      stop() {
        if (first) clearTimeout(first);
        if (timer) clearInterval(timer);
        first = undefined;
        timer = undefined;
      },
    };
  }

  /**
   * The preprint check job. Whether a preprint is published is decided by the version detection
   * of the library graph (see preprints.ts); OpenReview is the only lookup left to preprints.py.
   */
  private async checkPreprints(ctx: JobContext): Promise<unknown> {
    const { command, scriptsDir, versions } = this.deps;
    if (!command || !scriptsDir || !versions) {
      throw unavailable("preprints are checked by the citegeist app");
    }
    const force = (ctx.job.input as PreprintsJobInput | null)?.force ?? true;
    const result = await checkPreprints(
      this.lib,
      versions,
      ctx.job.by,
      await this.trackedPreprints(),
      {
        force,
        now: this.deps.now?.() ?? new Date(),
        signal: ctx.signal,
        progress: (fraction, message) => ctx.progress(fraction * 0.9, message),
      },
    );
    const res = await runScript({
      command,
      script: join(scriptsDir, "preprints.py"),
      args: ["openreview", ...(force ? ["--all"] : [])],
      env: { ...(await this.env()), ...(await this.credentials()) },
      timeoutMs: 30 * 60_000,
    });
    if (res.code !== 0) {
      throw new CitegeistError({
        code: "LITSEARCH_PREPRINTS_FAILED",
        message: res.stderr.trim().split("\n").pop() || `preprints.py exited with ${res.code}`,
        fix: "Try again later; the sources may be rate limited.",
        recovery: "retry",
        sideEffects: "partial",
      });
    }
    return { ...result, accepted: res.stdout.trim().split("\n").filter(Boolean) };
  }

  private async credentials() {
    type Creds = Awaited<ReturnType<NonNullable<LitsearchDeps["credentials"]>>>;
    const creds: Creds = (await this.deps.credentials?.().catch(() => ({}))) ?? {};
    return { openalexKey: creds.openalexKey };
  }

  private requireQueue(): JobQueue {
    if (!this.deps.queue || !this.deps.command || !this.deps.scriptsDir) {
      throw unavailable("a literature search runs in the citegeist app, not in a one-shot process");
    }
    return this.deps.queue;
  }

  private refuseSecondRun(): void {
    const open = this.openJob();
    if (open) {
      const runId = (open.input as RunJobInput | null)?.runId ?? "?";
      throw new CitegeistError({
        code: "LITSEARCH_RUN_ACTIVE",
        message: `A literature search is already running (${runId}).`,
        fix: "Wait for it to finish or cancel it with litsearch.cancel.",
        recovery: "fix-and-retry",
        sideEffects: "none",
      });
    }
  }

  private async runJob(ctx: JobContext): Promise<unknown> {
    const { runId, request } = ctx.job.input as RunJobInput;
    const { command, scriptsDir } = this.deps;
    if (!command || !scriptsDir) throw unavailable("the literature search is not set up");
    type Creds = Awaited<ReturnType<NonNullable<LitsearchDeps["credentials"]>>>;
    const creds: Creds = (await this.deps.credentials?.().catch(() => ({}))) ?? {};
    const dir = this.runDir(runId);
    let stages = stagesFromEvents([]).stages;
    const events: Array<Record<string, unknown>> = [];
    const outcome = await runPipeline({
      script: join(scriptsDir, "pipeline.py"),
      command,
      env: {
        dataDir: this.lib.paths.researchDir,
        cacheDir: this.deps.cacheDir ?? join(this.lib.local.cacheDir, "litsearch"),
        openalexKey: creds.openalexKey,
        mailto: creds.mailto,
      },
      dir,
      runId,
      request,
      signal: ctx.signal,
      ...(this.deps.now ? { now: this.deps.now } : {}),
      onEvent: (event) => {
        if (event.type !== "stage" && event.type !== "counter" && event.type !== "plan") return;
        events.push(event);
        stages = stagesFromEvents(events).stages;
        const current = stages.find((s) => s.status === "running");
        ctx.progress(progressOf(stages), current?.label);
      },
    });
    if (outcome.status === "failed") {
      throw new CitegeistError({
        code: "LITSEARCH_RUN_FAILED",
        message: outcome.error ?? "the literature search failed",
        fix: "Open the run to see the stage that failed; resume it with litsearch.resume.",
        recovery: "fix-and-retry",
        sideEffects: "partial",
      });
    }
    return { runId, status: outcome.status, counts: outcome.counts };
  }
}

/**
 * Marks the papers that <run>/alert.json lists as new against the previous run of the alert. Runs of
 * the former watchlists carry the same list in watch.json.
 */
function withNewInAlert(papers: LitsearchPaper[], dir: string): LitsearchPaper[] {
  for (const file of ["alert.json", "watch.json"]) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch {
      continue;
    }
    const list = (raw as { new?: Array<{ key?: unknown }> } | null)?.new;
    if (!Array.isArray(list)) continue;
    const keys = new Set(list.map((p) => p.key).filter((k): k is string => typeof k === "string"));
    return papers.map((p) => (keys.has(p.key) ? { ...p, newInAlert: true } : p));
  }
  return papers;
}

/** <run>/inbox.json: which paper key became which library item. */
function readSent(dir: string): Record<string, { citekey: string; at: string }> {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(dir, "inbox.json"), "utf8"));
    if (!raw || typeof raw !== "object") return {};
    return Object.fromEntries(
      Object.entries(raw).filter(
        (e): e is [string, { citekey: string; at: string }] =>
          typeof (e[1] as { citekey?: unknown })?.citekey === "string",
      ),
    );
  } catch {
    return {};
  }
}

function unavailable(why: string): CitegeistError {
  return new CitegeistError({
    code: "LITSEARCH_UNAVAILABLE",
    message: `The literature search is not available here: ${why}.`,
    fix: "Use the literature search tab of the citegeist app.",
    recovery: "do-first",
    sideEffects: "none",
  });
}
