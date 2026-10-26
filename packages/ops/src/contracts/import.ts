import { JobId, ProjectSlug } from "@citegeist/schema";
import { z } from "zod";
import { defineContract, type OperationContract } from "../registry.js";

// Importers (Zotero, BibTeX, RIS, CSL-JSON; docs/decisions/0003-importers.md). Both operations take the same input. The
// preview reads the source and reports what a run would do, without writing anything.

/** Port of the Zotero local API unless the user picks another one. */
export const DEFAULT_ZOTERO_PORT = 23119;

export const ImportSource = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("zotero-sqlite"),
    /** The zotero.sqlite file, or the Zotero data directory that holds it. It is copied first and never opened in place. */
    path: z.string().min(1),
    /** Folder with the attachment files. Default: `storage` next to zotero.sqlite. */
    storage: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal("zotero-api"),
    /** Port of the Zotero 10 local API, which is only available while Zotero runs. */
    port: z.number().int().min(1024).max(65535).default(DEFAULT_ZOTERO_PORT),
  }),
  z.object({
    kind: z.enum(["bibtex", "ris", "csl-json"]),
    /** BibTeX and BibLaTeX files share the kind `bibtex`. */
    path: z.string().min(1),
    /** Folder with PDFs. A file is matched to an entry by its `file` field, file name, DOI or title. */
    pdfFolder: z.string().min(1).optional(),
  }),
]);
export type ImportSource = z.infer<typeof ImportSource>;

export const ImportOptions = z.object({
  /** What a Zotero collection becomes: a project, a tag (`Parent/Child`) or nothing. */
  collections: z.enum(["projects", "tags", "none"]).default("tags"),
  /** What happens to an entry that is already in the library. */
  onDuplicate: z.enum(["skip", "merge"]).default("skip"),
  /** Copy attachment files (PDF, EPUB, HTML snapshots) into the items. */
  attachments: z.boolean().default(true),
  /** Import notes as Markdown notes. */
  notes: z.boolean().default(true),
  /** Turn PDF annotations into cards. Needs `attachments`. */
  annotations: z.boolean().default(true),
  /** Keep the tags that Zotero translators added automatically. */
  automaticTags: z.boolean().default(true),
  /** Base directory of Zotero's linked attachments (`attachments:` paths). */
  linkedFilesBase: z.string().min(1).optional(),
  /** Put every imported item into this project. */
  project: ProjectSlug.optional(),
  /** Add these tags to every imported item. */
  tags: z.array(z.string().min(1)).default([]),
});
export type ImportOptions = z.infer<typeof ImportOptions>;

const Action = z.enum(["create", "merge", "skip"]);
export const DuplicateReason = z.enum(["zotero-key", "doi", "isbn", "arxiv", "title-year-author"]);

export const ImportProblem = z.object({
  code: z.string(),
  severity: z.enum(["info", "warning", "error"]),
  message: z.string(),
  /** Zotero key, or the entry key or position in the file. */
  ref: z.string().optional(),
});
export type ImportProblem = z.infer<typeof ImportProblem>;

export const ImportReport = z.object({
  /** Where the data comes from, for display. */
  source: z.string(),
  /** Provenance tag the items carry, such as `zotero@2026-10-24`. */
  provenance: z.string(),
  counts: z.object({
    items: z.number().int(),
    create: z.number().int(),
    merge: z.number().int(),
    skip: z.number().int(),
    /** Files that would be copied into items. */
    attachments: z.number().int(),
    /** Attachments whose file is not there or has an unsupported type. */
    attachmentsMissing: z.number().int(),
    notes: z.number().int(),
    /** Cards that would be created from annotations. */
    annotations: z.number().int(),
    annotationsSkipped: z.number().int(),
    collections: z.number().int(),
    tags: z.number().int(),
    /** Projects that do not exist yet. */
    projects: z.number().int(),
  }),
  items: z.array(
    z.object({
      ref: z.string(),
      title: z.string(),
      citekey: z.string(),
      action: Action,
      duplicateOf: z.string().optional(),
      reason: DuplicateReason.optional(),
    }),
  ),
  /** True when `items` and `problems` hold only the first entries. The counts are always complete. */
  truncated: z.boolean(),
  problems: z.array(ImportProblem),
  problemCount: z.number().int(),
});
export type ImportReport = z.infer<typeof ImportReport>;

/** Result of a finished import job (`jobs.get`). */
export const ImportResult = z.object({
  provenance: z.string(),
  created: z.array(z.string()),
  merged: z.array(z.string()),
  skipped: z.number().int(),
  attachments: z.number().int(),
  notes: z.number().int(),
  cards: z.number().int(),
  projects: z.array(z.string()),
  problems: z.array(ImportProblem),
  problemCount: z.number().int(),
});
export type ImportResult = z.infer<typeof ImportResult>;

const ImportInput = ImportOptions.extend({ source: ImportSource });

export const importPreview = defineContract({
  name: "import.preview",
  summary:
    "Dry run of an import from Zotero, BibTeX, RIS or CSL-JSON: counts, duplicates and problems, nothing is written",
  access: "read",
  input: ImportInput,
  output: ImportReport,
});
export const importRun = defineContract({
  name: "import.run",
  summary:
    "Import items, collections, tags, notes, files and annotations as a background job; cards come from PDF annotations",
  access: "admin",
  input: ImportInput,
  output: z.object({ job: JobId }),
});

export const IMPORT_CONTRACTS: readonly OperationContract[] = [importPreview, importRun];
