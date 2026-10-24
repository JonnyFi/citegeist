import type { EvalFixture } from "../types.js";
import type { LitsearchSuggestQueriesInput, LitsearchSuggestQueriesOutput } from "./index.js";

const BOOLEAN = /\b(AND|OR|NOT)\b|[*?]|\w+:/;

/**
 * Shape rules from the prompt. `concepts`: at least one query must contain one of these words, so
 * the queries stay on the topic.
 */
function check(
  output: LitsearchSuggestQueriesOutput,
  input: LitsearchSuggestQueriesInput,
  concepts: string[],
): string[] {
  const fails: string[] = [];
  const all = output.queries.flatMap((q) => [q.query, ...q.variants]);
  if (output.queries.length < 3) fails.push(`only ${output.queries.length} core queries`);
  if (output.queries.length > 8) fails.push(`${output.queries.length} core queries, more than 6`);
  if (all.length > input.maxQueries) {
    fails.push(`${all.length} queries in total, more than ${input.maxQueries}`);
  }
  for (const q of all) {
    const words = q.replace(/"/g, " ").split(/\s+/).filter(Boolean).length;
    if (words < 1 || words > 8) fails.push(`"${q}" has ${words} words`);
    if (BOOLEAN.test(q)) fails.push(`"${q}" uses operators or field prefixes`);
    if ((q.match(/"/g) ?? []).length % 2 !== 0) fails.push(`"${q}" has an unbalanced quote`);
  }
  const lower = all.join(" ").toLowerCase();
  if (!concepts.some((c) => lower.includes(c))) {
    fails.push(`no query names any of ${concepts.join(", ")}`);
  }
  if (!all.some((q) => q.includes('"'))) fails.push("no quoted phrase");
  return fails;
}

export const litsearchSuggestQueriesFixtures: EvalFixture<
  LitsearchSuggestQueriesInput,
  LitsearchSuggestQueriesOutput
>[] = [
  {
    id: "agent-communication",
    input: { topic: "communication protocols between ai agents", maxQueries: 10 },
    language: "en",
    check: (o, i) => check(o, i, ["agent", "multi-agent", "multiagent"]),
  },
  {
    id: "german-topic",
    input: { topic: "Systemtheorie und digitale Plattformen", maxQueries: 8 },
    language: "de",
    check: (o, i) => check(o, i, ["platform", "systems theory", "luhmann"]),
  },
  {
    id: "recursive-self-improvement",
    input: { topic: "recursive self-improvement of language models", maxQueries: 6 },
    language: "en",
    check: (o, i) => check(o, i, ["self-improv", "self improv"]),
  },
];
