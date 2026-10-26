import { mark, untrustedRules } from "../../untrusted.js";
import type { ConceptNameInput } from "./index.js";

export const PROMPT_VERSION = 2;

export function system(_language: string): string {
  return [
    "You name the concept that a passage defines, for the concept register of a researcher.",
    "You get one passage the researcher saved because it defines a term. The passage is the only knowledge you may use.",
    "Rules:",
    '- "term" is the term the passage defines, in its dictionary form (nominative singular for nouns), written in the language of the passage. Use the wording of the passage and do not translate it. Keep it short: one to four words.',
    '- "aliases" lists other names the passage itself gives for the same term, such as an abbreviation, a synonym or a translation. Leave it empty when the passage names none. Never add aliases from your own knowledge.',
    '- When the passage does not define a term, answer with an empty "term" and no aliases. Do not guess.',
    "Answer with the term and the aliases only.",
    untrustedRules("the passage and its summary"),
  ].join("\n");
}

/**
 * v2: passage and summary are datamarked. The term is read from the marked text and
 * written with ordinary spaces.
 */
export function prompt(input: ConceptNameInput): string {
  return [
    `Passage (datamarked):\n"""\n${mark(input.passage)}\n"""`,
    ...(input.paraphrase
      ? [`Summary of the passage (datamarked):\n${mark(input.paraphrase)}`]
      : []),
  ].join("\n\n");
}
