import { CardId, Citekey, JobId, Matrix, MatrixId, ProjectSlug } from "@citegeist/schema";
import { z } from "zod";
import { defineContract, type OperationContract } from "../registry.js";

// Literature matrix. Every operation takes the project and the matrix id. A column is named
// by its id (mc_...) or by its name. None of these is an MCP tool: the tool budget is full and a
// matrix is edited in the app.

const MatrixRef = z.object({ project: ProjectSlug, matrix: MatrixId });
const ColumnRef = z
  .string()
  .min(1)
  .describe("column id (mc_...) or the column name, matched without regard to case");

const ColumnDraft = z.object({
  name: z.string().min(1),
  instruction: z.string().default(""),
});

export const MatrixSummary = z.object({
  id: MatrixId,
  project: ProjectSlug,
  title: z.string(),
  path: z.string(),
  rows: z.number().int().nonnegative(),
  columns: z.number().int().nonnegative(),
  /** Cells by status; empty cells are counted too. */
  cells: z.object({
    empty: z.number().int().nonnegative(),
    filling: z.number().int().nonnegative(),
    filled: z.number().int().nonnegative(),
    edited: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
});
export type MatrixSummary = z.infer<typeof MatrixSummary>;

export const matrixCreate = defineContract({
  name: "matrix.create",
  summary: "Create a literature matrix in a project, with optional columns and items as rows",
  access: "write",
  input: z.object({
    project: ProjectSlug,
    title: z.string().min(1),
    columns: z.array(ColumnDraft).default([]),
    items: z.array(Citekey).default([]).describe("citekeys of the items to compare, one per row"),
  }),
  output: z.object({ matrix: Matrix, path: z.string() }),
});

export const matrixList = defineContract({
  name: "matrix.list",
  summary: "List the literature matrices of a project with cell counts by status",
  access: "read",
  input: z.object({ project: ProjectSlug }),
  output: z.object({ matrices: z.array(MatrixSummary) }),
});

export const matrixGet = defineContract({
  name: "matrix.get",
  summary: "Read a literature matrix: columns, rows and every cell with answer and evidence",
  access: "read",
  input: MatrixRef,
  output: z.object({ matrix: Matrix, path: z.string() }),
});

const MatrixOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("rename"), title: z.string().min(1) }),
  z.object({
    op: z.literal("setCell"),
    item: Citekey,
    column: ColumnRef,
    answer: z.string(),
    evidence: z
      .array(CardId)
      .optional()
      .describe("card ids that replace the evidence of the cell; omit to keep it"),
  }),
  z.object({ op: z.literal("clearCell"), item: Citekey, column: ColumnRef }),
  z.object({
    op: z.literal("addRow"),
    item: Citekey,
    position: z.number().int().positive().optional().describe("1-based, default: last"),
  }),
  z.object({ op: z.literal("removeRow"), item: Citekey }),
  z.object({ op: z.literal("moveRow"), item: Citekey, position: z.number().int().positive() }),
  z.object({
    op: z.literal("addColumn"),
    name: z.string().min(1),
    instruction: z.string().default(""),
    position: z.number().int().positive().optional().describe("1-based, default: last"),
  }),
  z.object({
    op: z.literal("updateColumn"),
    column: ColumnRef,
    name: z.string().min(1).optional(),
    instruction: z.string().optional(),
  }),
  z.object({ op: z.literal("removeColumn"), column: ColumnRef }),
  z.object({
    op: z.literal("moveColumn"),
    column: ColumnRef,
    position: z.number().int().positive(),
  }),
]);
export type MatrixOp = z.infer<typeof MatrixOp>;

export const matrixUpdate = defineContract({
  name: "matrix.update",
  summary:
    "Edit a matrix in one step: set or clear cells by hand, add, remove and reorder rows and columns",
  access: "write",
  input: MatrixRef.extend({ ops: z.array(MatrixOp).min(1) }),
  output: z.object({ matrix: Matrix, path: z.string() }),
});

export const matrixFillCell = defineContract({
  name: "matrix.fillCell",
  summary:
    "Fill one cell with the model from passages of the item; the answer must cite the document",
  access: "write",
  input: MatrixRef.extend({
    item: Citekey,
    column: ColumnRef,
    force: z
      .boolean()
      .default(false)
      .describe("also replace a filled or hand-edited cell; default: only open cells"),
  }),
  output: z.object({ job: JobId }),
});

export const matrixFill = defineContract({
  name: "matrix.fill",
  summary: "Fill every open cell of a matrix as one job with progress",
  access: "write",
  input: MatrixRef.extend({
    force: z
      .boolean()
      .default(false)
      .describe("also replace filled cells; hand-edited cells stay either way"),
  }),
  output: z.object({ job: JobId, cells: z.number().int().nonnegative() }),
});

export const matrixExport = defineContract({
  name: "matrix.export",
  summary: "Export a matrix as a Markdown table or CSV with citations in the project's CSL style",
  access: "read",
  input: MatrixRef.extend({
    format: z.enum(["markdown", "csv"]).default("markdown"),
    style: z.string().optional(),
    locale: z.string().optional(),
  }),
  output: z.object({ text: z.string(), format: z.enum(["markdown", "csv"]) }),
});

export const MATRIX_CONTRACTS: readonly OperationContract[] = [
  matrixCreate,
  matrixList,
  matrixGet,
  matrixUpdate,
  matrixFillCell,
  matrixFill,
  matrixExport,
];
