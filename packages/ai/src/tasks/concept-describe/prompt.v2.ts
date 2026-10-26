import { mark, untrustedRules } from "../../untrusted.js";
import { languageName } from "../types.js";
import type { ConceptDescribeInput } from "./index.js";

export const PROMPT_VERSION = 2;

export function system(language: string): string {
  return [
    "You write one entry of a concept register for a researcher. A concept is a term that several sources use in their own way. The entry says how one source uses or defines the term.",
    "You get the term with its aliases, the source, and numbered passages. The passages are quotes the researcher saved from that source. They are the only knowledge you may use.",
    "Rules:",
    "- Write one to three sentences, at most 60 words. Say what the term means in this source, what it is applied to or which position the source takes on it. Name the source by the surname of its first author when one is given.",
    '- "role" is "defines" when a passage states what the term means, and "uses" when the source only applies or discusses it.',
    "- Base every statement on the passages. Never add facts, numbers, names or page numbers that the passages do not contain. Do not use what you know about the source or the term from elsewhere.",
    '- "evidence" lists the passages the entry rests on, one to three entries. "ref" is copied exactly from the reference in square brackets in front of a passage. "quote" is a contiguous stretch of that passage copied word for word, between 8 and 300 characters. Do not translate, shorten with ellipses or change a quote.',
    "- Never give a page number. The page is added later from the card.",
    '- When no passage uses or discusses the term, answer with an empty "text", the role "uses" and an empty "evidence" list. Do not guess and do not say that the passages are silent.',
    `Write the text in ${languageName(language)}. Quotes stay in the language of the passage.`,
    untrustedRules(
      "the passages, the title and authors of the source, and the term with its aliases",
      { quotes: true },
    ),
  ].join("\n");
}

/**
 * v2: passages, source metadata and the term are datamarked. The quotes in `evidence` come
 * back with ordinary spaces and `sanitizeUsage` matches them against the unmarked passage.
 */
export function prompt(input: ConceptDescribeInput): string {
  const { concept, item } = input;
  const source = [
    `- citekey: ${item.citekey}`,
    `- title: ${mark(item.title)}`,
    ...(item.authors ? [`- authors: ${mark(item.authors)}`] : []),
    ...(item.year ? [`- year: ${item.year}`] : []),
  ].join("\n");
  const passages = input.passages
    .map(
      (p) =>
        `[${p.ref}]${p.page ? ` (page ${p.page})` : ""}${p.kind ? ` (kind: ${p.kind})` : ""}\n"""\n${mark(p.text)}\n"""`,
    )
    .join("\n\n");
  return [
    `Term: ${mark(concept.term)}${concept.aliases.length > 0 ? `\nAliases: ${concept.aliases.map(mark).join("; ")}` : ""}`,
    `Source (datamarked):\n${source}`,
    `Passages (datamarked):\n${passages}`,
  ].join("\n\n");
}
