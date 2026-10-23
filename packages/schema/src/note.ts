import { z } from "zod";
import { Actor, NoteId, ProjectSlug, Stamp, WikiLink } from "./common.js";

export const NoteType = z.enum([
  "permanent",
  "literature",
  "question",
  "claim",
  "project",
  "daily",
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
  status: z.enum(["proposed", "accepted"]).default("accepted"),
});
export type Link = z.infer<typeof Link>;

/** Frontmatter of notes/<slug>.md */
export const NoteFrontmatter = z.object({
  id: NoteId,
  type: NoteType.default("permanent"),
  title: z.string().min(1),
  links: z.array(Link).default([]),
  tags: z.array(z.string()).default([]),
  projects: z.array(ProjectSlug).default([]),
  created: Stamp,
  modified: Stamp.optional(),
});
export type NoteFrontmatter = z.infer<typeof NoteFrontmatter>;
