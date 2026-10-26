import { AsyncLocalStorage } from "node:async_hooks";
import type { Actor } from "@citegeist/schema";

/**
 * What a running job tells the code it calls. The queue enters the scope around every handler, so
 * an AI call made anywhere below a job picks up the job's abort signal and its actor without every
 * service passing them along. Cancelling the job then stops the call.
 */
export interface JobScope {
  job: string;
  actor: Actor;
  signal: AbortSignal;
  /** Puts a short note on the job, shown next to it in the job list. */
  note?: (message: string) => void;
}

const store = new AsyncLocalStorage<JobScope>();

export function runInJobScope<T>(scope: JobScope, fn: () => T): T {
  return store.run(scope, fn);
}

/** The job the calling code runs for, if any. */
export function currentJobScope(): JobScope | undefined {
  return store.getStore();
}
