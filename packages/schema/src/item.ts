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
export type ItemStatus = z.infer<typeof ItemStatus>;

/** A calendar date without time, such as "2026-10-26". */
export const ReadDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** The local calendar date of `at` as YYYY-MM-DD. */
export function localDateOf(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/**
 * The frontmatter keys that change when an item's status becomes `next` (a value of `undefined`
 * removes the key). Becoming `read` stores `today` as `read_at`, also when the item was read
 * before: finishing a second reading moves the date. Going back to `unread` removes `read_at`.
 * Going from `read` to `reading` keeps it, as the date the item was last finished. The same
 * status again changes nothing.
 */
export function statusPatch(
  current: { status: ItemStatus; read_at?: string | undefined },
  next: ItemStatus,
  today: string,
): Record<string, unknown> {
  if (current.status === next) return {};
  if (next === "read") return { status: next, read_at: today };
  if (next === "unread") return { status: next, read_at: undefined };
  return { status: next };
}

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

/** Why an item is incomplete: the error code and message of the step that failed. */
export const ItemIncomplete = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  at: z.string(),
  /** The ingest or convert job that failed. */
  job: z.string().optional(),
});
export type ItemIncomplete = z.infer<typeof ItemIncomplete>;

/** One step of the full text lookup for a DOI. */
export const FulltextAttempt = z.object({
  source: z.string().min(1),
  outcome: z.enum(["ok", "none", "failed"]),
  url: z.string().optional(),
  detail: z.string().optional(),
});
export type FulltextAttempt = z.infer<typeof FulltextAttempt>;

/**
 * Result of the full text lookup after adding an item by DOI: which sources were tried and when.
 * `found` means a file was fetched, `missing` that no open source delivered one.
 */
export const ItemFulltext = z.object({
  status: z.enum(["found", "missing"]),
  tried: z.array(FulltextAttempt).default([]),
  checked_at: z.string(),
});
export type ItemFulltext = z.infer<typeof ItemFulltext>;

/** Older files: `status: "none"` and `at` instead of `status: "missing"` and `checked_at`. */
const LegacyFulltext = z.object({
  status: z.enum(["none", "found", "missing"]),
  tried: z.array(FulltextAttempt).default([]),
  at: z.string().optional(),
  checked_at: z.string().optional(),
});

/** A candidate work from title matching that did not reach the confidence needed to adopt it. */
export const ProposalCandidate = z.object({
  title: z.string().nullable().optional(),
  DOI: z.string().nullable().optional(),
  similarity: z.number().optional(),
});

/**
 * Metadata that is a guess and needs a person's review: read from the first page of a PDF
 * (`metadata.fromFirstPage` or the header heuristic), a file name or a web page. Cleared when a
 * metadata source confirms the work.
 */
export const ItemProposal = z.object({
  status: z.string().default("needs-review"),
  source: z.string().optional(),
  reason: z.string().optional(),
  candidates: z.array(ProposalCandidate).optional(),
});
export type ItemProposal = z.infer<typeof ItemProposal>;

/**
 * Rewrites item frontmatter keys that older versions stored as untyped extra keys into the typed
 * shape. Returns only the keys that changed, with their new value, so that a caller can write
 * them back. Keys that are already current or cannot be read are not part of the result.
 */
export function legacyItemPatch(data: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (data.fulltext !== undefined && !ItemFulltext.safeParse(data.fulltext).success) {
    const old = LegacyFulltext.safeParse(data.fulltext);
    if (old.success) {
      patch.fulltext = {
        status: old.data.status === "found" ? "found" : "missing",
        tried: old.data.tried,
        checked_at: old.data.checked_at ?? old.data.at ?? "",
      } satisfies ItemFulltext;
    }
  }
  return patch;
}

/** `data` with its legacy keys in the current shape. Used on every read of an item file. */
export function migrateItemData(data: Record<string, unknown>): Record<string, unknown> {
  const patch = legacyItemPatch(data);
  return Object.keys(patch).length > 0 ? { ...data, ...patch } : data;
}

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
    /**
     * Local date (YYYY-MM-DD) on which the item was marked as read. Set when the status becomes
     * `read`, removed when it goes back to `unread`, kept while it is `reading` again.
     */
    read_at: ReadDate.optional(),
    /** Language for AI texts on this item, overrides the project setting. */
    ai_language: Language.optional(),
    /**
     * Content added by agents lands in the inbox first and carries this marker until a human
     * accepts it. Agents can skip the inbox explicitly (MCP add_item with target "library").
     */
    inbox: z
      .object({ by: Actor, why: z.string().optional(), job: z.string().optional() })
      .optional(),
    /**
     * Set when ingest did not finish: the source could not be fetched or converted. The item stays
     * so that the user or an agent can retry, attach a file or trash it. It is cleared when a
     * conversion succeeds.
     */
    incomplete: ItemIncomplete.optional(),
    /** Outcome of the full text lookup for an item added by DOI. Absent when no lookup ran. */
    fulltext: ItemFulltext.optional(),
    /** Set while the metadata is a guess that a person has to review. */
    proposal: ItemProposal.optional(),
    sources: z.array(Source).default([]),
    provenance: Provenance.default({}),
    created: Stamp,
    modified: Stamp.optional(),
  })
  .catchall(z.unknown());
export type ItemFrontmatter = z.infer<typeof ItemFrontmatter>;
