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
});
export const WorkerConvertResult = z.object({ manifest: DerivedManifest });

export const WorkerHealthResult = z.object({
  version: z.string(),
  engines: z.record(z.string(), z.string()),
  ready: z.boolean(),
});

export const WORKER_METHODS = {
  convert: { params: WorkerConvertParams, result: WorkerConvertResult },
  health: { params: z.object({}), result: WorkerHealthResult },
} as const;
