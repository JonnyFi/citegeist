import { z } from "zod";
import {
  Actor,
  Citekey,
  ItemId,
  Language,
  ProjectSlug,
  Provenance,
  SourceHash,
  Stamp,
} from "./common.js";

/** CSL 1.0.2 item types. The Zotero schema maps its 37 types onto these; the original Zotero type is kept in `zotero_type`. */
export const CslType = z.enum([
  "article",
  "article-journal",
  "article-magazine",
  "article-newspaper",
  "bill",
  "book",
  "broadcast",
  "chapter",
  "classic",
  "collection",
  "dataset",
  "document",
  "entry",
  "entry-dictionary",
  "entry-encyclopedia",
  "event",
  "figure",
  "graphic",
  "hearing",
  "interview",
  "legal_case",
  "legislation",
  "manuscript",
  "map",
  "motion_picture",
  "musical_score",
  "pamphlet",
  "paper-conference",
  "patent",
  "performance",
  "periodical",
  "personal_communication",
  "post",
  "post-weblog",
  "regulation",
  "report",
  "review",
  "review-book",
  "software",
  "song",
  "speech",
  "standard",
  "thesis",
  "treaty",
  "webpage",
]);

export const Creator = z.union([
  z.object({
    family: z.string().min(1),
    given: z.string().optional(),
    "non-dropping-particle": z.string().optional(),
    "dropping-particle": z.string().optional(),
    suffix: z.string().optional(),
    orcid: z.string().optional(),
  }),
  z.object({ literal: z.string().min(1) }),
]);
export type Creator = z.infer<typeof Creator>;

/** Dates as EDTF-style strings ("1984", "2021-03", "2021-03-04") or a bare year. */
export const DateValue = z.union([
  z.number().int(),
  z.string().regex(/^-?\d{1,4}(-\d{2}(-\d{2})?)?$/),
]);

export const ItemStatus = z.enum(["unread", "reading", "read"]);

/** A file attached to an item, stored as sources/<hash>.<ext>. */
export const Source = z.object({
  hash: SourceHash,
  kind: z.enum(["pdf", "html", "epub", "arxiv-html", "web"]),
  filename: z.string().min(1),
  role: z.enum(["main", "supplement", "version"]).default("main"),
  pages: z.number().int().positive().optional(),
  url: z.url().optional(),
  added: Stamp,
});
export type Source = z.infer<typeof Source>;

/**
 * Frontmatter of items/<citekey>/<citekey>.md. Known CSL variables are typed; any other CSL
 * variable is allowed and validated later against the Zotero schema data.
 */
export const ItemFrontmatter = z
  .object({
    id: ItemId,
    citekey: Citekey,
    type: CslType,
    zotero_type: z.string().optional(),
    title: z.string().min(1),
    subtitle: z.string().optional(),
    author: z.array(Creator).optional(),
    editor: z.array(Creator).optional(),
    issued: DateValue.optional(),
    "container-title": z.string().optional(),
    volume: z.string().optional(),
    issue: z.string().optional(),
    page: z.string().optional(),
    publisher: z.string().optional(),
    "publisher-place": z.string().optional(),
    DOI: z.string().optional(),
    ISBN: z.string().optional(),
    ISSN: z.string().optional(),
    URL: z.string().optional(),
    abstract: z.string().optional(),
    language: Language.optional(),
    ids: z.record(z.string(), z.string()).default({}),
    tags: z.array(z.string()).default([]),
    projects: z.array(ProjectSlug).default([]),
    status: ItemStatus.default("unread"),
    /** D9: language for AI texts on this item, overrides the project setting. */
    ai_language: Language.optional(),
    /**
     * D7: content added by agents lands in the inbox first and carries this marker until a human
     * accepts it. Agents can skip the inbox explicitly (MCP add_item with target "library").
     */
    inbox: z
      .object({ by: Actor, why: z.string().optional(), job: z.string().optional() })
      .optional(),
    sources: z.array(Source).default([]),
    provenance: Provenance.default({}),
    created: Stamp,
    modified: Stamp.optional(),
  })
  .catchall(z.unknown());
export type ItemFrontmatter = z.infer<typeof ItemFrontmatter>;
