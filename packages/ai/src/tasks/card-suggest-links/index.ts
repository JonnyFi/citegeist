import { Relation } from "@citegeist/schema";
import { z } from "zod";
import { defineTask } from "../types.js";
import { cardSuggestLinksFixtures } from "./fixtures.js";
import { PROMPT_VERSION, prompt, system } from "./prompt.v1.js";

/** A wiki link without anchor or alias, such as `[[land2012dark]]`. */
const Ref = z.string().regex(/^\[\[[^\]|#]+\]\]$/);

const SourceDescription = z.object({
  title: z.string().min(1),
  /** Family names as the library shows them, such as "Land" or "Williams & Srnicek". */
  authors: z.string().optional(),
  year: z.string().optional(),
});

export const SuggestCandidate = SourceDescription.extend({
  /** The wiki link of the item. The only values `to` may take. */
  ref: Ref,
  /** Abstract or opening lines: what the work says. */
  summary: z.string().optional(),
  /** What the cheap match found, such as "author Land, title word Enlightenment". */
  matched: z.string().optional(),
});
export type SuggestCandidate = z.infer<typeof SuggestCandidate>;

export const CardSuggestLinksInput = z.object({
  card: z.object({
    quote: z.string().min(1),
    paraphrase: z.string().optional(),
    note: z.string().optional(),
    source: SourceDescription,
  }),
  candidates: z.array(SuggestCandidate).min(1),
});
export type CardSuggestLinksInput = z.infer<typeof CardSuggestLinksInput>;

export const CardLinkSuggestion = z.object({
  to: z.string().min(1),
  rel: Relation,
  why: z.string().min(1),
});
export type CardLinkSuggestion = z.infer<typeof CardLinkSuggestion>;

export const CardSuggestLinksOutput = z.object({ suggestions: z.array(CardLinkSuggestion) });
export type CardSuggestLinksOutput = z.infer<typeof CardSuggestLinksOutput>;

/** Most suggestions one card gets. */
export const MAX_SUGGESTIONS = 2;

function asRef(value: string): string {
  const v = value.trim();
  return v.startsWith("[[") ? v : `[[${v}]]`;
}

/**
 * Keeps what the model got right: a suggestion must point at a candidate, each candidate appears
 * once, and no more than {@link MAX_SUGGESTIONS} survive. Citekeys the model made up never do.
 */
export function sanitizeSuggestions(
  output: CardSuggestLinksOutput,
  input: CardSuggestLinksInput,
): CardLinkSuggestion[] {
  const refs = new Map(input.candidates.map((c) => [c.ref.toLowerCase(), c.ref]));
  const seen = new Set<string>();
  const out: CardLinkSuggestion[] = [];
  for (const s of output.suggestions) {
    const to = refs.get(asRef(s.to).toLowerCase());
    if (!to || seen.has(to)) continue;
    seen.add(to);
    out.push({ to, rel: s.rel, why: s.why.trim() });
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

export const cardSuggestLinks = defineTask({
  name: "card.suggestLinks",
  promptVersion: PROMPT_VERSION,
  description:
    "Typed links from a quote card to the library sources its text names, each with a short reason. Suggests nothing when the match is a coincidence.",
  input: CardSuggestLinksInput,
  output: CardSuggestLinksOutput,
  modelClass: "fast",
  system,
  prompt,
  fixtures: cardSuggestLinksFixtures,
});
