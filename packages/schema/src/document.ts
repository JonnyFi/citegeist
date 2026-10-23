import { z } from "zod";
import { SourceHash } from "./common.js";

/** Bounding box in PDF user space points of the original file: [x0, y0, x1, y1], origin bottom-left. */
export const BBox = z.tuple([z.number(), z.number(), z.number(), z.number()]);

export const PageInfo = z.object({
  index: z.number().int().nonnegative(),
  label: z.string().nullable(),
  labelSource: z.enum(["pdf-pagelabels", "header-footer", "crossref-offset", "user", "none"]),
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
  textSource: z.enum(["born-digital", "ocr", "html"]),
  quality: z.number().min(0).max(1).optional(),
});
export const Pages = z.object({
  source: SourceHash,
  pages: z.array(PageInfo),
  /** Set once the user confirmed or corrected the label mapping for this PDF. */
  confirmed: z.boolean().default(false),
});
export type Pages = z.infer<typeof Pages>;

/** Part of a block that lies on one page. `start`/`end` are char offsets into the block text. */
export const Span = z.object({
  page: z.number().int().nonnegative(),
  label: z.string().nullable(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  bbox: BBox.optional(),
});

export const BlockId = z.string().regex(/^b[0-9a-z]{6,12}$/);
export const BlockType = z.enum([
  "title",
  "heading",
  "paragraph",
  "list-item",
  "table",
  "figure",
  "caption",
  "equation",
  "footnote",
  "reference",
  "code",
  "quote",
  "page-furniture",
]);

/** One line of derived/<hash>/blocks.jsonl, the canonical document model. */
export const Block = z.object({
  id: BlockId,
  type: BlockType,
  sec: z.string().optional(),
  flow: z.enum(["body", "furniture", "notes"]).default("body"),
  text: z.string(),
  html: z.string().optional(),
  latex: z.string().optional(),
  spans: z.array(Span),
  refs: z.array(z.string()).optional(),
  src: z.object({ engine: z.string(), native: z.string().optional() }),
  conf: z.number().min(0).max(1).optional(),
});
export type Block = z.infer<typeof Block>;

/** derived/<hash>/manifest.json */
export const DerivedManifest = z.object({
  source: SourceHash,
  path: z.enum(["arxiv", "digital", "scan", "web"]),
  tools: z.record(z.string(), z.string()),
  createdAt: z.iso.datetime(),
  durationMs: z.number().nonnegative(),
  flags: z.array(z.string()).default([]),
});
export type DerivedManifest = z.infer<typeof DerivedManifest>;

/** derived/<hash>/idmap.json: old block id to new id, or null for a deleted block. */
export const IdMap = z.record(BlockId, BlockId.nullable());
