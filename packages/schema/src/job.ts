import { z } from "zod";
import { Actor, JobId } from "./common.js";

export const JobKind = z.enum([
  "ingest",
  "resolve-metadata",
  "fetch-source",
  "convert",
  "enrich",
  "embed",
  "ai-task",
  "research",
  "import",
  "export",
  "alerts",
  "worker-setup",
  /** A literature search run (workers/research pipeline.py). */
  "litsearch.run",
  /** Preprint check of the literature search. */
  "litsearch.preprints",
]);
export const JobStatus = z.enum(["queued", "running", "succeeded", "failed", "cancelled"]);

/** Jobs live in the machine-local state.sqlite, never in the library folder. */
export const Job = z.object({
  id: JobId,
  kind: JobKind,
  status: JobStatus,
  progress: z.number().min(0).max(1).default(0),
  message: z.string().optional(),
  input: z.unknown(),
  result: z.unknown().optional(),
  error: z.lazy(() => AgentErrorRef).optional(),
  attempts: z.number().int().nonnegative().default(0),
  parent: JobId.optional(),
  by: Actor,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Job = z.infer<typeof Job>;

const AgentErrorRef = z.object({ code: z.string(), message: z.string() });
