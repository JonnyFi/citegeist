import { EventEmitter } from "node:events";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type Actor, CitegeistError, Job, type JobKind as JobKindSchema } from "@citegeist/schema";
import Database from "better-sqlite3";
import type { z } from "zod";
import { ulid } from "../ids.js";

/** An error that is worth another attempt: network trouble, a crashed worker, a busy service. */
type JobKind = z.infer<typeof JobKindSchema>;

export class TransientError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TransientError";
  }
}

const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
]);

/** True for errors that the queue retries with backoff. */
export function isTransient(err: unknown): boolean {
  if (err instanceof TransientError) return true;
  if (err instanceof CitegeistError) return err.detail.recovery === "retry";
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && TRANSIENT_CODES.has(code)) return true;
    if (err.cause !== undefined && err.cause !== err) return isTransient(err.cause);
  }
  return false;
}

export interface JobContext {
  job: Job;
  /** Aborted when the job is cancelled or the queue closes. */
  signal: AbortSignal;
  /** Reports progress (0 to 1) and an optional message; persisted and emitted as an event. */
  progress(value: number, message?: string): void;
  queue: JobQueue;
}

export type JobHandler = (ctx: JobContext) => Promise<unknown>;

export interface KindOptions {
  /** Jobs of this kind that run at the same time. Default 1. */
  concurrency?: number;
  /** Attempts including the first. Default 3. */
  maxAttempts?: number;
}

export interface EnqueueOptions {
  kind: JobKind;
  input?: unknown;
  by: Actor;
  parent?: string;
  /** Pre-allocated id from `newId()`. */
  id?: string;
  maxAttempts?: number;
}

export interface QueueOptions {
  /** Path of state.sqlite (machine-local, never inside the library folder). */
  dbPath: string;
  now?: () => Date;
  /** Delay in ms before attempt `attempt + 1`, where `attempt` counts the attempts done. */
  backoffMs?: (attempt: number) => number;
}

interface Row {
  id: string;
  kind: string;
  status: string;
  progress: number;
  message: string | null;
  input_json: string | null;
  result_json: string | null;
  error_json: string | null;
  attempts: number;
  max_attempts: number;
  parent: string | null;
  by: string;
  created_at: string;
  updated_at: string;
  run_after: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL, progress REAL NOT NULL DEFAULT 0,
  message TEXT, input_json TEXT, result_json TEXT, error_json TEXT,
  attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
  parent TEXT, by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  run_after REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, run_after);
CREATE INDEX IF NOT EXISTS jobs_parent ON jobs(parent);
`;

const DEFAULT_BACKOFF = (attempt: number): number => Math.min(60_000, 1000 * 2 ** (attempt - 1));
const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

/**
 * Persistent job queue in state.sqlite: per-kind concurrency, retries with backoff for transient
 * errors, progress events and cancellation. Jobs that were running when the process died are
 * queued again on `start()`.
 *
 * Events: "job" with the changed Job after every state or progress change.
 */
export class JobQueue extends EventEmitter {
  private readonly db: Database.Database;
  private readonly now: () => Date;
  private readonly backoff: (attempt: number) => number;
  private readonly kinds = new Map<string, { handler: JobHandler } & Required<KindOptions>>();
  private readonly running = new Map<string, AbortController>();
  private readonly runningByKind = new Map<string, number>();
  private timer: NodeJS.Timeout | undefined;
  private started = false;
  private closed = false;
  private readonly active = new Set<Promise<void>>();

  constructor(opts: QueueOptions) {
    super();
    mkdirSync(dirname(opts.dbPath), { recursive: true });
    this.db = new Database(opts.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
    this.now = opts.now ?? (() => new Date());
    this.backoff = opts.backoffMs ?? DEFAULT_BACKOFF;
  }

  newId(): string {
    return `j_${ulid(this.now().getTime())}`;
  }

  register(kind: JobKind, handler: JobHandler, opts: KindOptions = {}): this {
    this.kinds.set(kind, {
      handler,
      concurrency: opts.concurrency ?? 1,
      maxAttempts: opts.maxAttempts ?? 3,
    });
    return this;
  }

  /** Recovers jobs left running by a dead process and begins to run queued jobs. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.db
      .prepare(
        "UPDATE jobs SET status = 'queued', message = 'resumed after restart' WHERE status = 'running'",
      )
      .run();
    this.pump();
  }

  enqueue(opts: EnqueueOptions): Job {
    const id = opts.id ?? this.newId();
    const at = this.now().toISOString();
    const maxAttempts = opts.maxAttempts ?? this.kinds.get(opts.kind)?.maxAttempts ?? 3;
    this.db
      .prepare(
        `INSERT INTO jobs(id, kind, status, progress, input_json, attempts, max_attempts, parent, by,
          created_at, updated_at, run_after) VALUES (?, ?, 'queued', 0, ?, 0, ?, ?, ?, ?, ?, 0)`,
      )
      .run(
        id,
        opts.kind,
        JSON.stringify(opts.input ?? null),
        maxAttempts,
        opts.parent ?? null,
        opts.by,
        at,
        at,
      );
    const job = this.mustGet(id);
    this.emit("job", job);
    this.pump();
    return job;
  }

  /** Records a job that needs no work (for example a duplicate add) as already succeeded. */
  enqueueFinished(opts: Omit<EnqueueOptions, "id"> & { result: unknown; message?: string }): Job {
    const id = this.newId();
    const at = this.now().toISOString();
    this.db
      .prepare(
        `INSERT INTO jobs(id, kind, status, progress, message, input_json, result_json, attempts,
          max_attempts, parent, by, created_at, updated_at, run_after)
         VALUES (?, ?, 'succeeded', 1, ?, ?, ?, 0, 1, ?, ?, ?, ?, 0)`,
      )
      .run(
        id,
        opts.kind,
        opts.message ?? null,
        JSON.stringify(opts.input ?? null),
        JSON.stringify(opts.result ?? null),
        opts.parent ?? null,
        opts.by,
        at,
        at,
      );
    const job = this.mustGet(id);
    this.emit("job", job);
    return job;
  }

  get(id: string): Job | undefined {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Row | undefined;
    return row ? toJob(row) : undefined;
  }

  private mustGet(id: string): Job {
    const job = this.get(id);
    if (!job) throw new Error(`job ${id} vanished`);
    return job;
  }

  /** Newest first. `cursor` is the id of the last job of the previous page. */
  list(opts: { status?: string | undefined; limit: number; cursor?: string | undefined }): {
    jobs: Job[];
    next?: string;
  } {
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.status) {
      where.push("status = ?");
      params.push(opts.status);
    }
    if (opts.cursor) {
      where.push("id < ?");
      params.push(opts.cursor);
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM jobs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`,
      )
      .all(...params, opts.limit + 1) as Row[];
    const page = rows.slice(0, opts.limit).map(toJob);
    const last = page[page.length - 1];
    return rows.length > opts.limit && last ? { jobs: page, next: last.id } : { jobs: page };
  }

  /** Children of a job, oldest first. */
  children(parent: string): Job[] {
    return (
      this.db.prepare("SELECT * FROM jobs WHERE parent = ? ORDER BY id").all(parent) as Row[]
    ).map(toJob);
  }

  /** Cancels a queued or running job. Running handlers see their signal abort. */
  cancel(id: string): Job {
    const job = this.get(id);
    if (!job) {
      throw new CitegeistError({
        code: "JOB_NOT_FOUND",
        message: `no job with id '${id}'`,
        fix: "Call jobs.list to see recent jobs.",
        recovery: "fix-and-retry",
        context: { id },
      });
    }
    if (TERMINAL.has(job.status)) return job;
    this.update(id, { status: "cancelled", message: "cancelled" });
    this.running.get(id)?.abort();
    return this.mustGet(id);
  }

  /** Resolves with the final state once the job is succeeded, failed or cancelled. */
  waitFor(id: string): Promise<Job> {
    const now = this.get(id);
    if (!now) return Promise.reject(new Error(`job ${id} does not exist`));
    if (TERMINAL.has(now.status)) return Promise.resolve(now);
    return new Promise((resolve) => {
      const onJob = (job: Job): void => {
        if (job.id === id && TERMINAL.has(job.status)) {
          this.off("job", onJob);
          resolve(job);
        }
      };
      this.on("job", onJob);
    });
  }

  /** Resolves when nothing is queued (including delayed retries) or running. */
  async idle(): Promise<void> {
    for (;;) {
      const open = this.db
        .prepare("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued', 'running')")
        .get() as { n: number };
      if (open.n === 0 && this.active.size === 0) return;
      if (this.closed) return;
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    for (const c of this.running.values()) c.abort();
    await Promise.allSettled([...this.active]);
    this.db.close();
  }

  // Scheduling ---------------------------------------------------------------------------------

  private pump(): void {
    if (!this.started || this.closed) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    const nowMs = this.now().getTime();
    for (const [kind, cfg] of this.kinds) {
      let free = cfg.concurrency - (this.runningByKind.get(kind) ?? 0);
      if (free <= 0) continue;
      const rows = this.db
        .prepare(
          "SELECT id FROM jobs WHERE kind = ? AND status = 'queued' AND run_after <= ? ORDER BY id LIMIT ?",
        )
        .all(kind, nowMs, free) as { id: string }[];
      for (const { id } of rows) {
        if (free-- <= 0) break;
        this.run(id, kind);
      }
    }
    const next = this.db
      .prepare("SELECT MIN(run_after) AS t FROM jobs WHERE status = 'queued' AND run_after > ?")
      .get(nowMs) as { t: number | null };
    if (next.t !== null) {
      this.timer = setTimeout(
        () => {
          this.timer = undefined;
          this.pump();
        },
        Math.max(1, next.t - nowMs),
      );
      this.timer.unref?.();
    }
  }

  private run(id: string, kind: string): void {
    const cfg = this.kinds.get(kind);
    if (!cfg) return;
    this.runningByKind.set(kind, (this.runningByKind.get(kind) ?? 0) + 1);
    const controller = new AbortController();
    this.running.set(id, controller);
    this.update(id, { status: "running", attempts: "+1", message: null });
    const job = this.mustGet(id);
    const task: Promise<void> = (async () => {
      try {
        const result = await cfg.handler({
          job,
          signal: controller.signal,
          progress: (value, message) => {
            if (this.get(id)?.status !== "running") return;
            this.update(id, {
              progress: Math.max(0, Math.min(1, value)),
              ...(message !== undefined ? { message } : {}),
            });
          },
          queue: this,
        });
        if (this.get(id)?.status === "running") {
          this.update(id, {
            status: "succeeded",
            progress: 1,
            result: result === undefined ? null : result,
            error: null,
          });
        }
      } catch (err) {
        this.fail(id, err, cfg.maxAttempts);
      }
    })().finally(() => {
      this.running.delete(id);
      this.runningByKind.set(kind, Math.max(0, (this.runningByKind.get(kind) ?? 1) - 1));
      this.active.delete(task);
      this.pump();
    });
    this.active.add(task);
  }

  private fail(id: string, err: unknown, kindMax: number): void {
    if (this.closed || this.get(id)?.status !== "running") return;
    const job = this.mustGet(id);
    const message = err instanceof Error ? err.message : String(err);
    const code =
      err instanceof CitegeistError
        ? err.detail.code
        : typeof (err as { code?: unknown })?.code === "string" &&
            /^[A-Z][A-Z0-9_]+$/.test((err as { code: string }).code)
          ? (err as { code: string }).code
          : "JOB_FAILED";
    const row = this.db.prepare("SELECT max_attempts FROM jobs WHERE id = ?").get(id) as {
      max_attempts: number;
    };
    const max = row.max_attempts || kindMax;
    if (isTransient(err) && job.attempts < max) {
      this.update(id, {
        status: "queued",
        message: `retrying after attempt ${job.attempts}: ${message}`,
        error: { code, message },
        runAfter: this.now().getTime() + this.backoff(job.attempts),
      });
      return;
    }
    this.update(id, { status: "failed", message, error: { code, message } });
  }

  private update(
    id: string,
    patch: {
      status?: string;
      progress?: number;
      message?: string | null;
      result?: unknown;
      error?: unknown;
      attempts?: "+1";
      runAfter?: number;
    },
  ): void {
    const sets: string[] = ["updated_at = ?"];
    const params: unknown[] = [this.now().toISOString()];
    if (patch.status !== undefined) {
      sets.push("status = ?");
      params.push(patch.status);
    }
    if (patch.progress !== undefined) {
      sets.push("progress = ?");
      params.push(patch.progress);
    }
    if (patch.message !== undefined) {
      sets.push("message = ?");
      params.push(patch.message);
    }
    if (patch.result !== undefined) {
      sets.push("result_json = ?");
      params.push(JSON.stringify(patch.result));
    }
    if (patch.error !== undefined) {
      sets.push("error_json = ?");
      params.push(patch.error === null ? null : JSON.stringify(patch.error));
    }
    if (patch.attempts) sets.push("attempts = attempts + 1");
    if (patch.runAfter !== undefined) {
      sets.push("run_after = ?");
      params.push(patch.runAfter);
    }
    this.db.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).run(...params, id);
    this.emit("job", this.mustGet(id));
  }
}

function toJob(r: Row): Job {
  return Job.parse({
    id: r.id,
    kind: r.kind,
    status: r.status,
    progress: r.progress,
    ...(r.message !== null ? { message: r.message } : {}),
    input: r.input_json === null ? null : JSON.parse(r.input_json),
    ...(r.result_json !== null ? { result: JSON.parse(r.result_json) } : {}),
    ...(r.error_json !== null ? { error: JSON.parse(r.error_json) } : {}),
    attempts: r.attempts,
    ...(r.parent !== null ? { parent: r.parent } : {}),
    by: r.by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
}
