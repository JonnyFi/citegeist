import type { LitsearchSuggestQueriesInput } from "./index.js";

export const PROMPT_VERSION = 1;

// From research-pipeline's SUGGEST_PROMPT (gui/server.py), which ran on `claude -p`.
export function system(): string {
  return [
    "You write search queries for a literature search tool. The tool searches OpenAlex titles and abstracts.",
    "Rules:",
    "- 4 to 6 core queries, each 2 to 6 words, covering the topic, synonyms and key concepts.",
    '- Put multi-word concepts in double quotes, for example "multi-agent communication". Every quoted phrase and every unquoted word of a query must appear in a paper\'s title or abstract.',
    '- For each key phrase, add morphological variants as extra queries, for example "recursive self-improvement" -> "recursively self-improving". Variants must not be looser than the query they come from. Do not add variants that only differ by plural or case: the tool already matches "agent" and "agents" alike.',
    "- Write the queries in English, the language of most abstracts, even when the topic is given in another language.",
    "- No boolean operators (AND, OR, NOT), no wildcards, no field prefixes.",
  ].join("\n");
}

export function prompt(input: LitsearchSuggestQueriesInput): string {
  return [
    `Topic: ${input.topic}`,
    `At most ${input.maxQueries} queries in total, variants included.`,
  ].join("\n");
}
