import { mark, untrustedRules } from "../../untrusted.js";
import { languageName } from "../types.js";
import type { CardSuggestLinksInput } from "./index.js";

export const PROMPT_VERSION = 1;

export function system(language: string): string {
  return [
    "You help a researcher connect a quote card to the other sources of their library.",
    "You get one card (a quote with its paraphrase and note, and the source it comes from) and a closed list of candidate sources. A cheap text match found the candidates because the card names their author or title. Often the match is a coincidence: a common word, a namesake or an unrelated mention.",
    "Suggest a typed link from the card to a candidate only when the card really speaks about that work or its author. The relation says what the card does to the candidate:",
    "- supports: the card backs a claim of the candidate",
    "- opposes: the card argues against the candidate or contradicts it",
    "- qualifies: the card limits or narrows a claim of the candidate",
    "- addresses: the card responds to a research question that the candidate poses",
    "- extends: the card builds on the argument of the candidate",
    "- uses-method-of: the card applies a method taken from the candidate",
    "- uses-data-from: the card relies on data from the candidate",
    "- elaborates: the card unfolds one idea of the candidate in more detail",
    "- related: the card names the candidate but none of the relations above fits",
    "Rules:",
    '- "to" must be copied exactly from the "ref" of a candidate. Never invent a citekey.',
    "- Suggest nothing (an empty list) when no candidate is meant. A wrong suggestion costs the researcher attention, a missing one costs nothing.",
    "- Suggest at most two links, the most clearly meant candidates first. Use at most one link per candidate.",
    '- "why" is one sentence that names what in the card relates to the candidate. Do not restate the relation name.',
    `Write each "why" in ${languageName(language)}.`,
    untrustedRules(
      "the quote, paraphrase and note of the card, and the titles, authors and summaries of the source and the candidates",
    ),
  ].join("\n");
}

/**
 * v1: card texts and all descriptions of sources are datamarked. The refs are identifiers that
 * citegeist generates and stay plain, so "to" can be copied exactly. The closing line keeps the
 * language of the reasons when the card is in another language (see note.proposeLinks v2).
 */
export function prompt(input: CardSuggestLinksInput, language: string): string {
  const describe = (s: {
    title: string;
    authors?: string | undefined;
    year?: string | undefined;
  }) =>
    [s.authors ? mark(s.authors) : "", s.year ? `(${s.year})` : "", mark(s.title)]
      .filter(Boolean)
      .join(" ");
  const candidates = input.candidates
    .map(
      (c) =>
        `- ref: ${c.ref}\n  source: ${describe(c)}${c.summary ? `\n  summary: ${mark(c.summary)}` : ""}${c.matched ? `\n  matched on: ${mark(c.matched)}` : ""}`,
    )
    .join("\n");
  return [
    `The card comes from this source (datamarked): ${describe(input.card.source)}`,
    `Quote (datamarked):\n"""\n${mark(input.card.quote)}\n"""`,
    input.card.paraphrase ? `Paraphrase (datamarked): ${mark(input.card.paraphrase)}` : "",
    input.card.note ? `Note of the researcher (datamarked): ${mark(input.card.note)}` : "",
    `Candidates:\n${candidates}`,
    `Write each "why" in ${languageName(language)}, whatever the language of the card is. Copy "to" exactly as the refs above are written, with their square brackets.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
