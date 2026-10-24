import { Citekey, JobId, ProjectSlug } from "@citegeist/schema";
import { z } from "zod";
import { defineContract, type OperationContract } from "../registry.js";

// Citation graph, snowballing and retraction checks (W4.5). References and citing works are
// marked against the library; candidates go to the inbox (D7), never straight into the library.

/** Whether a work of the graph is already known to the library. */
export const WorkStatus = z.enum(["library", "inbox", "new"]);

/** A work in the citation graph. Which fields are present depends on the source. */
export const GraphWork = z.object({
  doi: z.string().optional().describe("lowercase DOI without prefix"),
  openalex: z.string().optional().describe("OpenAlex id, W123"),
  arxiv: z.string().optional().describe("arXiv id without version"),
  pmid: z.string().optional(),
  title: z.string().optional(),
  authors: z.string().optional().describe("family names, for example 'Harris, Millman, Walt'"),
  year: z.number().int().optional(),
  container: z.string().optional().describe("journal, proceedings or book"),
  citedBy: z.number().int().nonnegative().optional(),
  raw: z.string().optional().describe("the reference as printed, when nothing better is known"),
  key: z.string().optional().describe("key of the entry in refs.jsonl or the Crossref deposit"),
});
export type GraphWork = z.infer<typeof GraphWork>;

export const MarkedWork = GraphWork.extend({
  status: WorkStatus,
  /** The library item when the work is in the library or the inbox. */
  citekey: Citekey.optional(),
  /** False when the entry carries no DOI, arXiv id or OpenAlex id, so graph.addCandidates cannot add it. */
  addable: z.boolean(),
});
export type MarkedWork = z.infer<typeof MarkedWork>;

const StatusCounts = z.object({
  library: z.number().int().nonnegative(),
  inbox: z.number().int().nonnegative(),
  new: z.number().int().nonnegative(),
});

export const ReferenceSource = z.enum(["refs.jsonl", "crossref", "openalex"]);

export const graphReferences = defineContract({
  name: "graph.references",
  summary:
    "List the works an item cites, each marked as in the library, in the inbox or new. Taken from refs.jsonl when the item is converted, else from the Crossref deposit, else from OpenAlex",
  access: "read",
  input: z.object({
    citekey: Citekey,
    limit: z.number().int().positive().max(1000).default(200),
  }),
  output: z.object({
    citekey: Citekey,
    /** Where the list comes from. Absent when no source has a reference list. */
    source: ReferenceSource.optional(),
    /** References the source lists, before `limit` cut the list. */
    total: z.number().int().nonnegative(),
    references: z.array(MarkedWork),
    counts: StatusCounts,
    /** Sources that failed while looking, so that an empty list is not mistaken for no references. */
    errors: z.array(z.string()),
  }),
});

export const graphCiting = defineContract({
  name: "graph.citing",
  summary:
    "List the works that cite an item (OpenAlex cited_by, most cited first), each marked as in the library, in the inbox or new",
  access: "read",
  input: z.object({
    citekey: Citekey,
    limit: z.number().int().positive().max(200).default(50),
    cursor: z.string().optional().describe("the `next` of the previous page"),
  }),
  output: z.object({
    citekey: Citekey,
    /** Citing works OpenAlex knows. */
    total: z.number().int().nonnegative(),
    citing: z.array(MarkedWork),
    counts: StatusCounts,
    next: z.string().optional(),
  }),
});

export const graphRelated = defineContract({
  name: "graph.related",
  summary:
    "Related works of an item. direction 'references' lists what the item cites (refs.jsonl, else the Crossref deposit, else OpenAlex); 'citing' lists the works that cite it (OpenAlex, most cited first). Each work is marked as in the library, in the inbox or new. To add a work marked new, pass its DOI or arXiv id to add_item",
  access: "read",
  input: z.object({
    citekey: Citekey,
    direction: z.enum(["references", "citing"]),
    limit: z.number().int().positive().max(200).default(50),
    cursor: z.string().optional().describe("the `next` of the previous page (citing only)"),
  }),
  output: z.object({
    citekey: Citekey,
    direction: z.enum(["references", "citing"]),
    /** Where a reference list comes from. Absent for citing works and when no source has a list. */
    source: ReferenceSource.optional(),
    /** Works the source lists, before `limit` cut the list. */
    total: z.number().int().nonnegative(),
    works: z.array(MarkedWork),
    counts: StatusCounts,
    /** Sources that failed while looking, so that an empty list is not mistaken for no works. */
    errors: z.array(z.string()),
    next: z.string().optional(),
  }),
  mcp: { tool: "related_works", readOnly: true },
});

/** What identifies a candidate: the first of DOI, arXiv id and OpenAlex id that is present. */
export const Candidate = GraphWork.refine((w) => Boolean(w.doi || w.arxiv || w.openalex), {
  message: "a candidate needs a doi, an arxiv id or an openalex id",
});

export const CandidateResult = z.object({
  /** The identifier that was used. */
  identifier: z.string(),
  status: z.enum(["added", "duplicate", "failed"]),
  citekey: Citekey.optional(),
  job: JobId.optional(),
  /** Why the candidate failed. */
  reason: z.string().optional(),
});

export const graphAddCandidates = defineContract({
  name: "graph.addCandidates",
  summary:
    "Add works from graph.references or graph.citing to the inbox, in one call. The user accepts or rejects them in the inbox",
  access: "write",
  input: z.object({
    candidates: z.array(Candidate).min(1).max(50),
    /** The item the candidates were found at. Named in the inbox note. */
    from: Citekey.optional(),
    /** Which list the candidates come from: it words the inbox note ("cited by" or "cites"). */
    via: z.enum(["references", "citing"]).optional(),
    projects: z.array(ProjectSlug).default([]),
    tags: z.array(z.string()).default([]),
  }),
  output: z.object({
    results: z.array(CandidateResult),
    added: z.number().int().nonnegative(),
    duplicates: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
});

export const NoticeKind = z.enum([
  "retraction",
  "withdrawal",
  "expression-of-concern",
  "correction",
]);

export const RetractionNotice = z.object({
  kind: NoticeKind,
  label: z.string().optional(),
  doi: z.string().optional().describe("DOI of the notice"),
  date: z.string().optional(),
  source: z.enum(["publisher", "retraction-watch", "openalex", "pubmed"]),
  recordId: z.string().optional().describe("Retraction Watch record id"),
});

/** Worst notice first: retracted, withdrawn, expression of concern, corrected. */
export const RetractionStatus = z.enum(["retracted", "withdrawn", "concern", "corrected"]);

/** The marker stored in the frontmatter key `retraction` of an item. */
export const RetractionMarker = z.object({
  status: RetractionStatus,
  notices: z.array(RetractionNotice).min(1),
  /** Date of the check that wrote the marker. */
  checked: z.string(),
});
export type RetractionMarker = z.infer<typeof RetractionMarker>;

/** The part of a marker that items.list carries per item: the status and the link to the notice. */
export const RetractionSummary = z.object({
  status: RetractionStatus,
  noticeUrl: z.string().optional().describe("Link to the first notice that has a DOI"),
});
export type RetractionSummary = z.infer<typeof RetractionSummary>;

/** Link to the notice: the DOI of the first notice that has one. */
export function retractionNoticeUrl(marker: RetractionMarker): string | undefined {
  const doi = marker.notices.find((n) => n.doi)?.doi;
  return doi ? `https://doi.org/${doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")}` : undefined;
}

/** The summary of a raw frontmatter value `retraction`; undefined when there is none or it is malformed. */
export function summarizeRetraction(raw: unknown): RetractionSummary | undefined {
  if (raw === undefined || raw === null) return undefined;
  const parsed = RetractionMarker.safeParse(raw);
  if (!parsed.success) return undefined;
  const url = retractionNoticeUrl(parsed.data);
  return { status: parsed.data.status, ...(url ? { noticeUrl: url } : {}) };
}

export const itemsCheckRetractions = defineContract({
  name: "items.checkRetractions",
  summary:
    "Check items with a DOI against Crossref (publisher notices and Retraction Watch) and store a retraction or correction marker in the frontmatter key `retraction`. Without citekeys the whole library is checked as a job",
  access: "write",
  input: z.object({
    citekeys: z.array(Citekey).min(1).max(200).optional(),
  }),
  output: z.object({
    /** Set when the whole library is checked in the background. */
    job: JobId.optional(),
    checked: z.number().int().nonnegative(),
    /** Items that carry a marker after the check. */
    flagged: z.array(
      z.object({
        citekey: Citekey,
        status: RetractionStatus,
        notices: z.array(RetractionNotice),
        /** True when this check created or changed the marker. */
        changed: z.boolean(),
      }),
    ),
    /** Items whose marker this check removed because Crossref no longer lists a notice. */
    cleared: z.array(Citekey),
    /** Items without a DOI. */
    skipped: z.number().int().nonnegative(),
    errors: z.array(z.object({ citekey: Citekey, message: z.string() })),
  }),
});

export const GRAPH_CONTRACTS: readonly OperationContract[] = [
  graphReferences,
  graphCiting,
  graphRelated,
  graphAddCandidates,
  itemsCheckRetractions,
];
