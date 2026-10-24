import { Citekey, JobId, ProjectSlug } from "@citegeist/schema";
import { z } from "zod";
import { defineContract, type OperationContract } from "../registry.js";
import { LitsearchRunId } from "./litsearch.js";

// Alerts: saved watches that look for new works on a schedule and put the best ones into the
// inbox (D7, actor "system", why "Alert: <name>"). The definitions are plain files:
// projects/<slug>/alerts.yaml for the alerts of a project, alerts.yaml at the library root for
// the others. When an alert ran, what it found and a cursor stay machine-local.
//
// The kind `pipeline` is a saved literature search (D19): each check runs the pipeline of
// workers/research as a litsearch.run job, compares the run with the alert's previous one and
// puts the new papers, best score first, into the inbox.

export const ALERT_SOURCE_KINDS = [
  "arxiv-category",
  "arxiv-query",
  "openalex-topic",
  "openalex-search",
  "author",
  "cites",
  "pipeline",
] as const;
export const AlertSourceKind = z.enum(ALERT_SOURCE_KINDS);
export type AlertSourceKind = z.infer<typeof AlertSourceKind>;

/** Lowercase id of an alert, unique in the library. It is derived from the name. */
export const AlertId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,59}$/, "lowercase letters, digits and hyphens, at most 60");

const ARXIV_CATEGORY = /^[a-z]+(-[a-z]+)*(\.[A-Za-z]+(-[A-Za-z]+)*)?$/;
const OPENALEX_TOPIC = /(?:^|\/)T\d+\/?$/i;
const OPENALEX_AUTHOR = /(?:^|\/)A\d+\/?$/i;
const ORCID = /\d{4}-\d{4}-\d{4}-\d{3}[\dX]/i;

/** The search a `pipeline` alert repeats: the queries, the year filter and the size of the result. */
export const PipelineSpec = z.object({
  queries: z.array(z.string().trim().min(1)).min(1).max(20),
  since: z.number().int().min(1900).max(2100).optional(),
  top: z.number().int().min(1).max(500).optional(),
  /** The run the alert was saved from. The first check compares with it. */
  fromRun: LitsearchRunId.optional(),
});
export type PipelineSpec = z.infer<typeof PipelineSpec>;

/**
 * What an alert watches. `value` is read by `kind`: a category, a query, an id, a citekey or, for
 * `pipeline`, the topic of the search (its queries are in `pipeline`).
 */
export const AlertSource = z
  .object({
    kind: AlertSourceKind,
    value: z.string().trim().min(1).max(500),
    pipeline: PipelineSpec.optional(),
  })
  .superRefine((s, ctx) => {
    const bad = (message: string) => ctx.addIssue({ code: "custom", path: ["value"], message });
    switch (s.kind) {
      case "arxiv-category":
        if (!ARXIV_CATEGORY.test(s.value)) bad("an arXiv category such as cs.CL or hep-th");
        break;
      case "openalex-topic":
        if (!OPENALEX_TOPIC.test(s.value)) bad("an OpenAlex topic id such as T10181");
        break;
      case "author":
        if (!OPENALEX_AUTHOR.test(s.value) && !ORCID.test(s.value)) {
          bad("an ORCID or an OpenAlex author id such as A5086198262");
        }
        break;
      case "cites":
        if (!Citekey.safeParse(s.value).success) bad("the citekey of an item in the library");
        break;
      case "pipeline":
        if (!s.pipeline) {
          ctx.addIssue({
            code: "custom",
            path: ["pipeline"],
            message: "a pipeline alert needs the queries of the search",
          });
        }
        break;
      default:
        break;
    }
  });
export type AlertSource = z.infer<typeof AlertSource>;

const Interval = z.number().int().min(1).max(720);
const Limit = z.number().int().min(1).max(50);

/** One alert as the YAML file stores it. */
export const AlertDef = z.object({
  id: AlertId,
  name: z.string().trim().min(1).max(120),
  source: AlertSource,
  /** Hours between two runs. Default one day, one week for a `pipeline` alert (a run is expensive). */
  intervalHours: Interval.default(24),
  /** How many of the new works go into the inbox per run. */
  limit: Limit.default(5),
  /** Rank the new works against the project brief with the local embedder, best first. A `pipeline` alert ranks by its own score. */
  rank: z.boolean().default(true),
  enabled: z.boolean().default(true),
  created: z.string(),
});
export type AlertDef = z.infer<typeof AlertDef>;

/** What one run did. */
export const AlertRun = z.object({
  at: z.string(),
  ok: z.boolean(),
  /** Works the source returned for the window. */
  fetched: z.number().int().nonnegative(),
  /** New works left after removing the ones in the library, in the inbox or proposed before. */
  found: z.number().int().nonnegative(),
  /** Works put into the inbox. */
  added: z.number().int().nonnegative(),
  /** True when the order of `added` comes from the similarity to the project brief. */
  ranked: z.boolean(),
  /** The literature search run behind the check of a `pipeline` alert. */
  runId: LitsearchRunId.optional(),
  error: z.string().optional(),
});
export type AlertRun = z.infer<typeof AlertRun>;

export const AlertInfo = AlertDef.extend({
  /** The project whose file holds the alert. Absent for the library-wide alerts. */
  project: ProjectSlug.optional(),
  lastRun: AlertRun.optional(),
  /** When the next run is due. Absent for a paused alert. */
  nextRun: z.string().optional(),
});
export type AlertInfo = z.infer<typeof AlertInfo>;

/** The result of a run, as the job stores it. */
export const AlertRunResult = AlertRun.extend({
  alert: AlertId,
  citekeys: z.array(Citekey),
});
export type AlertRunResult = z.infer<typeof AlertRunResult>;

const AlertFields = z.object({
  name: AlertDef.shape.name,
  source: AlertSource,
  intervalHours: Interval,
  limit: Limit,
  rank: z.boolean(),
  enabled: z.boolean(),
});

export const alertsList = defineContract({
  name: "alerts.list",
  summary:
    "List alerts with their last run. With `project` only that project's alerts, with `libraryOnly` only the library-wide ones, else all",
  access: "read",
  input: z.object({
    project: ProjectSlug.optional(),
    libraryOnly: z.boolean().default(false),
  }),
  output: z.object({ alerts: z.array(AlertInfo) }),
});

export const alertsCreate = defineContract({
  name: "alerts.create",
  summary:
    "Create an alert: a saved watch of an arXiv category or query, an OpenAlex topic or search, an author, the works that cite an item, or a literature search (pipeline). It runs on its interval and adds the best new works to the inbox",
  access: "write",
  input: AlertFields.partial({
    intervalHours: true,
    limit: true,
    rank: true,
    enabled: true,
  }).extend({
    /** The project the alert belongs to; without it the alert is library-wide. */
    project: ProjectSlug.optional(),
  }),
  output: AlertInfo,
});

export const alertsUpdate = defineContract({
  name: "alerts.update",
  summary: "Change the name, source, interval, limit, ranking or pause state of an alert",
  access: "write",
  input: z.object({ id: AlertId, patch: AlertFields.partial() }),
  output: AlertInfo,
});

export const alertsDelete = defineContract({
  name: "alerts.delete",
  summary: "Delete an alert. Works it already put into the inbox stay there",
  access: "write",
  input: z.object({ id: AlertId }),
  output: z.object({ ok: z.literal(true) }),
});

export const alertsRunNow = defineContract({
  name: "alerts.runNow",
  summary:
    "Run an alert now as a job, whatever its interval. The job result names the works put into the inbox",
  access: "write",
  input: z.object({ id: AlertId }),
  output: z.object({ job: JobId }),
});

export const ALERT_CONTRACTS: readonly OperationContract[] = [
  alertsList,
  alertsCreate,
  alertsUpdate,
  alertsDelete,
  alertsRunNow,
];
