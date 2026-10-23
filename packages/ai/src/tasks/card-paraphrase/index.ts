import { z } from "zod";
import { defineTask } from "../types.js";
import { cardParaphraseFixtures } from "./fixtures.js";
import { PROMPT_VERSION, prompt, system } from "./prompt.v2.js";

export const CardParaphraseInput = z.object({
  /** The verbatim passage of the card. */
  passage: z.string().min(1),
});
export type CardParaphraseInput = z.infer<typeof CardParaphraseInput>;

export const CardParaphraseOutput = z.object({
  paraphrase: z.string().min(1),
  core: z.string().min(1),
});
export type CardParaphraseOutput = z.infer<typeof CardParaphraseOutput>;

export const cardParaphrase = defineTask({
  name: "card.paraphrase",
  promptVersion: PROMPT_VERSION,
  description:
    "Paraphrase and one-sentence core statement of a passage, in the requested language.",
  input: CardParaphraseInput,
  output: CardParaphraseOutput,
  modelClass: "fast",
  system,
  prompt,
  fixtures: cardParaphraseFixtures,
});
