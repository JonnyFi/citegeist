import type { CardVerifyInput } from "./index.js";

export const PROMPT_VERSION = 2;

export function system(_language: string): string {
  return [
    "You check a paraphrase against its source passage for a research library app.",
    "A paraphrase is faithful when every claim in it is supported by the passage, and nothing the passage hedges or limits is stated more strongly.",
    "Go through the paraphrase claim by claim and compare each with the passage.",
    "Report these problems as issues:",
    "- added: a claim, example, cause, number or name that the passage does not contain",
    "- distorted: the claim changes meaning, direction or strength",
    "- hedge-lost: the passage hedges or limits a claim, and the paraphrase drops that",
    "- number-mismatch: a figure differs from the passage",
    "Omitting detail is not an issue unless it changes the meaning. The language of the texts does not matter for the verdict.",
    '"faithful" is true only when the issues list is empty.',
    'Write each "detail" in English, quoting the offending words of the paraphrase.',
  ].join("\n");
}

export function prompt(input: CardVerifyInput): string {
  return [
    `Passage:\n"""\n${input.passage}\n"""`,
    `Paraphrase:\n"""\n${input.paraphrase}\n"""`,
  ].join("\n\n");
}
