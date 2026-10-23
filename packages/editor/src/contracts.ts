/**
 * Interim contracts for what the notes screen needs on top of notes.get, notes.create and
 * notes.update. They live here because packages/ops/src/contracts is a hotspot. The lead moves
 * them to packages/ops (same names, same shapes) and then these two exports can be deleted.
 */
import { defineContract } from "@citegeist/ops";
import { NoteFrontmatter } from "@citegeist/schema";
import { z } from "zod";

export const NoteSummary = z.object({
  id: NoteFrontmatter.shape.id,
  /** File name without .md; the target of `[[...]]` links, as in an Obsidian vault. */
  slug: z.string(),
  title: z.string(),
  type: NoteFrontmatter.shape.type,
  created: z.string(),
  modified: z.string().optional(),
  tags: z.array(z.string()),
  projects: z.array(z.string()),
});
export type NoteSummary = z.infer<typeof NoteSummary>;

export const notesList = defineContract({
  name: "notes.list",
  summary: "List notes, newest change first, optionally filtered by a title substring or project",
  access: "read",
  input: z.object({
    query: z.string().optional(),
    project: z.string().optional(),
    limit: z.number().int().positive().max(500).default(200),
  }),
  output: z.object({ notes: z.array(NoteSummary) }),
});

export const Backlink = z.object({
  /** What links here. */
  kind: z.enum(["item", "card", "note"]),
  /** Citekey, card id or note id. */
  id: z.string(),
  /** Citekey of the item a card belongs to; the route to a card goes through it. */
  citekey: z.string().optional(),
  title: z.string(),
  /** Type of a typed link from the frontmatter; absent for plain wiki links. */
  rel: z.string().optional(),
  status: z.enum(["proposed", "accepted"]),
  origin: z.enum(["wiki", "frontmatter"]),
});
export type Backlink = z.infer<typeof Backlink>;

export const notesBacklinks = defineContract({
  name: "notes.backlinks",
  summary: "Everything that links to a note: wiki links and typed links from notes, items, cards",
  access: "read",
  input: z.object({ id: NoteFrontmatter.shape.id }),
  output: z.object({ backlinks: z.array(Backlink) }),
});
