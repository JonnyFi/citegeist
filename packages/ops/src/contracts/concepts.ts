import { CardId, CardKind, Citekey, ConceptUsage, JobId, NoteId, Stamp } from "@citegeist/schema";
import { z } from "zod";
import { defineContract, type OperationContract } from "../registry.js";

// Begriffsregister (concept index). A concept is a note of type "concept" in notes/concepts/ with
// aliases in its frontmatter. It collects cards and holds, per source, an AI-written entry on how
// that source uses or defines the term. None of these is an MCP tool: the tool budget is full, so
// agents reach concepts through the `cg concepts` commands, which the registry generates.

export const ConceptSummary = z.object({
  id: NoteId,
  /** File name without .md; the target of `[[...]]` links. */
  slug: z.string(),
  title: z.string(),
  aliases: z.array(z.string()),
  /** Member cards. */
  cards: z.array(CardId),
  /** Sources the member cards belong to. */
  sources: z.number().int().nonnegative(),
  /** Sources with an up-to-date entry. */
  described: z.number().int().nonnegative(),
  /** Sources without an entry or with an out-of-date one: what `concepts.describe` would write. */
  open: z.number().int().nonnegative(),
  modified: z.string().optional(),
});
export type ConceptSummary = z.infer<typeof ConceptSummary>;

export const ConceptCard = z.object({
  id: CardId,
  item: Citekey,
  kind: CardKind.optional(),
  quote: z.string(),
  page: z.string().nullable(),
});
export type ConceptCard = z.infer<typeof ConceptCard>;

export const ConceptUsageView = ConceptUsage.extend({
  /** True when the member cards of the source changed after the entry was written. */
  stale: z.boolean(),
});
export type ConceptUsageView = z.infer<typeof ConceptUsageView>;

export const Concept = ConceptSummary.extend({
  path: z.string(),
  /** The reader's own text above the generated entries. */
  note: z.string(),
  members: z.array(ConceptCard),
  usages: z.array(ConceptUsageView),
  created: Stamp,
});
export type Concept = z.infer<typeof Concept>;

export const ConceptProposal = z.object({
  term: z.string(),
  aliases: z.array(z.string()),
  /** "definition": named from cards of kind definition. "recurring": a term several sources repeat. */
  origin: z.enum(["definition", "recurring"]),
  cards: z.array(CardId),
  sources: z.array(Citekey),
  /** Set when the term is already a name of a concept: accepting adds the cards to it. */
  existing: NoteId.optional(),
});
export type ConceptProposal = z.infer<typeof ConceptProposal>;

const ConceptOp = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("rename"),
    title: z.string().min(1),
  }),
  z.object({ op: z.literal("addAlias"), alias: z.string().min(1) }),
  z.object({ op: z.literal("removeAlias"), alias: z.string().min(1) }),
  z.object({ op: z.literal("addCards"), cards: z.array(CardId).min(1) }),
  z.object({ op: z.literal("removeCards"), cards: z.array(CardId).min(1) }),
  z.object({ op: z.literal("setNote"), note: z.string() }),
]);
export type ConceptOp = z.infer<typeof ConceptOp>;

export const conceptsList = defineContract({
  name: "concepts.list",
  summary:
    "List the concepts of the library with aliases, member cards and how many sources have an entry",
  access: "read",
  input: z.object({
    query: z
      .string()
      .optional()
      .describe("matches the title or an alias, without regard to case or accents"),
    limit: z.number().int().positive().max(1000).default(500),
  }),
  output: z.object({ concepts: z.array(ConceptSummary) }),
});

export const conceptsGet = defineContract({
  name: "concepts.get",
  summary: "Read a concept: aliases, member cards and, per source, how it uses or defines the term",
  access: "read",
  input: z.object({ id: NoteId }),
  output: z.object({ concept: Concept }),
});

export const conceptsCreate = defineContract({
  name: "concepts.create",
  summary:
    "Create a concept from a term. A term or alias that a concept already has extends that concept instead (merged: true)",
  access: "write",
  input: z.object({
    term: z.string().min(1),
    aliases: z.array(z.string().min(1)).default([]),
    cards: z.array(CardId).default([]).describe("cards that belong to the concept"),
    collect: z
      .boolean()
      .default(true)
      .describe("also add the cards whose quote contains the term or an alias"),
  }),
  output: z.object({ concept: Concept, merged: z.boolean() }),
});

export const conceptsUpdate = defineContract({
  name: "concepts.update",
  summary:
    "Rename a concept (the old name becomes an alias and links follow), edit aliases and member cards, or set the reader's note",
  access: "write",
  input: z.object({ id: NoteId, ops: z.array(ConceptOp).min(1) }),
  output: z.object({ concept: Concept }),
});

export const conceptsMerge = defineContract({
  name: "concepts.merge",
  summary:
    "Merge concepts into one: titles and aliases of the others become aliases, cards are united, links to the others point to the target",
  access: "write",
  input: z.object({
    into: NoteId,
    from: z.array(NoteId).min(1),
  }),
  output: z.object({ concept: Concept }),
});

export const conceptsDescribe = defineContract({
  name: "concepts.describe",
  summary:
    "Write, per source, how it uses or defines the term, from the member cards only; quotes are verified against the stored card text. Runs as a job",
  access: "write",
  input: z.object({
    id: NoteId,
    force: z
      .boolean()
      .default(false)
      .describe("also rewrite entries that are up to date; default: only missing or stale ones"),
  }),
  output: z.object({ job: JobId, sources: z.number().int().nonnegative() }),
});

export const conceptsPropose = defineContract({
  name: "concepts.propose",
  summary:
    "Find concept candidates: terms defined by cards of kind definition and terms that several sources repeat. The job result lists the proposals; nothing is written",
  access: "read",
  input: z.object({
    limit: z.number().int().positive().max(100).default(30),
  }),
  output: z.object({ job: JobId }),
});

export const CONCEPT_CONTRACTS: readonly OperationContract[] = [
  conceptsList,
  conceptsGet,
  conceptsCreate,
  conceptsUpdate,
  conceptsMerge,
  conceptsDescribe,
  conceptsPropose,
];
