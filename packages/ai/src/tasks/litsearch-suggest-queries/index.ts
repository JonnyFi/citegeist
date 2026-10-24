import { z } from "zod";
import { defineTask } from "../types.js";
import { litsearchSuggestQueriesFixtures } from "./fixtures.js";
import { PROMPT_VERSION, prompt, system } from "./prompt.v1.js";

export const LitsearchSuggestQueriesInput = z.object({
  topic: z.string().min(1).max(500),
  /** Queries in total, variants included. */
  maxQueries: z.number().int().min(1).max(20).default(8),
});
export type LitsearchSuggestQueriesInput = z.infer<typeof LitsearchSuggestQueriesInput>;

export const LitsearchSuggestQueriesOutput = z.object({
  queries: z.array(
    z.object({
      query: z.string(),
      /** Morphological variants, each one an extra query. */
      variants: z.array(z.string()).default([]),
    }),
  ),
});
export type LitsearchSuggestQueriesOutput = z.infer<typeof LitsearchSuggestQueriesOutput>;

/** Lowercase, singular form of a word, as workers/research/scripts/sources.py `_singular`. */
function singular(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith("sses")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !/(ss|us|is)$/.test(word)) {
    return word.slice(0, -1);
  }
  return word;
}

/** Case- and plural-insensitive form of a query, keeping quotes and word order (sources.query_key). */
export function queryKey(query: string): string {
  return query.toLowerCase().split(/\s+/).filter(Boolean).join(" ").replace(/\w+/g, singular);
}

/**
 * The queries to show: core queries before variants, without plural or case duplicates, at most
 * `max`, in the order the model gave them. Same rule as research-pipeline's suggest_queries.
 */
export function planSuggestedQueries(
  output: LitsearchSuggestQueriesOutput,
  max: number,
): Array<{ query: string; kind: "core" | "variant" }> {
  const items: Array<{ query: string; kind: "core" | "variant" }> = [];
  for (const item of output.queries) {
    for (const [q, kind] of [
      [item.query, "core"],
      ...item.variants.map((v) => [v, "variant"]),
    ] as Array<[string, "core" | "variant"]>) {
      const query = q.split(/\s+/).filter(Boolean).join(" ");
      if (query) items.push({ query, kind });
    }
  }
  const seen = new Set<string>();
  const unique = items.filter((i) => {
    const k = queryKey(i.query);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const keep = new Set(
    [...unique.filter((i) => i.kind === "core"), ...unique.filter((i) => i.kind !== "core")]
      .slice(0, max)
      .map((i) => i.query),
  );
  return unique.filter((i) => keep.has(i.query));
}

export const litsearchSuggestQueries = defineTask({
  name: "litsearch.suggestQueries",
  promptVersion: PROMPT_VERSION,
  description:
    "Search queries in OpenAlex syntax for a literature search topic: core queries with morphological variants.",
  input: LitsearchSuggestQueriesInput,
  output: LitsearchSuggestQueriesOutput,
  modelClass: "fast",
  system,
  prompt,
  fixtures: litsearchSuggestQueriesFixtures,
});
