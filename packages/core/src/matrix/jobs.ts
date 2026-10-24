import type { Actor } from "@citegeist/schema";
import { ulid } from "../ids.js";
import type { JobQueue } from "../jobs/index.js";

/** What a running job gets: progress reporting and cancellation. */
export interface MatrixJobContext {
  /** Progress from 0 to 1 with an optional line of text. */
  progress(value: number, message?: string): void;
  signal: AbortSignal;
}

/** One unit of background work. Same shape as `CardJobSpec`, with a context for progress. */
export interface MatrixJobSpec {
  kind: "ai-task";
  label: string;
  by: Actor;
  input: unknown;
  run(ctx: MatrixJobContext): Promise<unknown>;
}

/**
 * The part of the job queue the matrix operations need. A `CardJobQueue` accepts the same specs
 * (a `run` that ignores the context), so one object can serve cards, links and matrices.
 */
export interface MatrixJobQueue {
  enqueue(spec: MatrixJobSpec): string;
}

/**
 * Registers the `ai-task` job kind on the core queue and returns the queue the AI operations
 * enqueue on. Progress and the result of a run show up in `jobs.get`. The runtime builds one of
 * these and hands it to the card, link and matrix operations.
 */
export function aiTaskJobs(queue: JobQueue): MatrixJobQueue {
  const runs = new Map<string, MatrixJobSpec["run"]>();
  queue.register(
    "ai-task",
    async (ctx) => {
      const run = runs.get(ctx.job.id);
      runs.delete(ctx.job.id);
      if (!run) throw new Error("the AI job was queued by an earlier session and cannot resume");
      return run({ progress: (v, m) => ctx.progress(v, m), signal: ctx.signal });
    },
    { concurrency: 2, maxAttempts: 1 },
  );
  return {
    enqueue(spec) {
      const id = queue.newId();
      runs.set(id, spec.run);
      queue.enqueue({
        id,
        kind: spec.kind,
        by: spec.by,
        input: { label: spec.label, ...(spec.input as object) },
        maxAttempts: 1,
      });
      return id;
    },
  };
}

export interface DetachedMatrixJob {
  id: string;
  label: string;
  status: "running" | "succeeded" | "failed";
  progress: number;
  message?: string;
  result?: unknown;
  error?: { code: string; message: string };
}

/**
 * Fallback when no queue is injected, for one-shot processes and tests: the work starts on the
 * event loop, detached from the caller. Failures are recorded on the job and never thrown.
 */
export class DetachedMatrixJobs implements MatrixJobQueue {
  readonly jobs = new Map<string, DetachedMatrixJob>();
  private readonly running = new Set<Promise<void>>();
  private readonly abort = new AbortController();

  enqueue(spec: MatrixJobSpec): string {
    const id = `j_${ulid()}`;
    const job: DetachedMatrixJob = { id, label: spec.label, status: "running", progress: 0 };
    this.jobs.set(id, job);
    const ctx: MatrixJobContext = {
      signal: this.abort.signal,
      progress(value, message) {
        job.progress = Math.max(0, Math.min(1, value));
        if (message !== undefined) job.message = message;
      },
    };
    const p: Promise<void> = new Promise<void>((resolve) => setImmediate(resolve))
      .then(() => spec.run(ctx))
      .then((result) => {
        job.status = "succeeded";
        job.progress = 1;
        job.result = result;
      })
      .catch((err: unknown) => {
        job.status = "failed";
        const e = err as { detail?: { code?: string }; message?: string };
        job.error = { code: e.detail?.code ?? "JOB_FAILED", message: e.message ?? String(err) };
      })
      .finally(() => {
        this.running.delete(p);
      });
    this.running.add(p);
    return id;
  }

  /** Resolves when every job started so far has finished. */
  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.all([...this.running]);
  }
}
