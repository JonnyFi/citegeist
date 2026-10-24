import {
  insightsFind,
  insightsList,
  insightsNote,
  outlineApply,
  outlineGet,
  planDocsGet,
  planDocsUpdate,
  plansCreate,
  plansList,
  type Registry,
} from "@citegeist/ops";
import type { Library } from "../library.js";
import { type PlanningOptions, PlanningService } from "./service.js";

/**
 * Binds the planning operations (plans.*, outline.*, plan.docs.*, insights.*) to a registry.
 * Writes stamp `ctx.actor`. Every file lands under projects/<project>/ as Markdown or YAML, so
 * the chat turn journal records the changes and "Undo" restores them.
 */
export function bindPlanningOperations(
  registry: Registry,
  lib: Library,
  opts: PlanningOptions = {},
): PlanningService {
  const service = new PlanningService(lib, opts);
  registry
    .bind(plansCreate, async (ctx, input) => service.createPlan(ctx.actor, input))
    .bind(plansList, async (_ctx, input) => service.listPlans(input.project))
    .bind(outlineGet, async (_ctx, input) => service.getOutline(input.project, input.plan))
    .bind(outlineApply, async (_ctx, input) => service.applyOutline(input))
    .bind(planDocsGet, async (_ctx, input) => service.getDoc(input))
    .bind(planDocsUpdate, async (_ctx, input) => service.updateDoc(input))
    .bind(insightsNote, async (_ctx, input) => service.noteInsight(input))
    .bind(insightsFind, async (_ctx, input) => service.findInsights(input))
    .bind(insightsList, async (_ctx, input) => service.listInsights(input));
  return service;
}
