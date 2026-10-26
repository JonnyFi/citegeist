import { useSyncExternalStore } from "react";

/**
 * The plan the user has open in the project view. The plan screen publishes it, the chat panel shows
 * it as a chip and hands it to the agent, as the reader does with a marked passage. It lives
 * outside React state so the two panels need no shared parent.
 *
 * `ChatContext` in `@citegeist/ops` carries the plan and the node, so the agent knows where the user is.
 */
export interface PlanContext {
  project: string;
  plan: string;
  planTitle: string;
  /** The node open in the plan view. */
  node?: { id: string; number: string; title: string };
}

let current: PlanContext | null = null;
const listeners = new Set<() => void>();

export function publishPlanContext(next: PlanContext | null): void {
  const same = JSON.stringify(next) === JSON.stringify(current);
  if (same) return;
  current = next;
  for (const l of listeners) l();
}

export function currentPlanContext(): PlanContext | null {
  return current;
}

export function usePlanContext(): PlanContext | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => null,
  );
}

/** Short text of a plan context for the chip: "Exposé, 2.1 Anschlusskommunikation". */
export function planContextLabel(ctx: PlanContext): string {
  return ctx.node ? `${ctx.planTitle}, ${ctx.node.number} ${ctx.node.title}` : ctx.planTitle;
}
