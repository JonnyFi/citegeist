import type { GraphLookup } from "@citegeist/metadata";
import {
  graphAddCandidates,
  graphCiting,
  graphReferences,
  graphRelated,
  itemsCheckRetractions,
  type Registry,
} from "@citegeist/ops";
import type { Actor } from "@citegeist/schema";
import type { JobQueue } from "../jobs/index.js";
import type { Library } from "../library.js";
import { type AddItem, addCandidates } from "./candidates.js";
import { listCiting, listReferences } from "./graph.js";
import { checkRetractions, type RetractionReport } from "./retractions.js";
import {
  LIBRARY_CHECKS,
  type LibraryChecks,
  registerLibraryChecks,
  type ScheduleOptions,
  scheduleLibraryChecks,
} from "./schedule.js";
import { linkVersions, type VersionReport } from "./versions.js";

export {
  type AddCandidatesInput,
  type AddCandidatesResult,
  type AddItem,
  addCandidates,
} from "./candidates.js";
export {
  type CitingList,
  listCiting,
  listReferences,
  type ReferenceList,
  type ReferenceSource,
  readRefsJsonl,
  workFromRefsEntry,
} from "./graph.js";
export { findInLibrary, markWorks } from "./marking.js";
export {
  type CheckOptions,
  checkRetractions,
  type FlaggedItem,
  listFlagged,
  type MarkerStatus,
  markerStatus,
  type RetractionReport,
  retractionOf,
} from "./retractions.js";
export {
  LIBRARY_CHECKS,
  type LibraryChecks,
  type LibraryChecksResult,
  registerLibraryChecks,
  runLibraryChecks,
  type ScheduleOptions,
  scheduleLibraryChecks,
} from "./schedule.js";
export {
  findPublished,
  type LinkVersionsOptions,
  linkVersions,
  publishedVersionOf,
  type VersionEntry,
  type VersionReport,
  versionsOf,
} from "./versions.js";

export interface GraphDeps {
  /** The metadata resolver: `createResolver(...)` implements GraphLookup. */
  lookup: GraphLookup;
  /** `IngestService.addItem`, bound to its service. */
  addItem: AddItem;
  /**
   * The job queue (`ingest.queue`). With it, items.checkRetractions for the whole library runs
   * as a job and the periodic check can be scheduled. Without it the whole-library check runs
   * inside the call.
   */
  queue?: JobQueue;
}

export class GraphService {
  private checks: LibraryChecks | undefined;

  constructor(
    readonly lib: Library,
    readonly deps: GraphDeps,
  ) {}

  checkRetractions(actor: Actor, citekeys?: string[]): Promise<RetractionReport> {
    return checkRetractions(this.lib, this.deps.lookup, actor, { citekeys });
  }

  linkVersions(actor: Actor, citekeys?: string[]): Promise<VersionReport> {
    return linkVersions(this.lib, this.deps.lookup, actor, { citekeys });
  }

  /**
   * Starts the periodic check of the whole library (retractions and versions). Call once after
   * the runtime has started its queue; `stop()` it when the library closes.
   */
  schedule(options?: ScheduleOptions): LibraryChecks {
    const queue = this.deps.queue;
    if (!queue) throw new Error("scheduling the library checks needs the job queue");
    this.checks?.stop();
    this.checks = scheduleLibraryChecks(queue, this.lib, this.deps.lookup, options);
    return this.checks;
  }

  stop(): void {
    this.checks?.stop();
    this.checks = undefined;
  }
}

/**
 * Binds graph.references, graph.citing, graph.addCandidates and items.checkRetractions. The
 * whole-library retraction check is the same job as the periodic one (kind `enrich`), so the
 * handler is registered here whenever a queue is given.
 */
export function bindGraphOperations(
  registry: Registry,
  lib: Library,
  deps: GraphDeps,
): GraphService {
  const service = new GraphService(lib, deps);
  const queue = deps.queue;
  if (queue) registerLibraryChecks(queue, lib, deps.lookup);

  registry
    .bind(graphReferences, async (_ctx, input) => listReferences(lib, deps.lookup, input))
    .bind(graphCiting, async (_ctx, input) => listCiting(lib, deps.lookup, input))
    .bind(graphRelated, async (_ctx, input) => {
      if (input.direction === "references") {
        const out = await listReferences(lib, deps.lookup, {
          citekey: input.citekey,
          limit: input.limit,
        });
        return {
          citekey: out.citekey,
          direction: input.direction,
          ...(out.source ? { source: out.source } : {}),
          total: out.total,
          works: out.references,
          counts: out.counts,
          errors: out.errors,
        };
      }
      const out = await listCiting(lib, deps.lookup, {
        citekey: input.citekey,
        limit: input.limit,
        ...(input.cursor ? { cursor: input.cursor } : {}),
      });
      return {
        citekey: out.citekey,
        direction: input.direction,
        total: out.total,
        works: out.citing,
        counts: out.counts,
        errors: [],
        ...(out.next ? { next: out.next } : {}),
      };
    })
    .bind(graphAddCandidates, async (ctx, input) =>
      addCandidates(
        ctx.actor,
        { lookup: deps.lookup, addItem: deps.addItem },
        {
          candidates: input.candidates,
          from: input.from,
          via: input.via,
          projects: input.projects,
          tags: input.tags,
        },
      ),
    )
    .bind(itemsCheckRetractions, async (ctx, input) => {
      if (!input.citekeys && queue) {
        const job = queue.enqueue({
          kind: "enrich",
          by: ctx.actor,
          input: { task: LIBRARY_CHECKS },
          maxAttempts: 1,
        });
        return { job: job.id, checked: 0, flagged: [], cleared: [], skipped: 0, errors: [] };
      }
      const report = await service.checkRetractions(ctx.actor, input.citekeys);
      return report;
    });
  return service;
}
