import {
  matrixCreate,
  matrixExport,
  matrixFill,
  matrixFillCell,
  matrixGet,
  matrixList,
  matrixUpdate,
  type Registry,
} from "@citegeist/ops";
import type { Library } from "../library.js";
import { type MatrixDeps, MatrixService } from "./service.js";

/**
 * Binds matrix.create, matrix.list, matrix.get, matrix.update, matrix.fillCell, matrix.fill and
 * matrix.export. Writes stamp `ctx.actor`. Fills run as jobs on `deps.jobs`; without a queue they
 * run detached in this process.
 *
 * Runtime wiring (packages/core/src/runtime.ts), after `bindCardOperations`:
 *
 *   const jobs = aiTaskJobs(ingest.queue);          // replaces the inline `cardJobs` block
 *   bindMatrixOperations(registry, lib, {
 *     ai,
 *     jobs,
 *     search: async (input) => (semantic ? semantic.search(input) : lib.search(input)),
 *     rank: async (query, texts) => semantic?.rank(query, texts),
 *   });
 */
export function bindMatrixOperations(
  registry: Registry,
  lib: Library,
  deps: MatrixDeps,
): Registry & { matrix: MatrixService } {
  const matrix = new MatrixService(lib, deps);
  registry
    .bind(matrixCreate, async (ctx, input) => matrix.create(ctx.actor, input))
    .bind(matrixList, async (_ctx, input) => matrix.list(input.project))
    .bind(matrixGet, async (_ctx, input) => matrix.get(input.project, input.matrix))
    .bind(matrixUpdate, async (ctx, input) => matrix.update(ctx.actor, input))
    .bind(matrixFillCell, async (ctx, input) => matrix.fillCell(ctx.actor, input))
    .bind(matrixFill, async (ctx, input) => matrix.fill(ctx.actor, input))
    .bind(matrixExport, async (_ctx, input) => matrix.export(input));
  return Object.assign(registry, { matrix });
}
