import { Relation } from "@citegeist/schema";
import { z } from "zod";
import { defineTask } from "../types.js";
import { noteProposeLinksFixtures } from "./fixtures.js";
import { PROMPT_VERSION, prompt, system } from "./prompt.v1.js";

/** A wiki link without anchor or alias, such as `[[luhmann1984soziale]]` or `[[c_01JB8Z3Q]]`. */
const Ref = z.string().regex(/^\[\[[^\]|#]+\]\]$/);

export const LinkTarget = z.object({
  /** The wiki link the note uses. The only values `to` may take. */
  ref: Ref,
  kind: z.enum(["item", "card", "note"]),
  title: z.string(),
  /** Abstract, quote or opening lines: what the target says. */
  summary: z.string().optional(),
});
export type LinkTarget = z.infer<typeof LinkTarget>;

export const LinkCard = z.object({
  /** Wiki link of the card. The only values `evidence` may take. */
  ref: Ref,
  /** Wiki link of the item the card belongs to. */
  item: Ref,
  text: z.string().min(1),
});
export type LinkCard = z.infer<typeof LinkCard>;

export const NoteProposeLinksInput = z.object({
  note: z.object({ title: z.string(), type: z.string().optional(), body: z.string() }),
  /** Items, cards and notes the body links to with wiki links. */
  targets: z.array(LinkTarget).min(1),
  /** Quote cards of the linked items, candidates for `evidence`. */
  cards: z.array(LinkCard).default([]),
  /** Typed links the note already has, so they are not proposed again. */
  existing: z.array(z.object({ to: z.string(), rel: Relation.optional() })).default([]),
});
export type NoteProposeLinksInput = z.infer<typeof NoteProposeLinksInput>;

export const LinkProposal = z.object({
  to: z.string().min(1),
  rel: Relation,
  why: z.string().min(1),
  evidence: z.string().min(1).optional(),
});
export type LinkProposal = z.infer<typeof LinkProposal>;

export const NoteProposeLinksOutput = z.object({ proposals: z.array(LinkProposal) });
export type NoteProposeLinksOutput = z.infer<typeof NoteProposeLinksOutput>;

/** Most proposals one run may add to a note. */
export const MAX_PROPOSALS = 8;

function asRef(value: string): string {
  const v = value.trim();
  return v.startsWith("[[") ? v : `[[${v}]]`;
}

/**
 * Keeps what the model got right. A proposal must point at one of the targets, a supporting card
 * must belong to that target, and typed links the note already has are not repeated. Citekeys the
 * model made up never survive.
 */
export function sanitizeProposals(
  output: NoteProposeLinksOutput,
  input: NoteProposeLinksInput,
): LinkProposal[] {
  const targets = new Map(input.targets.map((t) => [t.ref.toLowerCase(), t.ref]));
  const cards = new Map(input.cards.map((c) => [c.ref.toLowerCase(), c]));
  const seen = new Set(input.existing.map((e) => `${asRef(e.to).toLowerCase()}|${e.rel ?? ""}`));
  const out: LinkProposal[] = [];
  for (const p of output.proposals) {
    const to = targets.get(asRef(p.to).toLowerCase());
    if (!to) continue;
    const key = `${to.toLowerCase()}|${p.rel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const card = p.evidence ? cards.get(asRef(p.evidence).toLowerCase()) : undefined;
    const evidence = card && card.item.toLowerCase() === to.toLowerCase() ? card.ref : undefined;
    out.push({ to, rel: p.rel, why: p.why.trim(), ...(evidence ? { evidence } : {}) });
    if (out.length >= MAX_PROPOSALS) break;
  }
  return out;
}

export const noteProposeLinks = defineTask({
  name: "note.proposeLinks",
  promptVersion: PROMPT_VERSION,
  description:
    "Typed links from a note to the items, cards and notes it mentions, each with a reason and a supporting card where one fits.",
  input: NoteProposeLinksInput,
  output: NoteProposeLinksOutput,
  modelClass: "smart",
  system,
  prompt,
  fixtures: noteProposeLinksFixtures,
});
