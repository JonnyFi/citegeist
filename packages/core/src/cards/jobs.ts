import type { Actor } from "@citegeist/schema";
import { ulid } from "../ids.js";

/** One unit of background work. The queue decides when `run` is called. */
export interface CardJobSpec {
  kind: "ai-task";
  /** Human readable label such as `card.paraphrase c_01...`. */
  label: string;
  by: Actor;
  input: unknown;
  run(): Promise<unknown>;
}

/** The part of the core job queue the card operations need. Returns a job id (`j_<ULID>`). */
export interface CardJobQueue {
  enqueue(job: CardJobSpec): string;
}

export interface DetachedJob {
  id: string;
  label: string;
  status: "running" | "succeeded" | "failed";
  error?: { code: string; message: string };
}

/**
 * Fallback when no job queue is injected: the work starts right away on the event loop, detached
 * from the caller. Failures are recorded on the job and never thrown into the caller.
 */
export class DetachedJobs implements CardJobQueue {
  readonly jobs = new Map<string, DetachedJob>();
  private readonly running = new Set<Promise<void>>();

  enqueue(spec: CardJobSpec): string {
    const id = `j_${ulid()}`;
    const job: DetachedJob = { id, label: spec.label, status: "running" };
    this.jobs.set(id, job);
    const p: Promise<void> = new Promise<void>((resolve) => setImmediate(resolve))
      .then(() => spec.run())
      .then(() => {
        job.status = "succeeded";
      })
      .catch((err: unknown) => {
        job.status = "failed";
        const e = err as { detail?: { code?: string }; message?: string };
        job.error = {
          code: e.detail?.code ?? "JOB_FAILED",
          message: e.message ?? String(err),
        };
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
