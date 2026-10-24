import type { Job } from "@citegeist/schema";
import { describe, expect, it } from "vitest";
import { summarizeJobs } from "./jobs";

function job(n: number, status: Job["status"], extra: Partial<Job> = {}): Job {
  const at = `2026-10-24T10:00:0${n}.000Z`;
  return {
    id: `j_0TEST0000000000${n}`,
    kind: "convert",
    status,
    progress: status === "succeeded" ? 1 : 0,
    input: {},
    attempts: 1,
    by: "system",
    createdAt: at,
    updatedAt: at,
    ...extra,
  } as Job;
}

describe("summarizeJobs", () => {
  it("returns null when nothing runs", () => {
    expect(summarizeJobs([])).toBeNull();
    expect(summarizeJobs([job(1, "succeeded"), job(2, "failed")])).toBeNull();
  });

  it("counts finished and total jobs of the main kind and averages the progress", () => {
    const summary = summarizeJobs([
      job(1, "succeeded"),
      job(2, "succeeded"),
      job(3, "running", { progress: 0.5 }),
    ]);
    expect(summary).toMatchObject({ done: 2, total: 3 });
    expect(summary?.progress).toBeCloseTo(2.5 / 3);
    expect(summary?.active).toHaveLength(1);
  });

  it("shows the running job that changed last before a queued one", () => {
    const summary = summarizeJobs([
      job(1, "queued"),
      job(2, "running", { kind: "ai-task" }),
      job(3, "running", { kind: "research" }),
    ]);
    expect(summary?.main.kind).toBe("research");
    expect(summary?.active).toHaveLength(3);
  });

  it("falls back to the oldest queued job", () => {
    const summary = summarizeJobs([job(2, "queued"), job(1, "queued", { kind: "embed" })]);
    expect(summary?.main.kind).toBe("embed");
  });
});
