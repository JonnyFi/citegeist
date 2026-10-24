import { z } from "zod";
import { defineTask } from "../types.js";
import { conceptNameFixtures } from "./fixtures.js";
import { PROMPT_VERSION, prompt, system } from "./prompt.v1.js";

export const ConceptNameInput = z.object({
  /** The verbatim quote of a card of kind definition. */
  passage: z.string().min(1),
  paraphrase: z.string().optional(),
});
export type ConceptNameInput = z.infer<typeof ConceptNameInput>;

export const ConceptNameOutput = z.object({
  /** The defined term in dictionary form, empty when the passage defines nothing. */
  term: z.string(),
  aliases: z.array(z.string()).default([]),
});
export type ConceptNameOutput = z.infer<typeof ConceptNameOutput>;

export const conceptName = defineTask({
  name: "concept.name",
  promptVersion: PROMPT_VERSION,
  description:
    "The term a definition passage defines, with the other names the passage gives for it.",
  input: ConceptNameInput,
  output: ConceptNameOutput,
  modelClass: "fast",
  system,
  prompt,
  fixtures: conceptNameFixtures,
});
