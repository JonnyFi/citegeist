import type { JobQueue } from "../jobs/index.js";
import type { SemanticSearch } from "./hybrid.js";

/** Runs `semantic.sync()` as the background job kind "embed". One job at a time. */
export function registerEmbedJob(queue: JobQueue, semantic: SemanticSearch): void {
  queue.register(
    "embed",
    async (ctx) => {
      const report = await semantic.sync({
        signal: ctx.signal,
        onProgress: (done, total) =>
          ctx.progress(total === 0 ? 1 : done / total, `embedded ${done} of ${total} passages`),
      });
      return report;
    },
    // A failed model download is worth another try; a broken model is not.
    { concurrency: 1, maxAttempts: 2 },
  );
}

export interface EmbedSchedulerOptions {
  /** Quiet time after the last change before a job is queued. Default 2000 ms. */
  debounceMs?: number;
}

/**
 * Queues an "embed" job after indexing. `notify()` is called for every indexed or removed file;
 * bursts (an import, a folder sync) collapse into one job. A job that is already waiting covers
 * the change, and a change that arrives while a job runs queues one more.
 */
export class EmbedScheduler {
  private timer: NodeJS.Timeout | undefined;
  private closed = false;

  constructor(
    private readonly queue: JobQueue,
    private readonly opts: EmbedSchedulerOptions = {},
  ) {}

  notify(): void {
    if (this.closed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.enqueueNow(), this.opts.debounceMs ?? 2000);
    this.timer.unref?.();
  }

  /** Queues a job right away unless one is already waiting. Returns its id, if one was queued. */
  enqueueNow(): string | undefined {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.closed) return undefined;
    const waiting = this.queue
      .list({ status: "queued", limit: 50 })
      .jobs.some((j) => j.kind === "embed");
    if (waiting) return undefined;
    return this.queue.enqueue({ kind: "embed", by: "system", input: { reason: "index changed" } })
      .id;
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
