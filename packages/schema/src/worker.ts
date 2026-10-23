import { z } from "zod";
import { SourceHash } from "./common.js";
import { DerivedManifest } from "./document.js";

/**
 * JSON-RPC 2.0 over stdio between core and the Python conversion worker, one JSON object per line.
 * The worker writes all outputs into outDir and returns the manifest.
 */
export const WorkerConvertParams = z.object({
  sourcePath: z.string().min(1),
  source: SourceHash,
  outDir: z.string().min(1),
  kind: z.enum(["pdf", "arxiv-html", "web", "epub"]),
  ocr: z.enum(["auto", "force", "off"]).default("auto"),
  languages: z.array(z.string()).default(["de", "en"]),
  /** Previous blocks.jsonl to carry block ids over on re-conversion. */
  previousBlocks: z.string().optional(),
  pageRangeHint: z.string().optional(),
  /**
   * The arXiv PDF that goes with an `arxiv-html` source, used to map blocks to pages. Without it
   * the worker looks for `<name>.pdf` next to the HTML file.
   */
  pdfPath: z.string().optional(),
});
export const WorkerConvertResult = z.object({ manifest: DerivedManifest });

export const WorkerHealthResult = z.object({
  version: z.string(),
  engines: z.record(z.string(), z.string()),
  ready: z.boolean(),
});

/**
 * Notification the worker sends while a `convert` runs, as `{"jsonrpc":"2.0","method":"progress",
 * "params":{...}}` without an id. `id` names the request. A message without `fraction` (null or
 * absent) reports a step but no new position. The core shows both as the progress of the job.
 */
export const WorkerProgress = z.object({
  id: z.number().int(),
  message: z.string().optional(),
  fraction: z.number().min(0).max(1).nullish(),
});

export const WORKER_NOTIFICATIONS = {
  progress: WorkerProgress,
} as const;

export const WORKER_METHODS = {
  convert: { params: WorkerConvertParams, result: WorkerConvertResult },
  health: { params: z.object({}), result: WorkerHealthResult },
} as const;
