import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { planSuggestedQueries } from "@citegeist/ai";
import type {
  GraphWork,
  LitsearchPaper,
  LitsearchRunMeta,
  LitsearchRunSummary,
} from "@citegeist/ops";
import { type Actor, CitegeistError, type Job } from "@citegeist/schema";
import { markWorks } from "../graph/marking.js";
import type { JobContext, JobQueue } from "../jobs/queue.js";
import type { Library } from "../library.js";
import { type LitsearchCommand, type RunRequest, runPipeline, runScript } from "./runner.js";
import {
  listRunSummaries,
  progressOf,
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

const RUN_ID = /^[a-z0-9][a-z0-9-]{0,119}$/;
const EXPORT_FILES = {
  md: "papers.md",
  csv: "papers.csv",
  bib: "references.bib",
  summaries: "summaries.md",
} as const;
const JOB_KIND = "litsearch.run";

/** Folder name of a new run: date and topic, like research-pipeline's watch.py. */
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

function pidAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** What a run needs from the machine: how to start the scripts and what to pass them. */
export interface LitsearchDeps {
  /** Runs AI tasks with the routing the user set (litsearch.suggestQueries). */
  ai?: {
    run(task: "litsearch.suggestQueries", input: unknown): Promise<{ output: unknown }>;
  };
  /** The job queue of the runtime. Without it (a one-shot CLI) runs cannot start. */
  queue?: JobQueue;
  command?: LitsearchCommand;
  /** workers/research/scripts */
  scriptsDir?: string;
  /** Machine-local lookup cache. */
  cacheDir?: string;
  /** OpenAlex key from the Keychain and the contact address from the settings, read per run. */
  credentials?: () => Promise<{ openalexKey?: string | undefined; mailto?: string | undefined }>;
  now?: () => Date;
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
    if (pidAlive(readRunState(this.lib.paths.litsearchRunDir(meta.id)).pid)) return meta;
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
      papers: this.mark(readRunPapers(dir)),
    };
  }

  /** Marks each paper as in the library, in the inbox or new, like the citation graph does. */
  mark(papers: RunPaper[]): LitsearchPaper[] {
    const { marked } = markWorks(this.lib, papers.map(workOf));
    return papers.map((p, i) => {
      const m = marked[i];
      return { ...p, status: m?.status ?? "new", ...(m?.citekey ? { citekey: m.citekey } : {}) };
    });
  }

  async suggest(input: { topic: string; maxQueries: number }): Promise<{ queries: string[] }> {
    if (!this.deps.ai) throw unavailable("query suggestions need the AI router of the app");
    const res = await this.deps.ai.run("litsearch.suggestQueries", input);
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
    watch?: string,
  ): { runId: string; job: string } {
    const queue = this.requireQueue();
    this.refuseSecondRun();
    const now = (this.deps.now ?? (() => new Date()))();
    const runsDir = this.lib.paths.litsearchRunsDir;
    mkdirSync(runsDir, { recursive: true });
    const runId = runIdFor(input.topic, now, (id) => existsSync(join(runsDir, id)));
    mkdirSync(join(runsDir, runId));
    const request: RunRequest = {
      topic: input.topic.trim(),
      queries: input.queries.map((q) => q.split(/\s+/).filter(Boolean).join(" ")).filter(Boolean),
      ...(input.since !== undefined ? { since: input.since } : {}),
      ...(input.top !== undefined ? { top: input.top } : {}),
      ...(input.disableSources.length ? { disableSources: input.disableSources } : {}),
      ...(watch ? { watch } : {}),
    };
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
      ...(meta.watch ? { watch: meta.watch } : {}),
    };
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
        fix: "A run started by a background watchlist stops on its own; wait for it or end it in Activity Monitor.",
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

function unavailable(why: string): CitegeistError {
  return new CitegeistError({
    code: "LITSEARCH_UNAVAILABLE",
    message: `The literature search is not available here: ${why}.`,
    fix: "Use the literature search tab of the citegeist app.",
    recovery: "do-first",
    sideEffects: "none",
  });
}
