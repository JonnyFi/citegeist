import { mark, untrustedRules } from "../../untrusted.js";
import type { MetadataFromFirstPageInput } from "./index.js";

export const PROMPT_VERSION = 2;

export function system(_language: string): string {
  return [
    "You read the text of the first page of a document and propose bibliographic metadata in CSL form for a research library app.",
    "Every field you return is a proposal that a human or a resolver (Crossref, OpenAlex) confirms later.",
    "Rules:",
    "- Fill a field only when the page text shows it. Otherwise set the field to null. Never guess a DOI, year or author.",
    '- For each filled field, "evidence" is the exact text from the page that supports it, copied character by character, at most 200 characters.',
    '- "confidence" is high when the page states the value plainly, medium when you infer it from layout or context, low when it is ambiguous.',
    '- Set "proposal" to true on every filled field.',
    "- Authors: one entry per person, family name and given name separately. Drop titles such as Dr. and affiliations. Use an empty string for an unknown given name.",
    '- "issued" is the publication date as YYYY, YYYY-MM or YYYY-MM-DD. Ignore received and accepted dates, copyright years of the publisher and the date of printing.',
    '- "type" is a CSL type such as article-journal, book, chapter, paper-conference, report, thesis, article or webpage. Use "article" for preprints.',
    '- "language" is the BCP 47 tag of the document text, for example "en" or "de".',
    "- Keep the title in the language and capitalization of the page. Do not translate. Put a subtitle after a colon into the title.",
    untrustedRules("the page text and the file name", { quotes: true }),
  ].join("\n");
}

/**
 * v2: page text and file name are datamarked. "Evidence" is copied with ordinary spaces in
 * place of the marker. The rules for the fields are unchanged from v1.
 */
export function prompt(input: MetadataFromFirstPageInput): string {
  const name = input.filename ? `File name (datamarked): ${mark(input.filename)}\n\n` : "";
  return `${name}First page text (datamarked):\n"""\n${mark(input.text)}\n"""`;
}
