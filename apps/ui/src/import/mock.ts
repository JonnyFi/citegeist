import {
  DEFAULT_ZOTERO_PORT,
  type ImportReport,
  type ImportResult,
  importPreview,
  importRun,
  jobsGet,
  type Registry,
} from "@citegeist/ops";
import { CitegeistError, type Job } from "@citegeist/schema";
import type { z } from "zod";
import type { CoreEvent } from "../lib/core";

type Input = z.output<typeof importPreview.input>;
type Report = z.input<typeof ImportReport>;
type Result = z.input<typeof ImportResult>;

export interface ImportMockState {
  /** Port the "running Zotero" listens on. Any other port is refused. */
  zoteroPort: number;
  /** Reads of `jobs.get` before the import job succeeds. */
  runPolls: number;
  /** Error the import job ends with. Unset means success. */
  runError?: { code: string; message: string };
  /** Every input `import.run` received, for tests. */
  runs: Input[];
}

export function createImportMockState(over: Partial<ImportMockState> = {}): ImportMockState {
  return { zoteroPort: DEFAULT_ZOTERO_PORT, runPolls: 3, runs: [], ...over };
}

const TITLES: ReadonlyArray<readonly [string, string, string]> = [
  ["Soziale Systeme", "luhmann1984soziale", "doi"],
  ["Autopoiesis and Cognition", "maturana1980autopoiesis", ""],
  ["The Relevance of Algorithms", "gillespie2014relevance", ""],
  ["Die Gesellschaft der Gesellschaft", "luhmann1997gesellschaft", "title-year-author"],
  ["Der Mensch als Medium", "krämer2008medium", ""],
  ["Platforms and Cultural Production", "poell2021platforms", ""],
  ["Medientheorie zur Einführung", "hartmann2003medientheorie", "isbn"],
  ["Understanding Media", "mcluhan1964understanding", ""],
];

/** Counts and problems that follow from the input; the same input always gives the same report. */
function reportFor(input: Input): Report {
  const zotero = input.source.kind === "zotero-sqlite" || input.source.kind === "zotero-api";
  const total = zotero ? 132 : 41;
  const duplicates = zotero ? 6 : 2;
  const merging = input.onDuplicate === "merge";
  const create = total - duplicates;
  const attachments = input.attachments ? (zotero ? 97 : 18) : 0;
  const missing = input.attachments ? (zotero ? 4 : 1) : 0;
  const items: Report["items"] = TITLES.map(([title, citekey, reason], i) => {
    const duplicate = reason !== "" && i < duplicates;
    return {
      ref: zotero ? `ZK${String(i + 1).padStart(6, "0")}` : `entry-${i + 1}`,
      title,
      citekey,
      action: duplicate ? (merging ? ("merge" as const) : ("skip" as const)) : ("create" as const),
      ...(duplicate
        ? {
            duplicateOf: citekey,
            reason: reason as "doi" | "isbn" | "title-year-author",
          }
        : {}),
    };
  });
  const problems: Report["problems"] = [
    {
      code: "ATTACHMENT_MISSING",
      severity: "warning",
      message: "The attachment file is not in the storage folder.",
      ref: "ZK000004",
    },
    {
      code: "YEAR_UNREADABLE",
      severity: "info",
      message: "The date 'in press' has no year. The entry gets no year.",
      ref: "entry-6",
    },
  ];
  return {
    source: sourceLabel(input),
    provenance: `${zotero ? "zotero" : input.source.kind}@2026-10-24`,
    counts: {
      items: total,
      create,
      merge: merging ? duplicates : 0,
      skip: merging ? 0 : duplicates,
      attachments,
      attachmentsMissing: missing,
      notes: input.notes && zotero ? 23 : 0,
      annotations: input.annotations && input.attachments && zotero ? 58 : 0,
      annotationsSkipped: input.annotations && input.attachments && zotero ? 3 : 0,
      collections: zotero ? 9 : 0,
      tags: 64,
      projects: zotero && input.collections === "projects" ? 9 : 0,
    },
    items,
    truncated: true,
    problems,
    problemCount: 14,
  };
}

function sourceLabel(input: Input): string {
  const s = input.source;
  return s.kind === "zotero-api" ? `Zotero, localhost:${s.port}` : s.path;
}

function refuse(code: string, message: string, fix: string): never {
  throw new CitegeistError({ code, message, fix, recovery: "fix-and-retry" });
}

function resultFor(input: Input): Result {
  const report = reportFor(input);
  return {
    provenance: report.provenance,
    created: TITLES.slice(2).map(([, citekey]) => citekey),
    merged: input.onDuplicate === "merge" ? ["luhmann1984soziale"] : [],
    skipped: report.counts.skip,
    attachments: report.counts.attachments - report.counts.attachmentsMissing,
    notes: report.counts.notes,
    cards: report.counts.annotations,
    projects: input.collections === "projects" ? ["psychologie", "systemtheorie"] : [],
    problems: report.problems,
    problemCount: report.problemCount,
  };
}

export interface ImportMockJobs {
  /** The import job with this id, advanced by one read, or undefined for other ids. */
  get(id: string): Job | undefined;
  /** Import jobs so far, for `jobs.list`. */
  list(): Job[];
}

/**
 * import.preview and import.run over a fixed report. A path containing "missing" does not exist,
 * and Zotero answers only on `state.zoteroPort`. `bindJobs` also binds jobs.get; the app's mock
 * core has its own and asks the returned `jobs` first.
 */
export function bindImportMock(
  registry: Registry,
  state: ImportMockState,
  emit: (e: CoreEvent) => void = () => {},
  bindJobs = false,
): { registry: Registry; jobs: ImportMockJobs } {
  const created = new Map<string, { input: Input; reads: number; at: string }>();
  let counter = 0;

  const check = (input: Input) => {
    const s = input.source;
    if (s.kind === "zotero-api" && s.port !== state.zoteroPort) {
      refuse(
        "ZOTERO_NOT_RUNNING",
        `Zotero does not answer on port ${s.port}.`,
        "Start Zotero and turn on 'Allow other applications to communicate with Zotero'.",
      );
    }
    if (s.kind !== "zotero-api" && s.path.includes("missing")) {
      refuse("IMPORT_SOURCE_NOT_FOUND", `There is no file at ${s.path}.`, "Check the path.");
    }
  };

  const jobFor = (id: string, advance = true): Job | undefined => {
    const entry = created.get(id);
    if (!entry) return undefined;
    if (advance) entry.reads += 1;
    const base = {
      id,
      kind: "import" as const,
      input: entry.input,
      attempts: 1,
      by: "human" as const,
      createdAt: entry.at,
      updatedAt: new Date().toISOString(),
    };
    if (entry.reads < state.runPolls) {
      return {
        ...base,
        status: "running",
        progress: Math.min(0.9, entry.reads / state.runPolls),
        message: `Importing ${entry.reads * 40} of 132`,
      };
    }
    if (state.runError) {
      return { ...base, status: "failed", progress: 0.6, error: state.runError };
    }
    return { ...base, status: "succeeded", progress: 1, result: resultFor(entry.input) };
  };

  registry
    .bind(importPreview, async (_ctx, input) => {
      check(input);
      return reportFor(input);
    })
    .bind(importRun, async (_ctx, input) => {
      check(input);
      counter += 1;
      const id = `j_01J${String(counter).padStart(23, "0")}`;
      created.set(id, { input, reads: 0, at: new Date().toISOString() });
      state.runs.push(input);
      emit({ type: "change", path: "items", external: false });
      return { job: id };
    });
  if (bindJobs) {
    registry.bind(jobsGet, async (_ctx, input) => {
      const job = jobFor(input.job);
      if (!job) throw new Error(`JOB_NOT_FOUND: no job '${input.job}'`);
      return job;
    });
  }
  return {
    registry,
    jobs: {
      get: jobFor,
      list: () => [...created.keys()].map((id) => jobFor(id, false)).filter((j): j is Job => !!j),
    },
  };
}
