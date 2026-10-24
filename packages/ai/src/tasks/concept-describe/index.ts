import { CardKind } from "@citegeist/schema";
import { z } from "zod";
import { normRef } from "../matrix-fill-cell/index.js";
import { verifyQuote } from "../matrix-fill-cell/verify.js";
import { defineTask } from "../types.js";
import { conceptDescribeFixtures } from "./fixtures.js";
import { PROMPT_VERSION, prompt, system } from "./prompt.v2.js";

export const ConceptPassage = z.object({
  /** Card id (`c_01JB...`). The only values `evidence.ref` may take. */
  ref: z.string().min(1),
  kind: CardKind.optional(),
  /** Printed page label for the reader of the prompt. Never written by the model. */
  page: z.string().nullable().optional(),
  /** The verbatim quote of the card. */
  text: z.string().min(1),
});
export type ConceptPassage = z.infer<typeof ConceptPassage>;

export const ConceptDescribeInput = z.object({
  concept: z.object({ term: z.string().min(1), aliases: z.array(z.string()).default([]) }),
  item: z.object({
    citekey: z.string().min(1),
    title: z.string(),
    authors: z.string().optional(),
    year: z.string().optional(),
  }),
  /** Quotes of the cards the researcher linked to the concept. The entry may rest on these and on nothing else. */
  passages: z.array(ConceptPassage).min(1),
});
export type ConceptDescribeInput = z.infer<typeof ConceptDescribeInput>;

export const ConceptDescribeOutput = z.object({
  role: z.enum(["defines", "uses"]),
  /** One to three sentences, empty when the passages do not use the term. */
  text: z.string(),
  evidence: z.array(z.object({ ref: z.string(), quote: z.string() })),
});
export type ConceptDescribeOutput = z.infer<typeof ConceptDescribeOutput>;

/** Most quotes one entry keeps. */
export const MAX_USAGE_EVIDENCE = 3;

export interface VerifiedUsage {
  /** False when no quote survived verification. Then `text` is empty and `evidence` too. */
  found: boolean;
  role: "defines" | "uses";
  text: string;
  evidence: Array<{ ref: string; quote: string; start: number; end: number }>;
  /** Quotes the model gave that the passages do not contain, or that point at no passage. */
  rejected: number;
}

/**
 * Keeps what the model got right. A quote counts only when its reference names one of the given
 * passages and the passage contains the quote after normalization. The stored quote is the text of
 * the passage, not the model's rendering of it. Without a surviving quote the entry is dropped:
 * a statement nobody can trace is not stored.
 */
export function sanitizeUsage(
  output: ConceptDescribeOutput,
  input: Pick<ConceptDescribeInput, "passages">,
): VerifiedUsage {
  const byRef = new Map(input.passages.map((p) => [normRef(p.ref), p]));
  const evidence: VerifiedUsage["evidence"] = [];
  const seen = new Set<string>();
  let rejected = 0;
  for (const e of output.evidence) {
    const passage = byRef.get(normRef(e.ref));
    const hit = passage ? verifyQuote(passage.text, e.quote) : undefined;
    if (!passage || !hit) {
      rejected++;
      continue;
    }
    const key = `${passage.ref}:${hit.start}:${hit.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (evidence.length < MAX_USAGE_EVIDENCE) {
      evidence.push({ ref: passage.ref, quote: hit.text, start: hit.start, end: hit.end });
    }
  }
  const text = output.text.trim();
  if (text === "" || evidence.length === 0) {
    return { found: false, role: "uses", text: "", evidence: [], rejected };
  }
  return { found: true, role: output.role, text, evidence, rejected };
}

export const conceptDescribe = defineTask({
  name: "concept.describe",
  promptVersion: PROMPT_VERSION,
  description:
    "How one source uses or defines a term, in one to three sentences, with quotes from the linked cards as evidence.",
  input: ConceptDescribeInput,
  output: ConceptDescribeOutput,
  modelClass: "smart",
  system,
  prompt,
  fixtures: conceptDescribeFixtures,
});
