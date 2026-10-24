import type { Job } from "@citegeist/schema";
import type { EnqueueOptions, JobContext, JobHandler, JobQueue, KindOptions } from "./queue.js";

type Kind = EnqueueOptions["kind"];

/**
 * A view of the queue for one user of a shared job kind. It has the four methods that the users
 * of a kind (chat research, webhook tasks) call on the queue, and its `register` keeps the handler
 * for this user only.
 */
export interface KindPort<K extends Kind> {
  newId(): string;
  enqueue(opts: Omit<EnqueueOptions, "kind"> & { kind: K }): { id: string };
  get(id: string): Job | undefined;
  register(kind: K, handler: JobHandler, opts?: KindOptions): unknown;
}

export interface SharedKind<K extends Kind> {
  /**
   * A port for one user of the kind. `owns` tells from the input of a job whether it belongs to
   * this user. The first port that owns a job and has a handler runs it. The concurrency passed to
   * `register` is kept per port, because the queue itself allows one limit per kind.
   */
  port(owns: (input: unknown) => boolean): KindPort<K>;
}

class Gate {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  limit = 1;

  async run<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    while (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active++;
    try {
      if (signal.aborted) throw new Error("the job was cancelled before it started");
      return await work();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

interface Entry {
  owns: (input: unknown) => boolean;
  handler?: JobHandler;
  gate: Gate;
}

/**
 * Lets several users share one job kind. The queue keeps one handler and one concurrency limit per
 * kind, and `register` replaces what was there, so two users of the same kind would switch each
 * other off. `shareKind` registers one dispatcher for the kind and gives every user a port:
 * handlers stay apart, each keeps its own concurrency limit, and the job table keeps the single
 * kind the UI knows.
 */
export function shareKind<K extends Kind>(queue: JobQueue, kind: K): SharedKind<K> {
  const entries: Entry[] = [];
  queue.register(
    kind,
    async (ctx: JobContext) => {
      const entry = entries.find((e) => e.handler && e.owns(ctx.job.input));
      if (!entry?.handler) throw new Error(`no handler for this ${kind} job`);
      const handler = entry.handler;
      return entry.gate.run(ctx.signal, () => handler(ctx));
    },
    // The limits of the users are enforced by their gates.
    { concurrency: 1000, maxAttempts: 1 },
  );
  return {
    port(owns) {
      const entry: Entry = { owns, gate: new Gate() };
      entries.push(entry);
      return {
        newId: () => queue.newId(),
        enqueue: (opts) => queue.enqueue(opts),
        get: (id) => queue.get(id),
        register(_kind, handler, opts: KindOptions = {}) {
          entry.handler = handler;
          entry.gate.limit = opts.concurrency ?? 1;
        },
      };
    },
  };
}
