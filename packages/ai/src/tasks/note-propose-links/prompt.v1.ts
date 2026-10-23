import { languageName } from "../types.js";
import type { NoteProposeLinksInput } from "./index.js";

export const PROMPT_VERSION = 1;

export function system(language: string): string {
  return [
    "You help a researcher connect a note to the sources, quote cards and other notes it mentions.",
    "You get the note and a closed list of targets (items, cards, notes) that the note links to with wiki links. Propose typed links from the note to targets of that list.",
    "Relations:",
    "- supports: the target backs a claim of the note",
    "- opposes: the target argues against a claim of the note",
    "- qualifies: the target limits or narrows a claim of the note",
    "- addresses: the note responds to a research question that the target poses",
    "- extends: the note builds on the argument of the target",
    "- uses-method-of: the note applies a method taken from the target",
    "- uses-data-from: the note relies on data from the target",
    "- elaborates: the note unfolds one idea of the target in more detail",
    "- related: the target belongs to the topic but none of the relations above fits",
    "Rules:",
    '- "to" must be copied exactly from the "ref" of a target. Never invent a citekey, card id or note.',
    '- Use "related" only when no precise relation fits. Skip a target when the note does not use it in a way that justifies a link.',
    '- "evidence" is optional. Set it to the "ref" of a card only when that card belongs to the target (its "item" equals the target) and shows the relation. Otherwise leave it out.',
    '- "why" is one sentence that names what in the note and in the target creates the relation. Do not restate the relation name.',
    "- Do not propose a link and relation that the note already has. Propose at most 8 links.",
    `Write each "why" in ${languageName(language)}.`,
  ].join("\n");
}

export function prompt(input: NoteProposeLinksInput): string {
  const targets = input.targets
    .map(
      (t) =>
        `- ref: ${t.ref}\n  kind: ${t.kind}\n  title: ${t.title}${t.summary ? `\n  summary: ${t.summary}` : ""}`,
    )
    .join("\n");
  const cards =
    input.cards.length > 0
      ? input.cards.map((c) => `- ref: ${c.ref}\n  item: ${c.item}\n  text: ${c.text}`).join("\n")
      : "(none)";
  const existing =
    input.existing.length > 0
      ? input.existing.map((e) => `- ${e.to} ${e.rel ?? "(untyped)"}`).join("\n")
      : "(none)";
  return [
    `Note title: ${input.note.title}${input.note.type ? ` (${input.note.type})` : ""}`,
    `Note text:\n"""\n${input.note.body}\n"""`,
    `Targets:\n${targets}`,
    `Cards of the linked items:\n${cards}`,
    `Links the note already has:\n${existing}`,
  ].join("\n\n");
}
