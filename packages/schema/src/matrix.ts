import { z } from "zod";
import { Actor, CardId, Citekey, Language, ProjectSlug, SourceHash, Stamp } from "./common.js";
import { BlockId } from "./document.js";

// Literature matrix: a table of items (rows) against questions (columns) whose cells carry a
// short answer and the passages it rests on. Lives as projects/<slug>/matrices/<id>.yaml.

const ulid = "[0-9A-HJKMNP-TV-Z]{10,26}";

export const MatrixId = z
  .string()
  .regex(new RegExp(`^m_${ulid}$`), "matrix id must look like m_<ULID>");
export type MatrixId = z.infer<typeof MatrixId>;

export const MatrixColumnId = z
  .string()
  .regex(new RegExp(`^mc_${ulid}$`), "column id must look like mc_<ULID>");
export type MatrixColumnId = z.infer<typeof MatrixColumnId>;

export const CellStatus = z.enum(["empty", "filling", "filled", "edited", "failed"]);
export type CellStatus = z.infer<typeof CellStatus>;

/**
 * A passage a cell answer rests on. `quote` is the verbatim text of the document or card. `page` is
 * the printed page label read from the document, never written by a model.
 */
export const CellEvidence = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("card"),
    card: CardId,
    quote: z.string().min(1),
    page: z.string().nullable().default(null),
  }),
  z.object({
    type: z.literal("block"),
    block: BlockId,
    source: SourceHash,
    quote: z.string().min(1),
    page: z.string().nullable().default(null),
  }),
]);
export type CellEvidence = z.infer<typeof CellEvidence>;

/** Who wrote the cell text: a model (with its stamp) or a human. */
export const CellProvenance = z.object({
  source: z.enum(["model", "human"]),
  by: Actor,
  at: z.iso.datetime(),
  /** Backend and model, such as "claude-code:sonnet". Set for model cells that ran a task. */
  model: z.string().optional(),
  language: Language.optional(),
  promptVersion: z.number().int().positive().optional(),
});
export type CellProvenance = z.infer<typeof CellProvenance>;

export const MatrixCell = z.object({
  status: CellStatus.default("empty"),
  answer: z.string().default(""),
  evidence: z.array(CellEvidence).default([]),
  provenance: CellProvenance.optional(),
  /** Why the last fill failed. Set when the status is "failed". */
  error: z.string().optional(),
});
export type MatrixCell = z.infer<typeof MatrixCell>;

export const MatrixColumn = z.object({
  id: MatrixColumnId,
  /** Short heading such as "Methode". */
  name: z.string().min(1),
  /** What to extract from each source, for the model, such as "Wie wurde untersucht? Design, Daten, Auswertung." */
  instruction: z.string().default(""),
});
export type MatrixColumn = z.infer<typeof MatrixColumn>;

/** Content of projects/<project>/matrices/<id>.yaml. Empty cells are not stored. */
export const Matrix = z.object({
  id: MatrixId,
  project: ProjectSlug,
  title: z.string().min(1),
  created: Stamp,
  columns: z.array(MatrixColumn).default([]),
  /** Citekeys of the items, in display order. */
  rows: z.array(Citekey).default([]),
  /** Cells by citekey, then by column id. */
  cells: z.record(Citekey, z.record(MatrixColumnId, MatrixCell)).default({}),
});
export type Matrix = z.infer<typeof Matrix>;
