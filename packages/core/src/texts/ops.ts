import type { ProcessRunner } from "@citegeist/ai";
import {
  pandocSetup,
  pandocStatus,
  type Registry,
  textsCreate,
  textsExport,
  textsGet,
  textsList,
  textsUpdate,
} from "@citegeist/ops";
import type { JobQueue } from "../jobs/queue.js";
import { installPandoc, type PandocSpec } from "./pandoc.js";
import { type TextsDeps, TextsService } from "./service.js";

export interface TextsOperationDeps extends Omit<TextsDeps, "localBase"> {
  localBase: string;
  /** The core's job queue; `pandoc.setup` runs as a job on it. */
  queue: JobQueue;
  /**
   * True in a one-shot process (the CLI) whose queue never runs: `pandoc.setup` then downloads
   * right away instead of leaving a job nobody picks up.
   */
  inline?: boolean;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  runner?: ProcessRunner;
  /** The release to download; default is the pin in pandoc.ts. */
  spec?: PandocSpec;
}

function pandocSpecDeps(deps: TextsOperationDeps) {
  return {
    localBase: deps.localBase,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...(deps.runner ? { runner: deps.runner } : {}),
    ...(deps.spec ? { spec: deps.spec } : {}),
  };
}

/**
 * Binds texts.* and pandoc.* (docs/decisions/0002-writing-in-markdown-with-pandoc.md) and registers the `pandoc-setup` job. Texts are plain files
 * under projects/<project>/texts/, so the chat turn journal covers them like every other note.
 */
export function bindTextsOperations(
  registry: Registry,
  lib: import("../library.js").Library,
  deps: TextsOperationDeps,
): TextsService {
  const service = new TextsService(lib, deps);
  const { queue } = deps;

  queue.register(
    "pandoc-setup",
    async (ctx) =>
      installPandoc({ progress: ctx.progress, signal: ctx.signal }, pandocSpecDeps(deps)),
    { concurrency: 1, maxAttempts: 1 },
  );

  const activeSetup = (): { id: string } | undefined => {
    for (const status of ["running", "queued"]) {
      const job = queue.list({ status, limit: 50 }).jobs.find((j) => j.kind === "pandoc-setup");
      if (job) return job;
    }
    return undefined;
  };

  registry
    .bind(textsList, async (_ctx, input) => service.list(input.project))
    .bind(textsGet, async (_ctx, input) => service.get(input.project, input.text))
    .bind(textsCreate, async (ctx, input) => service.create(ctx.actor, input))
    .bind(textsUpdate, async (_ctx, input) => service.update(input))
    .bind(textsExport, async (ctx, input) => service.export(ctx.actor, input))
    .bind(pandocStatus, async () => service.status())
    .bind(pandocSetup, async (ctx) => {
      const existing = activeSetup();
      if (existing) return { job: existing.id };
      if (deps.inline) {
        const installed = await installPandoc({ progress: () => undefined }, pandocSpecDeps(deps));
        return {
          job: queue.enqueueFinished({
            kind: "pandoc-setup",
            by: ctx.actor,
            result: installed,
            message: `Pandoc ${installed.version} ready`,
          }).id,
        };
      }
      return {
        job: queue.enqueue({ kind: "pandoc-setup", by: ctx.actor, maxAttempts: 1 }).id,
      };
    });
  return service;
}
