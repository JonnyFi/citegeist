import { CslType } from "@citegeist/schema";
import { z } from "zod";
import { defineTask } from "../types.js";
import { metadataFixtures } from "./fixtures.js";
import { PROMPT_VERSION, prompt, system } from "./prompt.v2.js";

export const MetadataFromFirstPageInput = z.object({
  /** Text of page 1 as extracted by the converter. */
  text: z.string().min(1),
  filename: z.string().optional(),
});
export type MetadataFromFirstPageInput = z.infer<typeof MetadataFromFirstPageInput>;

export const Confidence = z.enum(["high", "medium", "low"]);

/** A proposed value. The `proposal` marker is part of the schema, so a value never reads as confirmed. */
function proposal<V extends z.ZodType>(value: V) {
  return z
    .object({
      proposal: z.literal(true),
      value,
      confidence: Confidence,
      /** Exact text from the first page that supports the value. */
      evidence: z.string().min(1),
    })
    .nullable();
}

export const ProposedAuthor = z.object({ family: z.string().min(1), given: z.string() });

export const MetadataFromFirstPageOutput = z.object({
  type: proposal(CslType),
  title: proposal(z.string().min(1)),
  author: proposal(z.array(ProposedAuthor).min(1)),
  issued: proposal(z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/)),
  "container-title": proposal(z.string().min(1)),
  volume: proposal(z.string().min(1)),
  issue: proposal(z.string().min(1)),
  page: proposal(z.string().min(1)),
  publisher: proposal(z.string().min(1)),
  DOI: proposal(z.string().regex(/^10\.\d{4,9}\/\S+$/)),
  abstract: proposal(z.string().min(1)),
  language: proposal(z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)),
});
export type MetadataFromFirstPageOutput = z.infer<typeof MetadataFromFirstPageOutput>;

export const metadataFromFirstPage = defineTask({
  name: "metadata.fromFirstPage",
  promptVersion: PROMPT_VERSION,
  description: "CSL field proposals from first-page text, each with evidence and confidence.",
  input: MetadataFromFirstPageInput,
  output: MetadataFromFirstPageOutput,
  modelClass: "smart",
  system,
  prompt,
  fixtures: metadataFixtures,
});
