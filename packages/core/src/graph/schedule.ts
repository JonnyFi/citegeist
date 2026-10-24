import type { GraphLookup } from "@citegeist/metadata";
import type { Actor } from "@citegeist/schema";
import type { JobContext, JobQueue } from "../jobs/index.js";
import type { Library } from "../library.js";
import { checkRetractions, type RetractionReport } from "./retractions.js";
import { linkVersions, type VersionReport } from "./versions.js";

const DAY = 24 * 60 * 60 * 1000;

/** Marker in the job input that tells this job apart from other jobs of the kind `enrich`. */
export const LIBRARY_CHECKS = "library-checks";

export interface LibraryChecksResult {
  retractions: Pick<RetractionReport, "checked" | "skipped"> & {
    flagged: number;
    changed: number;
    cleared: number;
    errors: number;
  };
  versions: { checked: number; linked: number; available: number; errors: number };
}

export interface ScheduleOptions {
  /** Time between two runs. Default one week. */
  intervalMs?: number;
  /** Wait before the first check whether a run is due. Default ten minutes. */
  firstDelayMs?: number;
  /** How often the timer looks whether a run is due. Default one hour. */
  pollMs?: number;
  /** Clock, for tests. */
  now?: () => number;
}

export interface LibraryChecks {
  /** Queues a run now, unless one is queued or running. Returns the job id. */
  enqueue(by?: Actor): string | undefined;
  /** Queues a run if the last successful one is older than the interval. */
  tick(): string | undefined;
  stop(): void;
}

/** What one run does: the retraction check of the whole library, then the version links. */
export async function runLibraryChecks(
  lib: Library,
  lookup: GraphLookup,
  actor: Actor,
  ctx?: Pick<JobContext, "signal" | "progress">,
): Promise<LibraryChecksResult> {
  const retractions = await checkRetractions(lib, lookup, actor, {
    signal: ctx?.signal,
    progress: ctx ? (f, m) => ctx.progress(f * 0.6, m) : undefined,
  });
  let versions: VersionReport;
  try {
    versions = await linkVersions(lib, lookup, actor, {
      signal: ctx?.signal,
      progress: ctx ? (f, m) => ctx.progress(0.6 + f * 0.4, m) : undefined,
    });
  } catch (err) {
    if (ctx?.signal.aborted) throw err;
    versions = {
      checked: 0,
      linked: [],
      available: [],
      errors: [{ citekey: "*", message: String(err) }],
    };
  }
  return {
    retractions: {
      checked: retractions.checked,
      skipped: retractions.skipped,
      flagged: retractions.flagged.length,
      changed: retractions.flagged.filter((f) => f.changed).length,
      cleared: retractions.cleared.length,
      errors: retractions.errors.length,
    },
    versions: {
      checked: versions.checked,
      linked: versions.linked.length,
      available: versions.available.length,
      errors: versions.errors.length,
    },
  };
}

function isLibraryChecks(input: unknown): boolean {
  return (input as { task?: unknown } | null)?.task === LIBRARY_CHECKS;
}

/** Registers the handler for jobs of kind `enrich` whose input is `{ task: "library-checks" }`. */
export function registerLibraryChecks(queue: JobQueue, lib: Library, lookup: GraphLookup): void {
  queue.register(
    "enrich",
    async (ctx) => {
      if (!isLibraryChecks(ctx.job.input)) return undefined;
      return runLibraryChecks(lib, lookup, ctx.job.by, ctx);
    },
    { concurrency: 1, maxAttempts: 1 },
  );
}

/**
 * The periodic job for the whole library: registers the handler for jobs of kind `enrich` with
 * `input.task = "library-checks"` and starts a timer that queues a run when the last successful
 * one is older than the interval (default a week, docs/research/metadata-sources.md section 12).
 * The state is the job table itself, so a restart does not start an extra run. A run never
 * overlaps another. The timer does not keep the process alive.
 */
export function scheduleLibraryChecks(
  queue: JobQueue,
  lib: Library,
  lookup: GraphLookup,
  options: ScheduleOptions = {},
): LibraryChecks {
  const interval = options.intervalMs ?? 7 * DAY;
  const now = options.now ?? Date.now;
  registerLibraryChecks(queue, lib, lookup);

  const open = (status: string): boolean =>
    queue
      .list({ status, limit: 100 })
      .jobs.some((j) => j.kind === "enrich" && isLibraryChecks(j.input));

  const enqueue = (by: Actor = "system"): string | undefined => {
    if (open("queued") || open("running")) return undefined;
    return queue.enqueue({ kind: "enrich", by, input: { task: LIBRARY_CHECKS }, maxAttempts: 1 })
      .id;
  };

  const tick = (): string | undefined => {
    const last = queue
      .list({ status: "succeeded", limit: 100 })
      .jobs.find((j) => j.kind === "enrich" && isLibraryChecks(j.input));
    if (last && now() - Date.parse(last.updatedAt) < interval) return undefined;
    return enqueue("system");
  };

  let timer: NodeJS.Timeout | undefined;
  let first: NodeJS.Timeout | undefined;
  const poll = options.pollMs ?? 60 * 60 * 1000;
  first = setTimeout(
    () => {
      first = undefined;
      tick();
      timer = setInterval(tick, poll);
      timer.unref();
    },
    options.firstDelayMs ?? 10 * 60 * 1000,
  );
  first.unref();

  return {
    enqueue,
    tick,
    stop() {
      if (first) clearTimeout(first);
      if (timer) clearInterval(timer);
      first = undefined;
      timer = undefined;
    },
  };
}
