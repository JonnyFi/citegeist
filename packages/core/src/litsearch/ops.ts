import { litsearchGet, litsearchRuns, type Registry } from "@citegeist/ops";
import type { Library } from "../library.js";
import { LitsearchService } from "./service.js";

/**
 * Binds litsearch.runs and litsearch.get. The other litsearch.* contracts answer
 * OPERATION_NOT_IMPLEMENTED until their part of issue #50 lands.
 */
export function bindLitsearchOperations(
  registry: Registry,
  lib: Library,
): Registry & { litsearch: LitsearchService } {
  const litsearch = new LitsearchService(lib);
  registry
    .bind(litsearchRuns, async (_ctx, input) => litsearch.runs(input))
    .bind(litsearchGet, async (_ctx, input) => litsearch.get(input.runId));
  return Object.assign(registry, { litsearch });
}
