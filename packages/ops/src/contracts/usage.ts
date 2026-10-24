import { z } from "zod";
import { defineContract, type OperationContract } from "../registry.js";

// Usage ledger (W5.2). Every AI call and every agent turn is recorded in state.sqlite of the
// machine, never in the library folder and never synced.

/** What a group of calls consumed. `costUsd` adds up the list prices the backends reported. */
export const UsageTotals = z.object({
  calls: z.number().int().nonnegative(),
  /** Calls that ended with an error or were cancelled. */
  failed: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  /** List price in US dollars, summed over the calls whose backend reported one. */
  costUsd: z.number().nonnegative(),
  /** How many calls had a price. Fewer than `calls` means `costUsd` is incomplete. */
  pricedCalls: z.number().int().nonnegative(),
  /** Time spent in the calls, in milliseconds. */
  ms: z.number().int().nonnegative(),
});
export type UsageTotals = z.infer<typeof UsageTotals>;

export const usageSummary = defineContract({
  name: "usage.summary",
  summary:
    "Tokens, cache hits and list-price cost of AI calls and agent turns, per day, task and backend. With a subscription the cost is an estimate at API list prices",
  access: "read",
  input: z.object({
    /** Window in days, counted back from now. */
    days: z.number().int().min(1).max(365).default(30),
  }),
  output: z.object({
    days: z.number().int(),
    /** Start of the window, ISO timestamp. */
    since: z.string(),
    totals: UsageTotals,
    byDay: z.array(UsageTotals.extend({ day: z.string() })),
    /** Task name such as `card.paraphrase`, or `chat` and `research` for agent turns. */
    byTask: z.array(UsageTotals.extend({ task: z.string() })),
    byBackend: z.array(UsageTotals.extend({ backend: z.string() })),
  }),
  cli: ["usage"],
});

export const USAGE_CONTRACTS: readonly OperationContract[] = [usageSummary];
