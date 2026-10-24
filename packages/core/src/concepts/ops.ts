import {
  conceptsCreate,
  conceptsDescribe,
  conceptsGet,
  conceptsList,
  conceptsMerge,
  conceptsPropose,
  conceptsUpdate,
  type Registry,
} from "@citegeist/ops";
import type { Library } from "../library.js";
import { type ConceptDeps, ConceptService } from "./service.js";

/**
 * Binds concepts.list, concepts.get, concepts.create, concepts.update, concepts.merge,
 * concepts.describe and concepts.propose. Writes stamp `ctx.actor`. Describe and propose run as
 * jobs on `deps.jobs`; without a queue they run detached in this process.
 *
 * Runtime wiring (packages/core/src/runtime.ts), next to `bindMatrixOperations`:
 *
 *   bindConceptOperations(registry, lib, { ai, jobs });
 */
export function bindConceptOperations(
  registry: Registry,
  lib: Library,
  deps: ConceptDeps,
): Registry & { concepts: ConceptService } {
  const concepts = new ConceptService(lib, deps);
  registry
    .bind(conceptsList, async (_ctx, input) => concepts.list(input))
    .bind(conceptsGet, async (_ctx, input) => concepts.get(input.id))
    .bind(conceptsCreate, async (ctx, input) => concepts.create(ctx.actor, input))
    .bind(conceptsUpdate, async (ctx, input) => concepts.update(ctx.actor, input))
    .bind(conceptsMerge, async (ctx, input) => concepts.merge(ctx.actor, input))
    .bind(conceptsDescribe, async (ctx, input) => concepts.describe(ctx.actor, input))
    .bind(conceptsPropose, async (ctx, input) => concepts.propose(ctx.actor, input));
  return Object.assign(registry, { concepts });
}
