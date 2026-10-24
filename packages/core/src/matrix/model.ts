import type { MatrixOp } from "@citegeist/ops";
import {
  type Actor,
  type CellEvidence,
  CitegeistError,
  Matrix,
  type MatrixCell,
  type MatrixColumn,
} from "@citegeist/schema";
import { parse, stringify } from "yaml";
import { ulid } from "../ids.js";

export const newMatrixId = (): string => `m_${ulid()}`;
export const newColumnId = (): string => `mc_${ulid()}`;

export function matrixError(
  code: string,
  message: string,
  fix: string,
  context: Record<string, unknown> = {},
  recovery: "fix-and-retry" | "do-first" | "ask-human" = "fix-and-retry",
): CitegeistError {
  return new CitegeistError({ code, message, fix, recovery, context });
}

/** Reads a matrix file. */
export function parseMatrix(text: string, path = "matrix.yaml"): Matrix {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (err) {
    throw matrixError(
      "MATRIX_INVALID",
      `${path} is not valid YAML: ${(err as Error).message}`,
      "Fix the YAML syntax of the matrix file.",
      { path },
    );
  }
  const r = Matrix.safeParse(raw ?? {});
  if (!r.success) {
    throw matrixError(
      "MATRIX_INVALID",
      `${path} is invalid: ${r.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
      "Fix the fields named in the message.",
      { path },
    );
  }
  return r.data;
}

const isBlank = (c: MatrixCell): boolean =>
  c.status === "empty" && c.answer === "" && c.evidence.length === 0;

/** Writes the file. Empty cells are left out, so a new matrix is a short list of rows and columns. */
export function serializeMatrix(m: Matrix): string {
  const cells: Record<string, Record<string, MatrixCell>> = {};
  for (const row of m.rows) {
    const byColumn: Record<string, MatrixCell> = {};
    for (const col of m.columns) {
      const cell = m.cells[row]?.[col.id];
      if (cell && !isBlank(cell)) byColumn[col.id] = cell;
    }
    if (Object.keys(byColumn).length > 0) cells[row] = byColumn;
  }
  return stringify(
    {
      id: m.id,
      project: m.project,
      title: m.title,
      created: m.created,
      columns: m.columns,
      rows: m.rows,
      cells,
    },
    { lineWidth: 0 },
  );
}

export const emptyCell = (): MatrixCell => ({ status: "empty", answer: "", evidence: [] });

/** The cell at a position; an unfilled position reads as an empty cell. */
export function cellOf(m: Matrix, item: string, column: string): MatrixCell {
  return m.cells[item]?.[column] ?? emptyCell();
}

export function setCell(m: Matrix, item: string, column: string, cell: MatrixCell): void {
  const row = m.cells[item] ?? {};
  row[column] = cell;
  m.cells[item] = row;
}

/** Finds a column by id or by name (without regard to case). */
export function findColumn(m: Matrix, ref: string): MatrixColumn {
  const wanted = ref.trim().toLowerCase();
  const col =
    m.columns.find((c) => c.id === ref) ?? m.columns.find((c) => c.name.toLowerCase() === wanted);
  if (!col) {
    throw matrixError(
      "MATRIX_COLUMN_NOT_FOUND",
      `matrix '${m.id}' has no column '${ref}'`,
      m.columns.length > 0
        ? `Use a column id or one of the names: ${m.columns.map((c) => c.name).join(", ")}.`
        : "Add a column with matrix.update first.",
      { matrix: m.id, column: ref },
    );
  }
  return col;
}

export function requireRow(m: Matrix, item: string): void {
  if (!m.rows.includes(item)) {
    throw matrixError(
      "MATRIX_ROW_NOT_FOUND",
      `matrix '${m.id}' has no row for '${item}'`,
      "Add the item with an addRow operation first.",
      { matrix: m.id, item },
      "do-first",
    );
  }
}

/** What the operations need from the library. */
export interface OpEnv {
  actor: Actor;
  now: Date;
  /** Throws when the item does not exist. */
  requireItem(citekey: string): void;
  /** The evidence a card gives, or throws when the card does not exist. */
  cardEvidence(id: string): CellEvidence;
}

function insertAt<T>(list: T[], value: T, position: number | undefined): void {
  const at = position === undefined ? list.length : Math.min(position - 1, list.length);
  list.splice(at, 0, value);
}

function moveTo<T>(list: T[], value: T, position: number): void {
  const from = list.indexOf(value);
  list.splice(from, 1);
  list.splice(Math.min(position - 1, list.length), 0, value);
}

function checkName(m: Matrix, name: string, except?: string): void {
  const clash = m.columns.find(
    (c) => c.id !== except && c.name.toLowerCase() === name.trim().toLowerCase(),
  );
  if (clash) {
    throw matrixError(
      "MATRIX_COLUMN_EXISTS",
      `matrix '${m.id}' already has a column named '${clash.name}'`,
      "Pick another name or edit the existing column with updateColumn.",
      { matrix: m.id, column: clash.id },
    );
  }
}

/** Applies the operations in order to a copy of the matrix. All succeed or none does. */
export function applyMatrixOps(
  matrix: Matrix,
  ops: readonly MatrixOp[],
  env: OpEnv,
  newId: () => string = newColumnId,
): Matrix {
  const m = structuredClone(matrix);
  for (const op of ops) {
    switch (op.op) {
      case "rename":
        m.title = op.title.trim();
        break;
      case "addRow":
        if (m.rows.includes(op.item)) {
          throw matrixError(
            "MATRIX_ROW_EXISTS",
            `matrix '${m.id}' already has a row for '${op.item}'`,
            "Each item appears once. Use moveRow to change its place.",
            { matrix: m.id, item: op.item },
          );
        }
        env.requireItem(op.item);
        insertAt(m.rows, op.item, op.position);
        break;
      case "removeRow":
        requireRow(m, op.item);
        m.rows = m.rows.filter((r) => r !== op.item);
        delete m.cells[op.item];
        break;
      case "moveRow":
        requireRow(m, op.item);
        moveTo(m.rows, op.item, op.position);
        break;
      case "addColumn": {
        checkName(m, op.name);
        const col: MatrixColumn = {
          id: newId(),
          name: op.name.trim(),
          instruction: op.instruction.trim(),
        };
        insertAt(m.columns, col, op.position);
        break;
      }
      case "updateColumn": {
        const col = findColumn(m, op.column);
        if (op.name !== undefined) {
          checkName(m, op.name, col.id);
          col.name = op.name.trim();
        }
        if (op.instruction !== undefined) col.instruction = op.instruction.trim();
        break;
      }
      case "removeColumn": {
        const col = findColumn(m, op.column);
        m.columns = m.columns.filter((c) => c.id !== col.id);
        for (const row of Object.values(m.cells)) delete row[col.id];
        break;
      }
      case "moveColumn": {
        const col = findColumn(m, op.column);
        moveTo(m.columns, col, op.position);
        break;
      }
      case "setCell": {
        requireRow(m, op.item);
        const col = findColumn(m, op.column);
        const prev = cellOf(m, op.item, col.id);
        const answer = op.answer.trim();
        setCell(m, op.item, col.id, {
          status: answer === "" && prev.evidence.length === 0 ? "empty" : "edited",
          answer,
          evidence: op.evidence ? op.evidence.map((id) => env.cardEvidence(id)) : prev.evidence,
          ...(answer === "" ? {} : { provenance: handProvenance(env) }),
        });
        break;
      }
      case "clearCell": {
        requireRow(m, op.item);
        const col = findColumn(m, op.column);
        setCell(m, op.item, col.id, emptyCell());
        break;
      }
    }
  }
  return m;
}

/** A hand-written cell is human work. An agent that calls setCell is not the fill task, so it counts as a model. */
function handProvenance(env: OpEnv): NonNullable<MatrixCell["provenance"]> {
  return {
    source: env.actor === "human" ? "human" : "model",
    by: env.actor,
    at: env.now.toISOString(),
  };
}
