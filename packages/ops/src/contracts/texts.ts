import { JobId, ProjectSlug, Sha256, TextSlug } from "@citegeist/schema";
import { z } from "zod";
import { defineContract, type OperationContract } from "../registry.js";

// Texts (D20, docs/spec/library-format.md): Markdown files with Pandoc citations under
// projects/<project>/texts/, exported through Pandoc. No MCP tools: the cap of 20 is used up, so
// agents reach texts through `cg texts ...` and the files.

const TextRef = z.object({ project: ProjectSlug, text: TextSlug });

export const TextExportFormat = z.enum(["docx", "latex", "pdf", "md"]);
export type TextExportFormat = z.infer<typeof TextExportFormat>;

/** What identifies a text in a list. */
export const TextSummary = z.object({
  text: TextSlug,
  title: z.string(),
  /** Library-relative path of the file. */
  path: z.string(),
  /** Style and language written in the frontmatter, if any. */
  style: z.string().optional(),
  lang: z.string().optional(),
  words: z.number().int().nonnegative(),
  /** Distinct citation keys. */
  citations: z.number().int().nonnegative(),
  updated: z.iso.datetime(),
});
export type TextSummary = z.infer<typeof TextSummary>;

export const textsList = defineContract({
  name: "texts.list",
  summary: "List the texts of a project (Markdown files under projects/<project>/texts/)",
  access: "read",
  input: z.object({ project: ProjectSlug }),
  output: z.object({ texts: z.array(TextSummary) }),
});

export const textsGet = defineContract({
  name: "texts.get",
  summary:
    "Read a text: title, style and language, the Markdown body (Pandoc citations such as [@citekey, S. 12]) and the sha256 of the file. Pass the hash as baseHash when you write the text back. cited lists the citekeys the body uses, unknown those that are not in the library.",
  access: "read",
  input: TextRef,
  output: z.object({
    text: TextSlug,
    path: z.string(),
    title: z.string(),
    /** As written in the frontmatter; see resolved for what an export uses. */
    style: z.string().optional(),
    lang: z.string().optional(),
    resolved: z.object({ style: z.string(), lang: z.string() }),
    body: z.string(),
    hash: Sha256,
    cited: z.array(z.string()),
    unknown: z.array(z.string()),
  }),
});

export const textsCreate = defineContract({
  name: "texts.create",
  summary:
    "Create a text in a project. The file name comes from the slug, by default from the title. Write citations in Pandoc syntax: [@citekey, S. 12].",
  access: "write",
  input: z.object({
    project: ProjectSlug,
    title: z.string().min(1),
    slug: TextSlug.optional(),
    style: z.string().optional().describe("CSL style id; the project's style applies without it"),
    lang: z
      .string()
      .optional()
      .describe("BCP 47 language such as de-DE; the project's applies without it"),
    body: z.string().default(""),
  }),
  output: z.object({ text: TextSlug, path: z.string(), hash: Sha256 }),
});

export const textsUpdate = defineContract({
  name: "texts.update",
  summary:
    "Replace the body of a text and optionally its title, style or language. Pass baseHash from the last texts.get to detect changes made in between. Editing the file directly works as well.",
  access: "write",
  input: TextRef.extend({
    body: z.string().optional(),
    title: z.string().min(1).optional(),
    style: z.string().optional().describe("CSL style id; an empty string removes it"),
    lang: z.string().optional().describe("BCP 47 language; an empty string removes it"),
    baseHash: Sha256.optional().describe(
      "sha256 of the file you read; the call fails when the file changed since",
    ),
  }),
  output: z.object({
    path: z.string(),
    hash: Sha256,
    cited: z.array(z.string()),
    unknown: z.array(z.string()),
  }),
});

export const textsExport = defineContract({
  name: "texts.export",
  summary:
    "Export a text through Pandoc: docx (Word), latex (ZIP with main.tex and references.bib), pdf (needs a LaTeX engine or Typst) or md (citations resolved). The bibliography holds the cited sources only, in the style of the text, else of the project. Files go to projects/<project>/exports/ unless a person passes output.",
  access: "write",
  input: TextRef.extend({
    format: TextExportFormat,
    style: z.string().optional().describe("CSL style id; overrides the text and the project"),
    lang: z.string().optional().describe("BCP 47 language; overrides the text and the project"),
    output: z
      .string()
      .optional()
      .describe("target file; only a person may choose a place outside the library"),
  }),
  output: z.object({
    /** Library-relative path, or the absolute path when `output` pointed outside the library. */
    path: z.string(),
    absolutePath: z.string(),
    format: TextExportFormat,
    bytes: z.number().int().nonnegative(),
    style: z.string(),
    lang: z.string(),
    cited: z.array(z.string()),
    /** Cited keys that are not in the library; they appear unresolved in the export. */
    unknown: z.array(z.string()),
    /** Pandoc's warnings, at most ten. */
    warnings: z.array(z.string()),
    pandoc: z.string(),
    /** The PDF engine that ran, for format pdf. */
    engine: z.string().optional(),
  }),
});

export const pandocStatus = defineContract({
  name: "pandoc.status",
  summary:
    "Where Pandoc is (PATH, Homebrew or the copy citegeist downloaded), its version, and which PDF engine is available",
  access: "read",
  input: z.object({}),
  output: z.object({
    found: z.boolean(),
    path: z.string().optional(),
    version: z.string().optional(),
    source: z.enum(["path", "managed"]).optional(),
    /** The release `pandoc.setup` downloads. */
    pinned: z.string(),
    /** False off macOS on Apple silicon, where a person installs Pandoc themselves. */
    installable: z.boolean(),
    pdfEngine: z.string().optional(),
  }),
});

export const pandocSetup = defineContract({
  name: "pandoc.setup",
  summary:
    "Download the pinned Pandoc release (official GitHub release, fixed sha256) into the machine-local folder. A person runs it; Pandoc stays a separate process.",
  access: "admin",
  input: z.object({}),
  output: z.object({ job: JobId }),
});

export const TEXTS_CONTRACTS: readonly OperationContract[] = [
  textsList,
  textsGet,
  textsCreate,
  textsUpdate,
  textsExport,
  pandocStatus,
  pandocSetup,
];
