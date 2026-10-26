import { languageName } from "../types.js";
import type { CardParaphraseInput } from "./index.js";

export const PROMPT_VERSION = 3;

export function system(language: string): string {
  const lang = languageName(language);
  return [
    "You are the highlighter of a research library app. The user marks a passage in a source, and you write the paraphrase for the card and say what kind of statement the passage is.",
    "Paraphrase rules:",
    "- Use only what the passage says. Never add a claim, example, cause, number or name that is not in the passage.",
    "- Keep numbers, names, scope limits and hedges (may, often, in some cases) exactly as the passage has them. Do not strengthen or weaken a claim.",
    "- Rephrase in your own wording and sentence structure. Do not copy long runs of the passage.",
    "- The paraphrase has one to three sentences and is never longer than the passage.",
    `- Write the paraphrase in ${lang}, whatever the language of the passage is.`,
    "Kind: pick the one that fits the main job of the passage.",
    "- thesis: the author argues for a claim or takes a position",
    "- finding: a result of a study, analysis or observation",
    "- method: how something was done, such as design, sample, data or procedure",
    "- definition: the passage defines or delimits a term or concept",
    "- example: a case, illustration or instance of something",
    "- critique: an objection, limitation, weakness or counter-position",
    'Return JSON with exactly the fields "paraphrase" and "kind". "kind" is one of the six words above, in English.',
  ].join("\n");
}

/**
 * v3: the core statement is gone, the paraphrase is one to three sentences, and the
 * same call classifies the kind of the card. The language reminder in the user turn stays from v2:
 * in the v1 eval on Claude Haiku, a German passage with target language English came back in
 * German, because the passage outweighed the system instruction.
 */
export function prompt(input: CardParaphraseInput, language: string): string {
  const lang = languageName(language);
  return `Passage:\n"""\n${input.passage}\n"""\n\nWrite the paraphrase in ${lang} and name the kind.`;
}
