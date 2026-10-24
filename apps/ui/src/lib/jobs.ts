import type { Job } from "@citegeist/schema";

export type JobKind = Job["kind"];

export interface JobSummary {
  /** The job the slot shows: the running one that changed last, else the oldest queued one. */
  main: Job;
  /** Running and queued jobs. */
  active: readonly Job[];
  /** Finished jobs of the same kind as `main`, within the list that was passed in. */
  done: number;
  /** Jobs of the same kind as `main`: finished, running and queued. */
  total: number;
  /** Share of work finished across the jobs of that kind, 0 to 1. */
  progress: number;
}

const ACTIVE = new Set<Job["status"]>(["running", "queued"]);

/** Picks what the job slot in the top bar shows from a list of recent jobs, or null when idle. */
export function summarizeJobs(jobs: readonly Job[]): JobSummary | null {
  const active = jobs.filter((j) => ACTIVE.has(j.status));
  const running = active
    .filter((j) => j.status === "running")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const queued = active
    .filter((j) => j.status === "queued")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const main = running[0] ?? queued[0];
  if (!main) return null;
  const sameKind = jobs.filter((j) => j.kind === main.kind && j.status !== "cancelled");
  const done = sameKind.filter((j) => j.status === "succeeded" || j.status === "failed").length;
  const total = sameKind.length;
  const partial = sameKind
    .filter((j) => ACTIVE.has(j.status))
    .reduce((sum, j) => sum + (j.progress ?? 0), 0);
  const progress = total > 0 ? Math.min(1, (done + partial) / total) : 0;
  return { main, active, done, total, progress };
}
