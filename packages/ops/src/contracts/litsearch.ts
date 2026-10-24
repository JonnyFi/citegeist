import { Citekey, JobId, ProjectSlug } from "@citegeist/schema";
import { z } from "zod";
import { defineContract, type OperationContract } from "../registry.js";
import { CandidateResult, WorkStatus } from "./graph.js";

// Literature search (issue #50, from research-pipeline). A run searches OpenAlex, arXiv and
// Semantic Scholar, ranks every paper with a 0 to 100 score and verifies each DOI. Runs live in
// <library>/research/runs/<id>/; selected papers go to the inbox (D7), never straight into the
// library. A search that repeats is an alert of the kind `pipeline` (alerts.*, D19). None of
// these is an MCP tool: the tool budget is full and a search is run in the app.

const Ok = z.object({ ok: z.literal(true) });

/** Folder name of a run under research/runs/, for example 2026-10-24-agent-communication. */
export const LitsearchRunId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,119}$/, "a run id is lowercase letters, digits and hyphens");

/** The optional sources a run can switch off. */
export const LitsearchSource = z.enum(["dblp", "openreview", "unpaywall", "orcid"]);
export type LitsearchSource = z.infer<typeof LitsearchSource>;

/** Status in run.json. `interrupted`: the process ended without writing a final status. */
export const LitsearchRunStatus = z.enum(["running", "done", "failed", "cancelled", "interrupted"]);
export type LitsearchRunStatus = z.infer<typeof LitsearchRunStatus>;

/** Sections of papers.csv: peer-reviewed list, preprints, grey literature, rejected. */
export const LitsearchSection = z.enum(["main", "preprint", "grey", "rejected"]);
export type LitsearchSection = z.infer<typeof LitsearchSection>;

export const LitsearchRunSummary = z.object({
  id: LitsearchRunId,
  topic: z.string(),
  status: LitsearchRunStatus,
  queries: z.array(z.string()),
  since: z.number().int().optional(),
  top: z.number().int().optional(),
  created: z.string(),
  finished: z.string().optional(),
  /** Papers per section, from run.json. Empty while running. */
  counts: z.record(z.string(), z.number().int().nonnegative()),
  /** The pipeline alert that started the run (alerts.list). */
  alert: z.string().optional(),
});
export type LitsearchRunSummary = z.infer<typeof LitsearchRunSummary>;

export const LitsearchRunMeta = LitsearchRunSummary.extend({
  droppedQueries: z.array(z.string()),
  attempts: z.number().int().nonnegative(),
  /** Last error message of the pipeline, when the run failed. */
  error: z.string().optional(),
});
export type LitsearchRunMeta = z.infer<typeof LitsearchRunMeta>;

export const LitsearchStage = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["pending", "running", "done", "failed", "skipped"]),
  seconds: z.number().nonnegative().optional(),
  /** Latest counter of the stage, for example "authors fetched". */
  done: z.number().int().nonnegative().optional(),
  total: z.number().int().nonnegative().optional(),
  note: z.string().optional(),
});
export type LitsearchStage = z.infer<typeof LitsearchStage>;

/** One row of papers.csv, typed. */
export const LitsearchPaper = z.object({
  /** OpenAlex id, else `p` + 12 hex digits of the DOI or title hash (stable across runs). */
  key: z.string(),
  section: LitsearchSection,
  rank: z.number().int().positive().optional(),
  score: z.number(),
  scoreParts: z.object({
    relevance: z.number(),
    venue: z.number(),
    author: z.number(),
    citations: z.number(),
  }),
  why: z.string(),
  foundVia: z.string(),
  title: z.string(),
  authors: z.array(z.string()),
  year: z.number().int().optional(),
  venue: z.string(),
  venueTier: z.number().int().optional(),
  type: z.string(),
  doi: z.string().optional().describe("verified DOI, else the DOI OpenAlex reported"),
  verified: z.boolean(),
  arxiv: z.string().optional(),
  openalex: z.string().optional(),
  citedBy: z.number().int().nonnegative().optional(),
  citationsPerYear: z.number().optional(),
  fwci: z.number().optional(),
  maxHIndex: z.number().int().nonnegative().optional(),
  abstract: z.string(),
  summary: z.string(),
  queries: z.array(z.string()),
  link: z.string().optional(),
  rejectedReason: z.string().optional(),
  reviewStatus: z.string().optional(),
  /** Whether the library knows the paper; `new` when it is in neither inbox nor library. */
  status: WorkStatus,
  citekey: Citekey.optional(),
  /** In the run of a pipeline alert: the alert's run before it did not have this paper. */
  newInAlert: z.boolean().optional(),
});
export type LitsearchPaper = z.infer<typeof LitsearchPaper>;

export const LitsearchPreprint = z.object({
  id: z.string(),
  title: z.string(),
  doi: z.string().optional(),
  arxiv: z.string().optional(),
  /**
   * preprint: nothing found yet; accepted: accepted at OpenReview, no DOI yet; published: a
   * peer-reviewed version with a DOI that resolves. The published version is the one the library
   * graph links (graph/versions.ts) or, for a paper outside the library, the core's check cache.
   */
  status: z.enum(["preprint", "accepted", "published"]),
  /** The runs and reference lists it came from ("run:<id>", "import:<file>"). */
  from: z.array(z.string()),
  checked: z.string().optional(),
  published: z
    .object({ doi: z.string(), venue: z.string(), year: z.number().int().optional() })
    .optional(),
  /** Accepted at OpenReview: the venue. */
  acceptedAt: z.string().optional(),
});
export type LitsearchPreprint = z.infer<typeof LitsearchPreprint>;

const RunHandle = z.object({ runId: LitsearchRunId, job: JobId });

export const litsearchSuggest = defineContract({
  name: "litsearch.suggest",
  summary:
    "Suggest search queries in OpenAlex syntax for a research topic, with the model set for this task",
  access: "read",
  input: z.object({
    topic: z.string().min(1).max(500),
    maxQueries: z.number().int().min(1).max(20).default(8),
  }),
  output: z.object({ queries: z.array(z.string()) }),
});

export const litsearchStart = defineContract({
  name: "litsearch.start",
  summary:
    "Start a literature search run as a job. One run at a time per library; results land in research/runs/<id>/",
  access: "write",
  input: z.object({
    topic: z.string().min(1).max(500),
    queries: z.array(z.string().min(1)).min(1).max(20),
    since: z.number().int().min(1900).max(2100).optional(),
    top: z.number().int().min(1).max(500).optional(),
    disableSources: z.array(LitsearchSource).default([]),
  }),
  output: RunHandle,
});

export const litsearchResume = defineContract({
  name: "litsearch.resume",
  summary: "Continue a failed, cancelled or interrupted run; finished queries come from its cache",
  access: "write",
  input: z.object({ runId: LitsearchRunId }),
  output: RunHandle,
});

export const litsearchCancel = defineContract({
  name: "litsearch.cancel",
  summary: "Stop the running search",
  access: "write",
  input: z.object({ runId: LitsearchRunId }),
  output: Ok,
});

export const litsearchRuns = defineContract({
  name: "litsearch.runs",
  summary: "List the literature search runs of the library, newest first",
  access: "read",
  input: z.object({
    limit: z.number().int().positive().max(500).default(50),
    cursor: z.string().optional(),
  }),
  output: z.object({ runs: z.array(LitsearchRunSummary), next: z.string().optional() }),
});

export const litsearchGet = defineContract({
  name: "litsearch.get",
  summary:
    "One run: its settings, stage progress and the ranked papers, each marked as in the library, in the inbox or new",
  access: "read",
  input: z.object({ runId: LitsearchRunId }),
  output: z.object({
    run: LitsearchRunMeta,
    stages: z.array(LitsearchStage),
    papers: z.array(LitsearchPaper),
  }),
});

export const litsearchCompare = defineContract({
  name: "litsearch.compare",
  summary:
    "Compare two runs: papers only in the newer one, papers it dropped and papers that moved",
  access: "read",
  input: z.object({ a: LitsearchRunId, b: LitsearchRunId }),
  output: z.object({
    added: z.array(LitsearchPaper),
    dropped: z.array(LitsearchPaper),
    moved: z.array(
      z.object({
        paper: LitsearchPaper,
        from: z.number().int().positive(),
        to: z.number().int().positive(),
      }),
    ),
  }),
});

export const litsearchReport = defineContract({
  name: "litsearch.report",
  summary:
    "Write the self-contained HTML report of a run (report.html in the run folder) and return it, so the app can offer it as a download",
  access: "write",
  input: z.object({ runId: LitsearchRunId }),
  output: z.object({ path: z.string(), filename: z.string(), html: z.string() }),
});

export const litsearchExport = defineContract({
  name: "litsearch.export",
  summary:
    "A run's ranked list as Markdown, CSV, BibTeX or per-paper summaries: the file in the run folder and its text",
  access: "read",
  input: z.object({
    runId: LitsearchRunId,
    format: z.enum(["md", "csv", "bib", "summaries"]),
  }),
  output: z.object({ path: z.string(), filename: z.string(), content: z.string() }),
});

export const litsearchToInbox = defineContract({
  name: "litsearch.toInbox",
  summary:
    "Add papers of a run to the inbox with the search as the reason. The user accepts or rejects them there",
  access: "write",
  input: z.object({
    runId: LitsearchRunId,
    keys: z.array(z.string().min(1)).min(1).max(50),
    projects: z.array(ProjectSlug).default([]),
  }),
  output: z.object({
    results: z.array(CandidateResult.extend({ key: z.string() })),
    added: z.number().int().nonnegative(),
    duplicates: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
});

export const litsearchPreprints = defineContract({
  name: "litsearch.preprints",
  summary: "Tracked preprints and the ones that have since appeared in a peer-reviewed venue",
  access: "read",
  input: z.object({}),
  output: z.object({
    tracked: z.array(LitsearchPreprint),
    published: z.array(LitsearchPreprint),
    lastCheck: z.string().optional(),
  }),
});

export const litsearchPreprintsImport = defineContract({
  name: "litsearch.preprintsImport",
  summary: "Track the preprints cited in a references.bib or a Markdown reference list",
  access: "write",
  input: z.object({ path: z.string().min(1) }),
  output: z.object({ added: z.number().int().nonnegative() }),
});

export const litsearchPreprintsCheck = defineContract({
  name: "litsearch.preprintsCheck",
  summary: "Check every tracked preprint for a peer-reviewed version now",
  access: "write",
  input: z.object({}),
  output: z.object({ job: JobId }),
});

export const LITSEARCH_CONTRACTS: readonly OperationContract[] = [
  litsearchSuggest,
  litsearchStart,
  litsearchResume,
  litsearchCancel,
  litsearchRuns,
  litsearchGet,
  litsearchCompare,
  litsearchReport,
  litsearchExport,
  litsearchToInbox,
  litsearchPreprints,
  litsearchPreprintsImport,
  litsearchPreprintsCheck,
];
