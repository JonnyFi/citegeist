import type { AiRouter, RunTaskOptions, TaskName, UsageRecord } from "@citegeist/ai";
import { currentJobScope } from "../jobs/scope.js";
import type { UsageLedger } from "./ledger.js";

/** Writes one finished AI task into the ledger. A broken ledger never breaks the call. */
export function recordTask(ledger: UsageLedger, r: UsageRecord, fallbackActor: string): void {
  try {
    ledger.record({
      source: "task",
      task: r.task,
      backend: r.backend,
      model: r.model,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cacheReadTokens: r.cacheReadTokens,
      cacheWriteTokens: r.cacheWriteTokens,
      costUsd: r.costUsd,
      ms: r.ms,
      ok: r.ok,
      error: r.error,
      actor: r.actor ?? fallbackActor,
      job: currentJobScope()?.job,
    });
  } catch {
    // The ledger is a report, not part of the work.
  }
}

/**
 * The AI entry point of the services. It runs a task on the router and adds what the services
 * should not have to know about: the abort signal and actor of the job it runs under, and the
 * entry in the usage ledger.
 */
export function meteredAi(
  router: () => Promise<Pick<AiRouter, "run">>,
  ledger: UsageLedger,
): Pick<AiRouter, "run"> {
  return {
    async run<N extends TaskName>(task: N, input: unknown, opts: RunTaskOptions = {}) {
      const scope = currentJobScope();
      const target = await router();
      return target.run(task, input, {
        ...opts,
        signal: opts.signal ?? scope?.signal,
        actor: opts.actor ?? scope?.actor,
        record: (r) => {
          recordTask(ledger, r, "human");
          opts.record?.(r);
        },
      });
    },
  };
}
