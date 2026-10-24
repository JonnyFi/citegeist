import {
  litsearchCancel,
  litsearchCompare,
  litsearchExport,
  litsearchGet,
  litsearchReport,
  litsearchResume,
  litsearchRuns,
  litsearchStart,
  litsearchSuggest,
  litsearchToInbox,
  litsearchWatchBackground,
  litsearchWatchDelete,
  litsearchWatches,
  litsearchWatchRun,
  litsearchWatchSave,
  litsearchWatchSeen,
  type Registry,
} from "@citegeist/ops";
import type { Library } from "../library.js";
import { type LitsearchDeps, LitsearchService } from "./service.js";

/**
 * Binds litsearch.suggest, start, resume, cancel, runs, get, export, report, toInbox,
 * compare and the watchlist operations. A run is a job of kind
 * "litsearch.run" on `deps.queue`. The other litsearch.* contracts answer OPERATION_NOT_IMPLEMENTED
 * until their part of issue #50 lands.
 */
export function bindLitsearchOperations(
  registry: Registry,
  lib: Library,
  deps: LitsearchDeps = {},
): Registry & { litsearch: LitsearchService } {
  const litsearch = new LitsearchService(lib, deps);
  registry
    .bind(litsearchSuggest, async (_ctx, input) => litsearch.suggest(input))
    .bind(litsearchStart, async (ctx, input) => litsearch.start(ctx.actor, input))
    .bind(litsearchResume, async (ctx, input) => litsearch.resume(ctx.actor, input.runId))
    .bind(litsearchCancel, async (_ctx, input) => litsearch.cancel(input.runId))
    .bind(litsearchRuns, async (_ctx, input) => litsearch.runs(input))
    .bind(litsearchGet, async (_ctx, input) => litsearch.get(input.runId))
    .bind(litsearchExport, async (_ctx, input) => litsearch.export(input.runId, input.format))
    .bind(litsearchReport, async (_ctx, input) => litsearch.report(input.runId))
    .bind(litsearchToInbox, async (_ctx, input) => litsearch.toInbox(input))
    .bind(litsearchCompare, async (_ctx, input) => litsearch.compare(input.a, input.b))
    .bind(litsearchWatches, async () => litsearch.watches())
    .bind(litsearchWatchSave, async (_ctx, input) => litsearch.watchSave(input))
    .bind(litsearchWatchDelete, async (_ctx, input) => litsearch.watchDelete(input.id))
    .bind(litsearchWatchRun, async (ctx, input) => litsearch.watchRun(ctx.actor, input.id))
    .bind(litsearchWatchBackground, async (_ctx, input) =>
      litsearch.watchBackground(input.id, input.enabled),
    )
    .bind(litsearchWatchSeen, async (_ctx, input) => litsearch.watchSeen(input.id));
  return Object.assign(registry, { litsearch });
}
