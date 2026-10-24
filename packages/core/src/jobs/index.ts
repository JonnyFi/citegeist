import { jobsGet, jobsList, type Registry } from "@citegeist/ops";
import { CitegeistError } from "@citegeist/schema";
import type { JobQueue } from "./queue.js";

export {
  type EnqueueOptions,
  isTransient,
  type JobContext,
  type JobHandler,
  JobQueue,
  type KindOptions,
  type QueueOptions,
  TransientError,
} from "./queue.js";
export { currentJobScope, type JobScope, runInJobScope } from "./scope.js";
export { type KindPort, type SharedKind, shareKind } from "./shared-kind.js";

/** Binds jobs.get and jobs.list to a queue. */
export function bindJobOperations(registry: Registry, queue: JobQueue): Registry {
  return registry
    .bind(jobsGet, async (_ctx, input) => {
      const job = queue.get(input.job);
      if (!job) {
        throw new CitegeistError({
          code: "JOB_NOT_FOUND",
          message: `no job with id '${input.job}'`,
          fix: "Call jobs.list to see recent jobs.",
          recovery: "fix-and-retry",
          context: { job: input.job },
        });
      }
      return job;
    })
    .bind(jobsList, async (_ctx, input) =>
      queue.list({ status: input.status, limit: input.limit, cursor: input.cursor }),
    );
}
