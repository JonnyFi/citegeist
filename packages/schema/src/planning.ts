import { z } from "zod";
import { ProjectSlug, Stamp } from "./common.js";

// Research planning (docs/spec/research-planning.md): plans with an outline of fixed fields and
// insights as dated Markdown paragraphs. Numbers such as "4.4" are computed, never stored.

const ulid = "[0-9A-HJKMNP-TV-Z]{10,26}";

/** Folder name of a plan under projects/<project>/plans/. */
export const PlanSlug = ProjectSlug;
export type PlanSlug = z.infer<typeof PlanSlug>;

/** Stable id of an outline node. Text links to a node as [[k_<ULID>]]. */
export const OutlineNodeId = z
  .string()
  .regex(new RegExp(`^k_${ulid}$`), "node id must look like k_<ULID>");
export type OutlineNodeId = z.infer<typeof OutlineNodeId>;

/** Block id the core sets on an insight paragraph, written as ^i-<10 chars>. */
export const InsightBlockId = z
  .string()
  .regex(/^i-[0-9A-HJKMNP-TV-Z]{10}$/, "insight block id must look like i-<10 characters>");
export type InsightBlockId = z.infer<typeof InsightBlockId>;

export const NodeStatus = z.enum(["idea", "draft", "solid", "done"]);
export type NodeStatus = z.infer<typeof NodeStatus>;

export const OutlineNode = z.object({
  id: OutlineNodeId,
  title: z.string().min(1),
  /** Id of the parent node, null for a chapter. */
  parent: OutlineNodeId.nullable(),
  /** Position among siblings, a whole number starting at 1. */
  order: z.number().int().positive(),
  /** One sentence on what the node is for. */
  purpose: z.string().optional(),
  status: NodeStatus.default("idea"),
  /** Ids of the research questions in project.md. */
  questions: z.array(z.string().regex(/^q\d+$/)).default([]),
});
export type OutlineNode = z.infer<typeof OutlineNode>;

/** Content of plans/<plan>/outline.yaml. */
export const Outline = z.object({ nodes: z.array(OutlineNode).default([]) });
export type Outline = z.infer<typeof Outline>;

export const PlanTemplate = z.enum(["expose", "imrad"]);
export type PlanTemplate = z.infer<typeof PlanTemplate>;

/** Frontmatter of plans/<plan>/plan.md; the body is the planning document. */
export const PlanFrontmatter = z.object({
  title: z.string().min(1),
  template: PlanTemplate.optional(),
  created: Stamp,
});
export type PlanFrontmatter = z.infer<typeof PlanFrontmatter>;

/** Frontmatter of a node document. `aliases` lets Obsidian resolve [[k_...]] to the file. */
export const NodeDocFrontmatter = z.object({
  node: OutlineNodeId,
  aliases: z.array(z.string()).default([]),
});
export type NodeDocFrontmatter = z.infer<typeof NodeDocFrontmatter>;
