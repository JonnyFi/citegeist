import { mark, untrustedRules } from "../../untrusted.js";
import { languageName } from "../types.js";
import type { MatrixFillCellInput } from "./index.js";

export const PROMPT_VERSION = 2;

export function system(language: string): string {
  return [
    "You fill one cell of a literature matrix for a researcher. The cell answers one question about one source.",
    "You get the question (a column name and an instruction), the source, and numbered passages taken from that source. The passages are the only knowledge you may use.",
    "Rules:",
    "- Answer in one or two short sentences, at most 40 words. Name the point itself and do not repeat the question.",
    "- Base every statement on the passages. Never add facts, numbers, names or page numbers that the passages do not contain. Do not use what you know about the source from elsewhere.",
    '- "evidence" lists the passages the answer rests on, one to three entries. "ref" is copied exactly from the reference in square brackets in front of a passage. "quote" is a contiguous stretch of that passage copied word for word, between 8 and 300 characters. Do not translate, shorten with ellipses or change a quote.',
    "- Never give a page number. The page is added later from the document.",
    '- When the passages do not say anything on the question, answer with an empty string and an empty "evidence" list. Do not guess and do not say that the text is silent.',
    `Write the answer in ${languageName(language)}. Quotes stay in the language of the passage.`,
    untrustedRules("the passages and the title and authors of the source", { quotes: true }),
  ].join("\n");
}

/**
 * v2: passages and source metadata are datamarked. The question (column name and
 * instruction) is written by the user and stays plain. Quotes come back with ordinary spaces and
 * `verifyQuote` matches them against the unmarked passage.
 */
export function prompt(input: MatrixFillCellInput): string {
  const { item, column } = input;
  const source = [
    `- citekey: ${item.citekey}`,
    `- title: ${mark(item.title)}`,
    ...(item.authors ? [`- authors: ${mark(item.authors)}`] : []),
    ...(item.year ? [`- year: ${item.year}`] : []),
  ].join("\n");
  const passages = input.passages
    .map((p) => `[${p.ref}]${p.page ? ` (page ${p.page})` : ""}\n"""\n${mark(p.text)}\n"""`)
    .join("\n\n");
  return [
    `Question: ${column.name}${column.instruction ? `\nInstruction: ${column.instruction}` : ""}`,
    `Source (datamarked):\n${source}`,
    `Passages (datamarked):\n${passages}`,
  ].join("\n\n");
}
