import {
  litsearchCancel,
  litsearchExport,
  litsearchGet,
  litsearchReport,
  litsearchResume,
  litsearchRuns,
  litsearchStart,
  litsearchSuggest,
  type Registry,
} from "@citegeist/ops";
import type { Library } from "../library.js";
import { type LitsearchDeps, LitsearchService } from "./service.js";

/**
 * Binds litsearch.suggest, start, resume, cancel, runs, get, export and report. A run is a job of kind
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
    .bind(litsearchReport, async (_ctx, input) => litsearch.report(input.runId));
  return Object.assign(registry, { litsearch });
}
