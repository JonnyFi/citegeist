import {
  Citekey,
  InsightBlockId,
  NodeStatus,
  OutlineNodeId,
  PlanSlug,
  PlanTemplate,
  ProjectFrontmatter,
  ProjectSlug,
} from "@citegeist/schema";
import { z } from "zod";
import { defineContract, type OperationContract } from "../registry.js";

// Research planning (docs/spec/research-planning.md section 6). Every operation takes the
// project, and the plan unless the project has exactly one.

const PlanRef = z.object({
  project: ProjectSlug,
  plan: PlanSlug.optional().describe("plan slug; may be left out when the project has one plan"),
});

const Question = z.string().regex(/^q\d+$/);

/** One outline node with its computed number and the path of its document, if it has one. */
export const NumberedNode = z.object({
  id: OutlineNodeId,
  title: z.string(),
  parent: OutlineNodeId.nullable(),
  order: z.number().int(),
  purpose: z.string().optional(),
  status: NodeStatus,
  questions: z.array(Question),
  /** Computed from parent and order, for example "4.4". Never stored. */
  number: z.string(),
  depth: z.number().int().nonnegative(),
  /** Library-relative path of the node's document. */
  doc: z.string().optional(),
});
export type NumberedNode = z.infer<typeof NumberedNode>;

export const plansCreate = defineContract({
  name: "plans.create",
  summary:
    "Create a plan in a project, optionally from the template 'expose' (PhD proposal) or 'imrad' (paper)",
  access: "write",
  input: z.object({
    project: ProjectSlug,
    slug: PlanSlug,
    title: z.string().min(1),
    template: PlanTemplate.optional(),
  }),
  output: z.object({
    project: ProjectSlug,
    plan: PlanSlug,
    title: z.string(),
    /** Library-relative paths of plan.md and outline.yaml. */
    path: z.string(),
    outline: z.string(),
    nodes: z.number().int().nonnegative(),
  }),
});

export const plansList = defineContract({
  name: "plans.list",
  summary: "List the plans of a project",
  access: "read",
  input: z.object({ project: ProjectSlug }),
  output: z.object({
    plans: z.array(
      z.object({
        plan: PlanSlug,
        title: z.string(),
        template: PlanTemplate.optional(),
        path: z.string(),
        nodes: z.number().int().nonnegative(),
      }),
    ),
  }),
});

export const outlineGet = defineContract({
  name: "outline.get",
  summary:
    "Read the outline of a plan: nodes with ids, computed numbers like 4.4, purpose, status and document path",
  access: "read",
  input: PlanRef,
  output: z.object({
    project: ProjectSlug,
    plan: PlanSlug,
    title: z.string(),
    nodes: z.array(NumberedNode),
  }),
});

export const projectsContext = defineContract({
  name: "projects.context",
  summary:
    "Read a project: brief, research questions, settings, item count, reading list (order, progress, next item) and its plans. With a plan (or when the project has exactly one) the outline comes along: nodes with ids, computed numbers like 4.4, purpose, status and document path",
  access: "read",
  input: z.object({
    slug: ProjectSlug,
    plan: PlanSlug.optional().describe(
      "plan slug for the outline; may be left out when the project has one plan",
    ),
  }),
  output: z.object({
    frontmatter: ProjectFrontmatter,
    brief: z.string(),
    items: z.number(),
    /**
     * The reading list of the project: counts, the first item still to read and the first 50
     * entries in reading order (projects.reading has all of them).
     */
    reading: z.object({
      total: z.number().int().nonnegative(),
      read: z.number().int().nonnegative(),
      next: z.object({ citekey: Citekey, title: z.string() }).optional(),
      entries: z.array(
        z.object({
          citekey: Citekey,
          title: z.string(),
          status: z.string(),
          note: z.string().optional(),
        }),
      ),
    }),
    plans: z.array(
      z.object({
        plan: PlanSlug,
        title: z.string(),
        template: PlanTemplate.optional(),
        nodes: z.number().int().nonnegative(),
      }),
    ),
    outline: z
      .object({ plan: PlanSlug, title: z.string(), nodes: z.array(NumberedNode) })
      .optional(),
  }),
  mcp: { tool: "get_project", readOnly: true, idempotent: true },
});

const OutlineOp = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add"),
    parent: OutlineNodeId.nullable().describe("parent node id, null for a chapter"),
    position: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("1-based position among siblings, default: last"),
    title: z.string().min(1),
    purpose: z.string().optional(),
    status: NodeStatus.optional(),
    questions: z.array(Question).optional(),
  }),
  z.object({
    op: z.literal("update"),
    id: OutlineNodeId,
    title: z.string().min(1).optional(),
    purpose: z.string().nullable().optional().describe("null removes the purpose"),
    status: NodeStatus.optional(),
    questions: z.array(Question).optional(),
  }),
  z.object({
    op: z.literal("move"),
    id: OutlineNodeId,
    parent: OutlineNodeId.nullable(),
    position: z.number().int().positive().optional(),
  }),
  z.object({ op: z.literal("remove"), id: OutlineNodeId }),
]);
export type OutlineOp = z.infer<typeof OutlineOp>;

export const outlineApply = defineContract({
  name: "outline.apply",
  summary:
    "Edit the outline of a plan: add, update, move or remove nodes in one atomic step. Numbers follow from the order, ids stay stable. Removing a node that has a document or incoming links needs force.",
  access: "write",
  input: PlanRef.extend({
    ops: z.array(OutlineOp).min(1),
    force: z.boolean().default(false),
  }),
  output: z.object({
    project: ProjectSlug,
    plan: PlanSlug,
    /** Ids of the nodes created by the add operations, in order. */
    added: z.array(OutlineNodeId),
    nodes: z.array(NumberedNode),
  }),
  mcp: { tool: "edit_outline", readOnly: false },
});

export const planDocsGet = defineContract({
  name: "plan.docs.get",
  summary:
    "Read the planning document or the document of an outline node: library path, text (without the frontmatter) and sha256 of the file. Pass the hash as baseHash when you write the document back (edit_plan_doc). A node without a document returns an empty text and exists=false.",
  access: "read",
  input: PlanRef.extend({
    doc: z.union([z.literal("plan"), OutlineNodeId]).describe("'plan' or a node id"),
  }),
  output: z.object({
    path: z.string(),
    body: z.string(),
    hash: z.string().regex(/^[0-9a-f]{64}$/),
    exists: z.boolean(),
  }),
});

export const planDocsUpdate = defineContract({
  name: "plan.docs.update",
  summary:
    "Replace the text of the planning document or of a node's document. Creates the document of a node when it has none. Pass baseHash from the last read to detect changes made in between.",
  access: "write",
  input: PlanRef.extend({
    doc: z.union([z.literal("plan"), OutlineNodeId]).describe("'plan' or a node id"),
    body: z.string(),
    baseHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional()
      .describe("sha256 of the file you read; the call fails when the file changed since"),
  }),
  output: z.object({ path: z.string(), hash: z.string() }),
  mcp: { tool: "edit_plan_doc", readOnly: false },
});

export const InsightHit = z.object({
  /** Library-relative path of the file that holds the paragraph. */
  path: z.string(),
  block: InsightBlockId.optional(),
  /** Date at the start of the paragraph, YYYY-MM-DD. */
  date: z.string().optional(),
  text: z.string(),
  stage: z.enum(["links", "semantic"]),
  why: z.string(),
  score: z.number(),
});
export type InsightHit = z.infer<typeof InsightHit>;

export const insightsNote = defineContract({
  name: "insights.note",
  summary:
    "Write an insight as a dated paragraph with [[wiki links]] to citekeys, cards and outline nodes. target is a node id or number like 3.1 (the chapter document gets it), 'plan' (planning document) or 'project' (insights.md). The core adds date and block id. Pick the place yourself and tell the user where it went.",
  access: "write",
  input: PlanRef.extend({
    target: z.string().min(1).describe("node id, node number like 3.1, 'plan' or 'project'"),
    text: z.string().min(1).describe("the insight as one paragraph, with [[wiki links]]"),
  }),
  output: z.object({
    /** Library-relative path of the file the paragraph went to. */
    path: z.string(),
    block: InsightBlockId,
    place: z.enum(["node", "plan", "project"]),
    node: OutlineNodeId.optional(),
    /** Computed number of the node, for example "3.1". */
    number: z.string().optional(),
    title: z.string().optional(),
    /** One line to show the user, for example "Noted in 3, Luhmanns Kommunikationsbegriff". */
    summary: z.string(),
  }),
  mcp: { tool: "note_insight", readOnly: false },
});

export const insightsFind = defineContract({
  name: "insights.find",
  summary:
    "Find insight paragraphs for a planning task. First paragraphs connected by wiki links to the outline node, its sources and cards, ranked by shared links and then date. Then paragraphs similar in text to the query. Call it before you plan or rebuild a chapter and cite what you use.",
  access: "read",
  input: PlanRef.extend({
    node: z.string().optional().describe("node id or number like 3.1"),
    refs: z
      .array(z.string())
      .optional()
      .describe("citekeys, card ids or note ids to match by link"),
    query: z.string().optional().describe("text to search for; defaults to the node title"),
    limit: z.number().int().positive().max(50).default(5),
  }),
  output: z.object({ hits: z.array(InsightHit) }),
  mcp: { tool: "find_insights", readOnly: true, idempotent: true },
});

export const insightsList = defineContract({
  name: "insights.list",
  summary:
    "List every insight of a plan and of the project's own insights file, newest first. Without plan, the insights of all plans of the project. Each hit has stage 'links', score 0 and a why that names the place; the text starts with the date.",
  access: "read",
  input: PlanRef.extend({ limit: z.number().int().positive().max(500).default(50) }),
  output: z.object({ hits: z.array(InsightHit) }),
});

export const PLANNING_CONTRACTS: readonly OperationContract[] = [
  plansCreate,
  plansList,
  outlineGet,
  projectsContext,
  outlineApply,
  planDocsGet,
  planDocsUpdate,
  insightsNote,
  insightsFind,
  insightsList,
];
