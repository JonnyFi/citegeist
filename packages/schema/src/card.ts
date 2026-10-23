import { z } from "zod";
import { CardId, Citekey, ModelStamp, ProjectSlug, Sha256, SourceHash, Stamp } from "./common.js";
import { BlockId } from "./document.js";

export const CardKind = z.enum(["quote", "finding", "method", "definition", "critique", "comment"]);

/** CSL locator: label is a CSL locator term ("page", "chapter", "section", "paragraph", ...). */
export const Locator = z.object({
  label: z.string().default("page"),
  start: z.string().min(1),
  end: z.string().optional(),
  confirmed: z.boolean().default(false),
});
export type Locator = z.infer<typeof Locator>;

/** PDF anchor in Zotero-compatible form: zero-based page index and quads in PDF user space. */
export const PdfAnchor = z.object({
  page: z.number().int().nonnegative(),
  quads: z.array(z.tuple([z.number(), z.number(), z.number(), z.number()])).min(1),
  file: SourceHash,
});

/** W3C TextQuote anchor plus a block hint and an optional TextPosition fallback. */
export const TextAnchor = z.object({
  block: BlockId.optional(),
  exact: z.string().min(1),
  prefix: z.string().default(""),
  suffix: z.string().default(""),
  start: z.number().int().nonnegative().optional(),
  end: z.number().int().nonnegative().optional(),
  /** Text normalisation the offsets refer to (see packages/anchoring). */
  norm: z.string().default("norm-v1"),
});

/** Frontmatter of items/<citekey>/cards/<id>.md */
export const CardFrontmatter = z.object({
  id: CardId,
  item: Citekey,
  source: SourceHash.optional(),
  kind: CardKind.default("quote"),
  locator: Locator.optional(),
  anchor: z.object({ pdf: PdfAnchor.optional(), text: TextAnchor.optional() }),
  /** SHA-256 of the verbatim quote; a mismatch with the body means the quote was altered. */
  quote_sha256: Sha256,
  /** Secondary source for "zit. n." citations. */
  via: Citekey.optional(),
  paraphrase: ModelStamp.optional(),
  core: ModelStamp.optional(),
  tags: z.array(z.string()).default([]),
  projects: z.array(ProjectSlug).default([]),
  color: z.string().optional(),
  created: Stamp,
  modified: Stamp.optional(),
});
export type CardFrontmatter = z.infer<typeof CardFrontmatter>;

/**
 * Card body sections. The body starts with a blockquote holding the verbatim quote, followed by
 * these level-2 headings in this order. Unknown sections are preserved by the parser.
 */
export const CARD_SECTIONS = {
  paraphrase: "Paraphrase",
  core: "Core statement",
  ownWords: "In my words",
  comment: "Comment",
} as const;

export const CardBody = z.object({
  quote: z.string().min(1),
  paraphrase: z.string().optional(),
  core: z.string().optional(),
  ownWords: z.string().optional(),
  comment: z.string().optional(),
  extra: z.array(z.object({ heading: z.string(), text: z.string() })).default([]),
});
export type CardBody = z.infer<typeof CardBody>;
