import { z } from "zod";
import {
  Actor,
  CardId,
  Citekey,
  ModelStamp,
  NoteId,
  ProjectSlug,
  Stamp,
  WikiLink,
} from "./common.js";

export const NoteType = z.enum([
  "permanent",
  "literature",
  "question",
  "claim",
  "project",
  "daily",
  "concept",
]);

/** Relation vocabulary, mappable to CiTO. Automatic relations are never written by users. */
export const Relation = z.enum([
  "supports",
  "opposes",
  "qualifies",
  "addresses",
  "extends",
  "uses-method-of",
  "uses-data-from",
  "elaborates",
  "related",
]);
export const AutoRelation = z.enum(["cites", "excerpt-of", "derived-from"]);

export const Link = z.object({
  to: WikiLink,
  rel: Relation.optional(),
  why: z.string().optional(),
  evidence: WikiLink.optional(),
  by: Actor,
  /** A rejected link stays in the file so that `links.propose` does not suggest it again. */
  status: z.enum(["proposed", "accepted", "rejected"]).default("accepted"),
});
export type Link = z.infer<typeof Link>;

/** A passage a concept usage rests on: a stretch of a card quote, with the page the card carries. */
export const ConceptEvidence = z.object({
  card: CardId,
  /** Verbatim text of the card quote; verified against the stored quote before it is written. */
  quote: z.string().min(1),
  page: z.string().nullable().default(null),
});
export type ConceptEvidence = z.infer<typeof ConceptEvidence>;

/**
 * How one source uses or defines the term of a concept (Begriffsregister). Written by the
 * `concept.describe` task from the member cards of that source and nothing else.
 */
export const ConceptUsage = z.object({
  item: Citekey,
  /** "defines" when the source states what the term means, "uses" when it applies it. */
  role: z.enum(["defines", "uses"]),
  text: z.string().min(1),
  evidence: z.array(ConceptEvidence).min(1),
  /** The member cards of the source at the time of writing. A different set makes the usage stale. */
  basis: z.array(CardId).default([]),
  stamp: ModelStamp,
  promptVersion: z.number().int().positive().optional(),
});
export type ConceptUsage = z.infer<typeof ConceptUsage>;

/**
 * Frontmatter of notes/<slug>.md. Notes of type "concept" (notes/concepts/<slug>.md) also use
 * `aliases` (the Obsidian property), `cards` (member cards) and `usages` (one per source).
 */
export const NoteFrontmatter = z.object({
  id: NoteId,
  type: NoteType.default("permanent"),
  title: z.string().min(1),
  aliases: z.array(z.string()).optional(),
  /** Concepts only: the cards that belong to the concept. */
  cards: z.array(CardId).optional(),
  /** Concepts only: how each source uses the term. */
  usages: z.array(ConceptUsage).optional(),
  links: z.array(Link).default([]),
  tags: z.array(z.string()).default([]),
  projects: z.array(ProjectSlug).default([]),
  created: Stamp,
  modified: Stamp.optional(),
});
export type NoteFrontmatter = z.infer<typeof NoteFrontmatter>;
