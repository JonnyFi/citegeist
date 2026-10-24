import { type Registry, usageSummary } from "@citegeist/ops";
import type { UsageLedger } from "./ledger.js";

export { meteredAi, recordTask } from "./gateway.js";
export { type UsageEntry, UsageLedger, type UsageSummary } from "./ledger.js";

/** Binds usage.summary to the ledger. */
export function bindUsageOperations(registry: Registry, ledger: UsageLedger): Registry {
  return registry.bind(usageSummary, async (_ctx, input) => ledger.summary(input.days));
}
