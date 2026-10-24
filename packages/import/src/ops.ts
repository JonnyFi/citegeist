import {
  ImportOptions,
  type ImportReport,
  type ImportResult,
  type ImportSource,
  importPreview,
  importRun,
  type Registry,
} from "@citegeist/ops";
import type { Actor } from "@citegeist/schema";
import { executePlan } from "./execute.js";
import { bundleFromFile, type GenericDeps } from "./generic.js";
import { buildPlan, type Plan, toReport } from "./plan.js";
import type { ImportHost, SourceBundle } from "./types.js";
import { type ApiFetch, readZoteroApi } from "./zotero/api.js";
import { bundleFromZotero } from "./zotero/convert.js";
import { readZoteroSqlite } from "./zotero/sqlite.js";

/** The slice of the core's job queue that import jobs need. `JobQueue` fits as it is. */
export interface ImportJobContext {
  job: { id: string; input?: unknown };
  signal: AbortSignal;
  progress(value: number, message?: string): void;
}

export interface ImportQueuePort {
  register(
    kind: "import",
    handler: (ctx: ImportJobContext) => Promise<unknown>,
    opts?: { concurrency?: number; maxAttempts?: number },
  ): unknown;
  enqueue(opts: { kind: "import"; input?: unknown; by: Actor; maxAttempts?: number }): {
    id: string;
  };
}

export interface ImportDeps extends GenericDeps {
  host: ImportHost;
  queue: ImportQueuePort;
  now?: () => Date;
  /** For tests: replaces the HTTP client of the Zotero API reader. */
  fetch?: ApiFetch;
}

/** Reads a source into the common shape. The caller disposes the bundle. */
export async function loadBundle(
  source: ImportSource,
  options: ImportOptions,
  deps: Pick<ImportDeps, "pdfDoi" | "fetch">,
  signal?: AbortSignal,
): Promise<SourceBundle> {
  if (source.kind === "zotero-sqlite") {
    const raw = readZoteroSqlite({ path: source.path, storage: source.storage });
    try {
      return await bundleFromZotero(raw, { options });
    } catch (err) {
      await raw.dispose?.();
      throw err;
    }
  }
  if (source.kind === "zotero-api") {
    const raw = await readZoteroApi({ port: source.port, fetch: deps.fetch, signal });
    try {
      return await bundleFromZotero(raw, { options });
    } catch (err) {
      await raw.dispose?.();
      throw err;
    }
  }
  return bundleFromFile(source, options, { pdfDoi: deps.pdfDoi });
}

async function projectSlugs(registry: Registry): Promise<Set<string>> {
  try {
    const res = (await registry.call("projects.list", { actor: "system" }, {})) as {
      projects: { slug: string }[];
    };
    return new Set(res.projects.map((p) => p.slug));
  } catch {
    return new Set();
  }
}

async function planFor(
  registry: Registry,
  deps: ImportDeps,
  source: ImportSource,
  options: ImportOptions,
  signal?: AbortSignal,
): Promise<Plan> {
  const bundle = await loadBundle(source, options, deps, signal);
  try {
    return buildPlan({
      bundle,
      options,
      host: deps.host,
      existingProjects: await projectSlugs(registry),
      now: deps.now?.() ?? new Date(),
    });
  } catch (err) {
    await bundle.dispose?.();
    throw err;
  }
}

/** Dry run: reads the source and reports what a run would do. Nothing is written. */
export async function previewImport(
  registry: Registry,
  deps: ImportDeps,
  source: ImportSource,
  options: ImportOptions,
): Promise<ImportReport> {
  const plan = await planFor(registry, deps, source, options);
  try {
    return toReport(plan);
  } finally {
    await plan.bundle.dispose?.();
  }
}

/**
 * Binds import.preview and import.run. The run is a job of kind "import" in the core's queue; it
 * writes as the actor "system" and stamps what it creates with `<source>@<date>`.
 */
export function bindImportOperations<R extends Registry>(registry: R, deps: ImportDeps): R {
  deps.queue.register(
    "import",
    async (ctx) => {
      const input = ctx.job.input as { source: ImportSource; options: ImportOptions };
      const plan = await planFor(registry, deps, input.source, input.options, ctx.signal);
      try {
        ctx.progress(0, `${plan.counts.create} new, ${plan.counts.merge + plan.counts.skip} known`);
        const result: ImportResult = await executePlan(plan, {
          host: deps.host,
          call: (name, body) => registry.call(name, { actor: "system" }, body),
          progress: (value, message) => ctx.progress(value, message),
          signal: ctx.signal,
        });
        return result;
      } finally {
        await plan.bundle.dispose?.();
      }
    },
    // One import at a time. A repeat would only find its own items as duplicates.
    { concurrency: 1, maxAttempts: 1 },
  );

  registry
    .bind(importPreview, async (_ctx, input) => {
      const { source, ...options } = input;
      return previewImport(registry, deps, source, ImportOptions.parse(options));
    })
    .bind(importRun, async (ctx, input) => {
      const { source, ...options } = input;
      const job = deps.queue.enqueue({
        kind: "import",
        input: { source, options: ImportOptions.parse(options) },
        by: ctx.actor,
        maxAttempts: 1,
      });
      return { job: job.id };
    });
  return registry;
}
