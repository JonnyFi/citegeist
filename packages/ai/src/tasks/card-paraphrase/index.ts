import { CardKind } from "@citegeist/schema";
import { z } from "zod";
import { defineTask } from "../types.js";
import { cardParaphraseFixtures } from "./fixtures.js";
import { PROMPT_VERSION, prompt, system } from "./prompt.v4.js";

export const CardParaphraseInput = z.object({
  /** The verbatim passage of the card. */
  passage: z.string().min(1),
});
export type CardParaphraseInput = z.infer<typeof CardParaphraseInput>;

export const CardParaphraseOutput = z.object({
  /** The one AI text of a card (D15): one to three sentences in the requested language. */
  paraphrase: z.string().min(1),
  /** The pre-classified kind of the card (D16). The reader can change it. */
  kind: CardKind,
});
export type CardParaphraseOutput = z.infer<typeof CardParaphraseOutput>;

export const cardParaphrase = defineTask({
  name: "card.paraphrase",
  promptVersion: PROMPT_VERSION,
  description:
    "Paraphrase of a passage in one to three sentences in the requested language, plus its kind.",
  input: CardParaphraseInput,
  output: CardParaphraseOutput,
  modelClass: "fast",
  system,
  prompt,
  fixtures: cardParaphraseFixtures,
});
