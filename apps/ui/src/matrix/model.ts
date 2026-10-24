import type { CellStatus, Matrix, MatrixCell } from "@citegeist/schema";

export const EMPTY_CELL: MatrixCell = { status: "empty", answer: "", evidence: [] };

/** The cell of a row and a column; empty cells are not stored, so a missing one is an empty cell. */
export function cellOf(matrix: Matrix, citekey: string, column: string): MatrixCell {
  return matrix.cells[citekey]?.[column] ?? EMPTY_CELL;
}

export type CellCounts = Record<CellStatus, number> & { total: number };

/** Cells by status, empty ones included. */
export function countCells(matrix: Matrix): CellCounts {
  const counts: CellCounts = {
    empty: 0,
    filling: 0,
    filled: 0,
    edited: 0,
    failed: 0,
    total: matrix.rows.length * matrix.columns.length,
  };
  for (const row of matrix.rows) {
    for (const column of matrix.columns) counts[cellOf(matrix, row, column.id).status] += 1;
  }
  return counts;
}

/** True while the model works on a cell, so the screen keeps asking for the matrix. */
export function isFilling(matrix: Matrix | undefined): boolean {
  if (!matrix) return false;
  return Object.values(matrix.cells).some((row) =>
    Object.values(row).some((cell) => cell.status === "filling"),
  );
}

/** "Luhmann 1984" for a row head; the citekey when the item is not known. */
export function rowLabel(
  item: { authors?: string | undefined; year?: string | undefined } | undefined,
): string {
  return [item?.authors?.split(",")[0], item?.year].filter(Boolean).join(" ");
}
