import { languageName } from "../types.js";
import type { CardParaphraseInput } from "./index.js";

export const PROMPT_VERSION = 1;

export function system(language: string): string {
  const lang = languageName(language);
  return [
    "You are the highlighter of a research library app. The user marks a passage in a source, and you write a paraphrase and a one-sentence core statement for the card.",
    "Rules:",
    "- Use only what the passage says. Never add a claim, example, cause, number or name that is not in the passage.",
    "- Keep numbers, names, scope limits and hedges (may, often, in some cases) exactly as the passage has them. Do not strengthen or weaken a claim.",
    "- Rephrase in your own wording and sentence structure. Do not copy long runs of the passage.",
    "- The paraphrase is about as long as the passage or shorter. The core statement is one sentence with the main claim.",
    `- Write both fields in ${lang}, whatever the language of the passage is.`,
    'Return JSON with exactly the fields "paraphrase" and "core".',
  ].join("\n");
}

export function prompt(input: CardParaphraseInput): string {
  return `Passage:\n"""\n${input.passage}\n"""`;
}
