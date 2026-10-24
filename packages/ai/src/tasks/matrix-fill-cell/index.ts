import { z } from "zod";
import { defineTask } from "../types.js";
import { matrixFillCellFixtures } from "./fixtures.js";
import { PROMPT_VERSION, prompt, system } from "./prompt.v1.js";
import { verifyQuote } from "./verify.js";

export { MIN_QUOTE_CHARS, normalizeForMatch, type QuoteMatch, verifyQuote } from "./verify.js";

export const MatrixPassage = z.object({
  /** Block id (`b0k3x9a2`) or card id (`c_01JB...`). The only values `evidence.ref` may take. */
  ref: z.string().min(1),
  kind: z.enum(["block", "card"]),
  /** Printed page label for the reader of the prompt. Never written by the model. */
  page: z.string().nullable().optional(),
  text: z.string().min(1),
});
export type MatrixPassage = z.infer<typeof MatrixPassage>;

export const MatrixFillCellInput = z.object({
  item: z.object({
    citekey: z.string().min(1),
    title: z.string(),
    authors: z.string().optional(),
    year: z.string().optional(),
  }),
  column: z.object({ name: z.string().min(1), instruction: z.string().default("") }),
  /** Passages retrieved from the item. The answer may rest on these and on nothing else. */
  passages: z.array(MatrixPassage).min(1),
});
export type MatrixFillCellInput = z.infer<typeof MatrixFillCellInput>;

export const MatrixFillCellOutput = z.object({
  /** One or two sentences, empty when the passages do not say anything on the question. */
  answer: z.string(),
  evidence: z.array(z.object({ ref: z.string(), quote: z.string() })),
});
export type MatrixFillCellOutput = z.infer<typeof MatrixFillCellOutput>;

/** Most quotes one cell keeps. */
export const MAX_EVIDENCE = 4;

export interface VerifiedEvidence {
  ref: string;
  kind: "block" | "card";
  /** The passage text from the first to the last quoted character, as the passage has it. */
  quote: string;
  /** Offsets of the quote in the passage text. */
  start: number;
  end: number;
}

export interface SanitizedCell {
  /** False when no quote survived verification. Then `answer` is empty and `evidence` too. */
  found: boolean;
  answer: string;
  evidence: VerifiedEvidence[];
  /** Quotes the model gave that the passages do not contain, or that point at no passage. */
  rejected: number;
}

export function normRef(ref: string): string {
  return ref
    .trim()
    .replace(/^\[+|\]+$/g, "")
    .replace(/^\^/, "")
    .toLowerCase();
}

/**
 * Keeps what the model got right. A quote counts only when its reference names one of the given
 * passages and the passage contains the quote after normalization. The stored quote is the text of
 * the passage, not the model's rendering of it. Without a surviving quote the answer is dropped:
 * an answer nobody can trace is not stored.
 */
export function sanitizeCell(
  output: MatrixFillCellOutput,
  input: Pick<MatrixFillCellInput, "passages">,
): SanitizedCell {
  const byRef = new Map(input.passages.map((p) => [normRef(p.ref), p]));
  const evidence: VerifiedEvidence[] = [];
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
    if (evidence.length < MAX_EVIDENCE) {
      evidence.push({
        ref: passage.ref,
        kind: passage.kind,
        quote: hit.text,
        start: hit.start,
        end: hit.end,
      });
    }
  }
  const answer = output.answer.trim();
  if (answer === "" || evidence.length === 0) {
    return { found: false, answer: "", evidence: [], rejected };
  }
  return { found: true, answer, evidence, rejected };
}

/** What a cell holds when the document says nothing on the question, by answer language. */
export function noInfoText(language: string): string {
  return language.toLowerCase().startsWith("en")
    ? "not stated in the text"
    : "keine Angabe im Text";
}

export const matrixFillCell = defineTask({
  name: "matrix.fillCell",
  promptVersion: PROMPT_VERSION,
  description:
    "Short answer to one matrix column for one source, with quotes from the given passages as evidence.",
  input: MatrixFillCellInput,
  output: MatrixFillCellOutput,
  modelClass: "smart",
  system,
  prompt,
  fixtures: matrixFillCellFixtures,
});
