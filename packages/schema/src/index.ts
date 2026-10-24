import { z } from "zod";
import { CardBody, CardFrontmatter } from "./card.js";
import { Block, DerivedManifest, IdMap, Pages } from "./document.js";
import { AgentError } from "./errors.js";
import { ItemFrontmatter } from "./item.js";
import { Job } from "./job.js";
import { LibraryManifest } from "./library.js";
import { NoteFrontmatter } from "./note.js";
import { ProjectFrontmatter } from "./project.js";
import {
  WorkerConvertParams,
  WorkerConvertResult,
  WorkerHealthResult,
  WorkerProgress,
} from "./worker.js";

export * from "./card.js";
export * from "./common.js";
export * from "./document.js";
export * from "./errors.js";
export * from "./item.js";
export * from "./job.js";
export * from "./library.js";
export * from "./note.js";
export * from "./planning.js";
export * from "./project.js";
export * from "./worker.js";

/** Schemas exported as JSON Schema for agents and the Python worker (`pnpm --filter @citegeist/schema export`). */
export const EXPORTED_SCHEMAS = {
  item: ItemFrontmatter,
  card: CardFrontmatter,
  "card-body": CardBody,
  note: NoteFrontmatter,
  project: ProjectFrontmatter,
  library: LibraryManifest,
  block: Block,
  pages: Pages,
  "derived-manifest": DerivedManifest,
  idmap: IdMap,
  job: Job,
  "agent-error": AgentError,
  "worker-convert-params": WorkerConvertParams,
  "worker-convert-result": WorkerConvertResult,
  "worker-health-result": WorkerHealthResult,
  "worker-progress": WorkerProgress,
} as const;

export function toJsonSchemas(): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(EXPORTED_SCHEMAS).map(([k, s]) => [
      k,
      z.toJSONSchema(s, { io: "input", unrepresentable: "any" }),
    ]),
  );
}
