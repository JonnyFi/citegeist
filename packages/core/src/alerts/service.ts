import type { AlertLookup, AlertQuery, AlertWork, WorkKey } from "@citegeist/metadata";
import {
  type AlertDef,
  type AlertInfo,
  type AlertRun,
  type AlertRunResult,
  type AlertSource,
  alertsCreate,
  alertsDelete,
  alertsList,
  alertsRunNow,
  alertsUpdate,
  type Registry,
} from "@citegeist/ops";
import { type Actor, CitegeistError } from "@citegeist/schema";
import type { z } from "zod";
import type { AddItem } from "../graph/candidates.js";
import { slugify } from "../ids.js";
import { problem } from "../ingest/items.js";
import type { JobContext, JobQueue } from "../jobs/index.js";
import type { Library } from "../library.js";
import {
  dedupe,
  identifierOf,
  isDue,
  nextRunAt,
  type Ranker,
  rankWorks,
  windowStart,
  workKeys,
} from "./select.js";
import {
  type AlertState,
  AlertStateStore,
  type AlertsFile,
  alertFiles,
  readAlertsFile,
  writeAlertsFile,
} from "./store.js";

/** The why of an inbox item an alert added (D7). */
export function alertWhy(name: string): string {
  return `Alert: ${name}`;
}

export interface AlertDeps {
  /** The metadata resolver: `createResolver(...)` implements AlertLookup. */
  lookup: AlertLookup;
  /** `IngestService.addItem`, bound to its service. */
  addItem: AddItem;
  /** The job queue. With it, runs happen as jobs of the kind `alerts`. */
  queue?: JobQueue;
  /** Scores texts against the project brief, or returns undefined when no local embedder is ready. */
  rank?: Ranker;
  /** Clock in Unix ms, for tests. */
  now?: () => number;
}

interface Located {
  def: AlertDef;
  file: AlertsFile;
}

export class AlertService {
  private readonly state: AlertStateStore;
  private readonly now: () => number;

  constructor(
    readonly lib: Library,
    readonly deps: AlertDeps,
  ) {
    this.state = new AlertStateStore(`${lib.local.dir}/alerts-state.json`);
    this.now = deps.now ?? Date.now;
  }

  // Definitions -----------------------------------------------------------------------------

  private all(): Located[] {
    return alertFiles(this.lib).flatMap((file) =>
      file.entries.flatMap((e) => (e.def ? [{ def: e.def, file }] : [])),
    );
  }

  private locate(id: string): Located {
    const found = this.all().find((l) => l.def.id === id);
    if (!found) {
      throw problem(
        "ALERT_NOT_FOUND",
        `no alert with id '${id}'`,
        "Call alerts.list to see the alerts.",
        { id },
      );
    }
    return found;
  }

  private info(l: Located): AlertInfo {
    const lastRun = this.state.get(l.def.id).lastRun;
    const next = nextRunAt(l.def, lastRun, this.now());
    return {
      ...l.def,
      ...(l.file.project ? { project: l.file.project } : {}),
      ...(lastRun ? { lastRun } : {}),
      ...(next ? { nextRun: next } : {}),
    };
  }

  list(input: { project?: string | undefined; libraryOnly?: boolean } = {}): {
    alerts: AlertInfo[];
  } {
    if (input.project) this.lib.getProject(input.project);
    const wanted = this.all().filter((l) =>
      input.project
        ? l.file.project === input.project
        : input.libraryOnly
          ? l.file.project === undefined
          : true,
    );
    return { alerts: wanted.map((l) => this.info(l)) };
  }

  private checkSource(source: AlertSource): void {
    if (source.kind !== "cites") return;
    const { frontmatter: fm } = this.lib.getItem(source.value);
    if (!fm.DOI && !fm.ids.openalex && !fm.ids.arxiv) {
      throw problem(
        "NO_CITATION_SOURCE",
        `item ${source.value} has no DOI, arXiv id or OpenAlex id to look its citations up`,
        "Set a DOI with items.update.",
        { citekey: source.value },
        "do-first",
      );
    }
  }

  private freeId(name: string): string {
    const taken = new Set(this.all().map((l) => l.def.id));
    const base = slugify(name, 50) || "alert";
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    return id;
  }

  create(input: {
    project?: string | undefined;
    name: string;
    source: AlertSource;
    intervalHours?: number | undefined;
    limit?: number | undefined;
    rank?: boolean | undefined;
    enabled?: boolean | undefined;
  }): AlertInfo {
    if (input.project) this.lib.getProject(input.project);
    this.checkSource(input.source);
    const file = readAlertsFile(this.lib, input.project);
    const def: AlertDef = {
      id: this.freeId(input.name),
      name: input.name.trim(),
      source: input.source,
      intervalHours: input.intervalHours ?? 24,
      limit: input.limit ?? 5,
      rank: input.rank ?? true,
      enabled: input.enabled ?? true,
      created: new Date(this.now()).toISOString(),
    };
    file.entries.push({ raw: def, def });
    writeAlertsFile(this.lib, file);
    return this.info({ def, file });
  }

  update(input: z.output<typeof alertsUpdate.input>): AlertInfo {
    const found = this.locate(input.id);
    if (input.patch.source) this.checkSource(input.patch.source);
    // The file is read again, because `locate` read the others as well.
    const file = readAlertsFile(this.lib, found.file.project);
    const entry = file.entries.find((e) => e.def?.id === input.id);
    if (!entry?.def)
      throw problem("ALERT_NOT_FOUND", `no alert with id '${input.id}'`, "Call alerts.list.", {
        id: input.id,
      });
    const def: AlertDef = { ...entry.def };
    const patch = input.patch;
    if (patch.name !== undefined) def.name = patch.name.trim();
    if (patch.source !== undefined) def.source = patch.source;
    if (patch.intervalHours !== undefined) def.intervalHours = patch.intervalHours;
    if (patch.limit !== undefined) def.limit = patch.limit;
    if (patch.rank !== undefined) def.rank = patch.rank;
    if (patch.enabled !== undefined) def.enabled = patch.enabled;
    entry.def = def;
    entry.raw = def;
    // A new source starts from a clean slate: what the old one proposed says nothing about it.
    if (patch.source && JSON.stringify(patch.source) !== JSON.stringify(found.def.source)) {
      this.state.delete(def.id);
    }
    writeAlertsFile(this.lib, file);
    return this.info({ def, file });
  }

  delete(id: string): void {
    const found = this.locate(id);
    const file = readAlertsFile(this.lib, found.file.project);
    file.entries = file.entries.filter((e) => e.def?.id !== id);
    writeAlertsFile(this.lib, file);
    this.state.delete(id);
  }

  // Running ---------------------------------------------------------------------------------

  /** Queues a run, or returns the job that is already queued or running for this alert. */
  enqueue(id: string, by: Actor = "system"): string {
    this.locate(id);
    const queue = this.deps.queue;
    if (!queue) {
      throw problem(
        "NO_JOB_QUEUE",
        "alerts cannot run as jobs in this process",
        "Run the alert in the app.",
        { id },
      );
    }
    for (const status of ["queued", "running"]) {
      const open = queue
        .list({ status, limit: 100 })
        .jobs.find(
          (j) => j.kind === "alerts" && (j.input as { alert?: unknown } | null)?.alert === id,
        );
      if (open) return open.id;
    }
    return queue.enqueue({ kind: "alerts", by, input: { alert: id }, maxAttempts: 1 }).id;
  }

  /** Queues a run for every alert whose interval has passed. Returns the ids of the jobs. */
  tick(): string[] {
    let located: Located[];
    try {
      located = this.all();
    } catch {
      // A damaged alerts file must not stop the timer; the list shows the error.
      return [];
    }
    const now = this.now();
    const jobs: string[] = [];
    for (const l of located) {
      if (!isDue(l.def, this.state.get(l.def.id).lastRun, now)) continue;
      try {
        jobs.push(this.enqueue(l.def.id));
      } catch {
        // No queue in this process: nothing to schedule.
      }
    }
    return jobs;
  }

  private queryOf(def: AlertDef, since: string, limit: number): AlertQuery {
    const base = { since, limit };
    const { kind, value } = def.source;
    switch (kind) {
      case "arxiv-category":
        return { ...base, kind, category: value };
      case "arxiv-query":
        return { ...base, kind, query: value };
      case "openalex-topic":
        return { ...base, kind, topic: value };
      case "openalex-search":
        return { ...base, kind, query: value };
      case "author":
        return { ...base, kind, author: value };
      case "cites": {
        const { frontmatter: fm } = this.lib.getItem(value);
        const key: WorkKey = {
          ...(fm.DOI ? { doi: fm.DOI.toLowerCase() } : {}),
          ...(fm.ids.openalex ? { openalex: fm.ids.openalex } : {}),
          ...(fm.ids.arxiv ? { arxiv: fm.ids.arxiv } : {}),
        };
        return { ...base, kind, key };
      }
    }
  }

  /** The text works are ranked against: the title and the brief of the project. */
  private briefOf(project: string | undefined): string {
    if (!project) return "";
    try {
      const { frontmatter, brief } = this.lib.getProject(project);
      return `${frontmatter.title}\n${brief}`.trim();
    } catch {
      return "";
    }
  }

  /**
   * One run: fetch the works since the last successful run, remove what is already known, rank
   * the rest against the brief when a local embedder is ready, and put the top N into the inbox
   * as "system" with the why "Alert: <name>" (D7).
   */
  async run(id: string, ctx?: Pick<JobContext, "signal" | "progress">): Promise<AlertRunResult> {
    const { def, file } = this.locate(id);
    const state = this.state.get(id);
    const started = this.now();
    const since = windowStart(state.cursor, started);
    const pool = Math.min(100, Math.max(30, def.limit * 6));
    const fail = (err: unknown): never => {
      const message =
        err instanceof CitegeistError
          ? err.detail.message
          : err instanceof Error
            ? err.message
            : String(err);
      const lastRun: AlertRun = {
        at: new Date(started).toISOString(),
        ok: false,
        fetched: 0,
        found: 0,
        added: 0,
        ranked: false,
        error: message,
      };
      this.state.set(id, { ...state, lastRun });
      throw err;
    };

    let works: AlertWork[];
    try {
      ctx?.progress(0.05, `looking for new works since ${since}`);
      works = await this.deps.lookup.alertWorks(this.queryOf(def, since, pool));
    } catch (err) {
      return fail(err);
    }
    ctx?.signal.throwIfAborted();

    const seen = new Set(state.seen);
    const fresh = dedupe(this.lib, works, seen).fresh;
    ctx?.progress(0.4, `${fresh.length} new works`);

    const ordered =
      (def.rank ? await rankWorks(fresh, this.briefOf(file.project), this.deps.rank) : undefined) ??
      fresh;
    const ranked = ordered !== fresh;

    const citekeys: string[] = [];
    const proposed: string[] = [];
    for (const work of ordered) {
      if (citekeys.length >= def.limit) break;
      ctx?.signal.throwIfAborted();
      const identifier = identifierOf(work);
      if (!identifier) continue;
      try {
        const added = await this.deps.addItem("system", {
          identifier,
          projects: file.project ? [file.project] : [],
          tags: [],
          target: "inbox",
          why: alertWhy(def.name),
        });
        proposed.push(...workKeys(work));
        if (!added.duplicateOf) citekeys.push(added.citekey);
      } catch {
        // A work that cannot be added is not offered again.
        proposed.push(...workKeys(work));
      }
      ctx?.progress(0.4 + 0.6 * (citekeys.length / Math.max(def.limit, 1)));
    }

    const run: AlertRun = {
      at: new Date(started).toISOString(),
      ok: true,
      fetched: works.length,
      found: fresh.length,
      added: citekeys.length,
      ranked,
    };
    const next: AlertState = {
      lastRun: run,
      cursor: new Date(started).toISOString(),
      seen: [...state.seen, ...proposed],
    };
    this.state.set(id, next);
    return { ...run, alert: id, citekeys };
  }
}

/** Registers the handler of the jobs of kind `alerts`. */
export function registerAlertsJob(queue: JobQueue, service: AlertService): void {
  queue.register(
    "alerts",
    async (ctx) => {
      const id = (ctx.job.input as { alert?: unknown } | null)?.alert;
      if (typeof id !== "string") throw new Error("an alerts job needs an alert id");
      return service.run(id, ctx);
    },
    { concurrency: 1, maxAttempts: 1 },
  );
}

export interface AlertSchedule {
  /** Queues a run for every alert that is due. */
  tick(): string[];
  stop(): void;
}

export interface AlertScheduleOptions {
  /** Wait before the first check. Default one minute. */
  firstDelayMs?: number;
  /** How often the timer looks for due alerts. Default ten minutes. */
  pollMs?: number;
}

/**
 * The timer behind the alerts: after a short wait, and then every few minutes, it queues a job
 * for each alert whose interval has passed since its last run. The state is on disk, so a restart
 * runs only what is due. The timer does not keep the process alive.
 */
export function scheduleAlerts(
  service: AlertService,
  options: AlertScheduleOptions = {},
): AlertSchedule {
  let timer: NodeJS.Timeout | undefined;
  const poll = options.pollMs ?? 10 * 60 * 1000;
  let first: NodeJS.Timeout | undefined = setTimeout(
    () => {
      first = undefined;
      service.tick();
      timer = setInterval(() => service.tick(), poll);
      timer.unref();
    },
    options.firstDelayMs ?? 60 * 1000,
  );
  first.unref();
  return {
    tick: () => service.tick(),
    stop() {
      if (first) clearTimeout(first);
      if (timer) clearInterval(timer);
      first = undefined;
      timer = undefined;
    },
  };
}

/** Binds alerts.list, create, update, delete and runNow. */
export function bindAlertOperations(
  registry: Registry,
  lib: Library,
  deps: AlertDeps,
): AlertService {
  const service = new AlertService(lib, deps);
  if (deps.queue) registerAlertsJob(deps.queue, service);
  registry
    .bind(alertsList, async (_ctx, input) => service.list(input))
    .bind(alertsCreate, async (_ctx, input) => service.create(input))
    .bind(alertsUpdate, async (_ctx, input) => service.update(input))
    .bind(alertsDelete, async (_ctx, input) => {
      service.delete(input.id);
      return { ok: true as const };
    })
    .bind(alertsRunNow, async (ctx, input) => ({ job: service.enqueue(input.id, ctx.actor) }));
  return service;
}
