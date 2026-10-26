import { z } from "zod";
import { CardId, Citekey, ModelStamp, ProjectSlug, Sha256, SourceHash, Stamp } from "./common.js";
import { BlockId } from "./document.js";

/**
 * What a card says (docs/decisions/0010-quote-cards.md). Every card holds a quote, so "quote" is not a kind. The AI pre-classifies
 * the kind in the paraphrase call and the reader can change it; a card without a kind is valid.
 */
export const CardKind = z.enum([
  "thesis",
  "finding",
  "method",
  "definition",
  "example",
  "critique",
]);
export type CardKind = z.infer<typeof CardKind>;

/**
 * The `kind` field of a card file. Old libraries may contain the retired kinds "quote" and
 * "comment"; they read as no kind, and so does any other value that is not a kind, because
 * the kind is a hint for the reader and a typo in it must not hide the card. A `catch` instead of
 * a transform keeps the schema representable as JSON Schema for MCP and the CLI.
 */
export const CardKindField = CardKind.optional().catch(undefined);

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
  kind: CardKindField,
  locator: Locator.optional(),
  anchor: z.object({ pdf: PdfAnchor.optional(), text: TextAnchor.optional() }),
  /** SHA-256 of the verbatim quote; a mismatch with the body means the quote was altered. */
  quote_sha256: Sha256,
  /** Secondary source for "zit. n." citations. */
  via: Citekey.optional(),
  paraphrase: ModelStamp.optional(),
  /** Legacy: the core statement is gone. A stored stamp is kept on rewrite and shown nowhere. */
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
 *
 * One free field "Note" replaces "In my words" and "Comment". The parser still reads the two
 * old headings ({@link LEGACY_NOTE_SECTIONS}) and merges them into `note`; the writer only emits
 * "Note". "Core statement" is a legacy section. It is preserved as it is but shown nowhere.
 */
export const CARD_SECTIONS = {
  paraphrase: "Paraphrase",
  core: "Core statement",
  note: "Note",
} as const;

/** Headings of the retired sections whose text moves into the note when a card is read. */
export const LEGACY_NOTE_SECTIONS = ["In my words", "Comment"] as const;

export const CardBody = z.object({
  quote: z.string().min(1),
  /** The one AI text of a card: one to three sentences in the resolved language. */
  paraphrase: z.string().optional(),
  /** Legacy: never written for new cards, kept so that old files survive a rewrite. */
  core: z.string().optional(),
  /** The reader's own text. Old "In my words" and "Comment" sections end up here. */
  note: z.string().optional(),
  extra: z.array(z.object({ heading: z.string(), text: z.string() })).default([]),
});
export type CardBody = z.infer<typeof CardBody>;
