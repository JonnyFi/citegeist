import {
  matrixCreate,
  matrixExport,
  matrixFill,
  matrixFillCell,
  matrixGet,
  matrixList,
  matrixUpdate,
  type Registry,
} from "@citegeist/ops";
import type { CellEvidence, Matrix, MatrixCell, MatrixColumn } from "@citegeist/schema";
import type { CoreEvent } from "../lib/core";
import type { MockData } from "../mock/fixtures";

type MockJobs = Map<
  string,
  {
    id: string;
    status: "running" | "succeeded" | "failed";
    createdAt: string;
    updatedAt: string;
    progress?: number;
  }
>;

const STORES = new WeakMap<MockData, Map<string, Matrix[]>>();

function storeOf(data: MockData): Map<string, Matrix[]> {
  let store = STORES.get(data);
  if (!store) {
    store = new Map();
    STORES.set(data, store);
  }
  return store;
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function randomId(prefix: string): string {
  let out = "";
  for (let i = 0; i < 16; i++) out += CROCKFORD[Math.floor(Math.random() * CROCKFORD.length)];
  return `${prefix}${out}`;
}

const pathOf = (m: Matrix) => `projects/${m.project}/matrices/${m.id}.yaml`;

function firstSentence(text: string): string {
  const m = /^.*?[.!?](\s|$)/.exec(text.trim());
  return (m ? m[0] : text).trim();
}

/**
 * What the mock model writes for a cell: the first sentence of a card or a passage of the
 * document, with that passage as evidence. An item without cards and without a converted
 * document fails, the way the real core fails when it has nothing to cite.
 */
function generate(
  data: MockData,
  citekey: string,
  column: MatrixColumn,
  columnIndex: number,
): MatrixCell {
  const at = new Date().toISOString();
  const provenance = {
    source: "model" as const,
    by: "agent:claude-code",
    at,
    model: "claude-code:sonnet",
    language: data.lang,
    promptVersion: 1,
  };
  const doc = data.docs.get(citekey);
  const cards = data.cards.filter((c) => c.frontmatter.item === citekey);
  const body = doc?.blocks.filter((b) => b.type === "paragraph") ?? [];
  const useBlock = body.length > 0 && (cards.length === 0 || columnIndex % 2 === 1);

  if (useBlock && doc) {
    const block = body[columnIndex % body.length];
    if (block) {
      const evidence: CellEvidence = {
        type: "block",
        block: block.id,
        source: doc.source,
        quote: block.text,
        page: block.spans[0]?.label ?? null,
      };
      return {
        status: "filled",
        answer: firstSentence(block.text),
        evidence: [evidence],
        provenance,
      };
    }
  }
  const card = cards.length > 0 ? cards[columnIndex % cards.length] : undefined;
  if (card) {
    const evidence: CellEvidence = {
      type: "card",
      card: card.frontmatter.id,
      quote: card.body.quote,
      page: card.frontmatter.locator?.start ?? null,
    };
    return {
      status: "filled",
      answer: firstSentence(card.body.paraphrase ?? card.body.quote),
      evidence: [evidence],
      provenance,
    };
  }
  const fm = data.items.get(citekey)?.frontmatter;
  const source = fm?.sources[0]?.hash;
  if (fm?.abstract && source) {
    const sentences = fm.abstract.split(/(?<=[.!?])\s+/);
    // the abstract stands in for a converted document in the mock
    const evidence: CellEvidence = {
      type: "block",
      block: `babs${source.slice(0, 6)}`,
      source,
      quote: fm.abstract,
      page: null,
    };
    return {
      status: "filled",
      answer: sentences[columnIndex % sentences.length] ?? firstSentence(fm.abstract),
      evidence: [evidence],
      provenance,
    };
  }
  return {
    status: "failed",
    answer: "",
    evidence: [],
    error: `NO_SOURCE_TEXT: '${citekey}' has no converted text to answer '${column.name}'`,
  };
}

function labelOf(data: MockData, citekey: string): string {
  const fm = data.items.get(citekey)?.frontmatter;
  const first = fm?.author?.[0];
  const family = first ? ("family" in first ? first.family : first.literal) : citekey;
  const year = fm?.issued !== undefined ? ` ${String(fm.issued).slice(0, 4)}` : "";
  return `${family}${year}`;
}

function citationOf(data: MockData, citekey: string, cell: MatrixCell): string {
  const page = cell.evidence.find((e) => e.page)?.page;
  return `${labelOf(data, citekey)}${page ? `, ${data.lang === "en" ? "p." : "S."} ${page}` : ""}`;
}

const mdCell = (text: string) => text.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
const csvCell = (text: string) => `"${text.replace(/"/g, '""')}"`;

export function exportMatrix(data: MockData, m: Matrix, format: "markdown" | "csv"): string {
  const rows = m.rows.map((citekey) => {
    const cells = m.columns.map((c) => {
      const cell = m.cells[citekey]?.[c.id];
      if (!cell?.answer) return "";
      return `${cell.answer} (${citationOf(data, citekey, cell)})`;
    });
    return { head: labelOf(data, citekey), cells };
  });
  const sourceHead = data.lang === "en" ? "Source" : "Quelle";
  if (format === "csv") {
    const lines = [
      [sourceHead, ...m.columns.map((c) => c.name)],
      ...rows.map((r) => [r.head, ...r.cells]),
    ];
    return `${lines.map((l) => l.map(csvCell).join(",")).join("\n")}\n`;
  }
  const head = `| ${sourceHead} | ${m.columns.map((c) => mdCell(c.name)).join(" | ")} |`;
  const rule = `| --- | ${m.columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${mdCell(r.head)} | ${r.cells.map(mdCell).join(" | ")} |`);
  return `${[head, rule, ...body].join("\n")}\n`;
}

/**
 * The matrix operations of the core against fixture data. Filling is done by a fixed rule instead
 * of a model, one cell at a time, so that the screens can show cells that are being written.
 */
export function bindMatrixMock(
  registry: Registry,
  data: MockData,
  emit: (event: CoreEvent) => void,
  jobs: MockJobs,
  delayMs: number,
): Registry {
  const store = storeOf(data);
  const step = Math.max(5, Math.round(delayMs / 5));

  const matricesOf = (project: string): Matrix[] => {
    if (!data.projects.has(project)) {
      throw new Error(`PROJECT_NOT_FOUND: no project with slug '${project}'`);
    }
    let list = store.get(project);
    if (!list) {
      list = [];
      store.set(project, list);
    }
    return list;
  };
  const find = (project: string, id: string): Matrix => {
    const found = matricesOf(project).find((m) => m.id === id);
    if (!found) throw new Error(`MATRIX_NOT_FOUND: project '${project}' has no matrix '${id}'`);
    return found;
  };
  const columnOf = (m: Matrix, ref: string): MatrixColumn => {
    const found =
      m.columns.find((c) => c.id === ref) ??
      m.columns.find((c) => c.name.toLowerCase() === ref.toLowerCase());
    if (!found) throw new Error(`COLUMN_NOT_FOUND: matrix '${m.id}' has no column '${ref}'`);
    return found;
  };
  const requireRow = (m: Matrix, citekey: string) => {
    if (!m.rows.includes(citekey)) {
      throw new Error(`ROW_NOT_FOUND: matrix '${m.id}' has no row '${citekey}'`);
    }
  };
  const changed = (m: Matrix) => emit({ type: "change", path: pathOf(m), external: false });
  const setCell = (m: Matrix, citekey: string, column: string, cell: MatrixCell | undefined) => {
    const row = { ...(m.cells[citekey] ?? {}) };
    if (cell && cell.status !== "empty") row[column] = cell;
    else delete row[column];
    if (Object.keys(row).length > 0) m.cells[citekey] = row;
    else delete m.cells[citekey];
  };
  const statusOf = (m: Matrix, citekey: string, column: string) =>
    m.cells[citekey]?.[column]?.status ?? "empty";

  /** Writes the cells one after the other and reports the progress through the job. */
  const run = (
    m: Matrix,
    targets: Array<{ citekey: string; column: MatrixColumn }>,
    jobId: string,
  ) => {
    for (const t of targets) {
      setCell(m, t.citekey, t.column.id, { status: "filling", answer: "", evidence: [] });
    }
    changed(m);
    targets.forEach((t, i) => {
      setTimeout(
        () => {
          const index = m.columns.findIndex((c) => c.id === t.column.id);
          // a cell that was removed or written by hand in the meantime stays as it is
          if (statusOf(m, t.citekey, t.column.id) === "filling") {
            setCell(m, t.citekey, t.column.id, generate(data, t.citekey, t.column, index));
          }
          const job = jobs.get(jobId);
          if (job) {
            const done = i + 1 === targets.length;
            job.progress = done ? 1 : (i + 1) / targets.length;
            job.updatedAt = new Date().toISOString();
            if (done) job.status = "succeeded";
          }
          changed(m);
        },
        step * (i + 1),
      );
    });
  };
  const startJob = (): string => {
    const id = randomId("j_");
    const now = new Date().toISOString();
    jobs.set(id, { id, status: "running", createdAt: now, updatedAt: now, progress: 0 });
    return id;
  };

  registry
    .bind(matrixCreate, async (_ctx, input) => {
      const list = matricesOf(input.project);
      const columns = input.columns.map((c) => ({
        id: randomId("mc_"),
        name: c.name,
        instruction: c.instruction,
      }));
      for (const key of input.items) {
        if (!data.items.has(key)) throw new Error(`ITEM_NOT_FOUND: no item with citekey '${key}'`);
      }
      const matrix: Matrix = {
        id: randomId("m_"),
        project: input.project,
        title: input.title,
        created: { at: new Date().toISOString(), by: "human" },
        columns,
        rows: [...new Set(input.items)],
        cells: {},
      };
      list.push(matrix);
      changed(matrix);
      return { matrix, path: pathOf(matrix) };
    })
    .bind(matrixList, async (_ctx, input) => ({
      matrices: matricesOf(input.project).map((m) => {
        const counts = { empty: 0, filling: 0, filled: 0, edited: 0, failed: 0 };
        for (const row of m.rows) {
          for (const c of m.columns) counts[statusOf(m, row, c.id)] += 1;
        }
        return {
          id: m.id,
          project: m.project,
          title: m.title,
          path: pathOf(m),
          rows: m.rows.length,
          columns: m.columns.length,
          cells: counts,
        };
      }),
    }))
    .bind(matrixGet, async (_ctx, input) => {
      const matrix = find(input.project, input.matrix);
      return { matrix: structuredClone(matrix), path: pathOf(matrix) };
    })
    .bind(matrixUpdate, async (_ctx, input) => {
      const m = find(input.project, input.matrix);
      for (const op of input.ops) {
        switch (op.op) {
          case "rename":
            m.title = op.title;
            break;
          case "setCell": {
            requireRow(m, op.item);
            const column = columnOf(m, op.column);
            const old = m.cells[op.item]?.[column.id];
            setCell(m, op.item, column.id, {
              status: "edited",
              answer: op.answer,
              evidence: op.evidence
                ? op.evidence.flatMap((id): CellEvidence[] => {
                    const card = data.cards.find((c) => c.frontmatter.id === id);
                    return card
                      ? [
                          {
                            type: "card",
                            card: id,
                            quote: card.body.quote,
                            page: card.frontmatter.locator?.start ?? null,
                          },
                        ]
                      : [];
                  })
                : (old?.evidence ?? []),
              provenance: { source: "human", by: "human", at: new Date().toISOString() },
            });
            break;
          }
          case "clearCell":
            requireRow(m, op.item);
            setCell(m, op.item, columnOf(m, op.column).id, undefined);
            break;
          case "addRow":
            if (!data.items.has(op.item)) {
              throw new Error(`ITEM_NOT_FOUND: no item with citekey '${op.item}'`);
            }
            if (!m.rows.includes(op.item)) {
              m.rows.splice(op.position ? op.position - 1 : m.rows.length, 0, op.item);
            }
            break;
          case "removeRow":
            requireRow(m, op.item);
            m.rows = m.rows.filter((k) => k !== op.item);
            delete m.cells[op.item];
            break;
          case "moveRow": {
            requireRow(m, op.item);
            m.rows = m.rows.filter((k) => k !== op.item);
            m.rows.splice(op.position - 1, 0, op.item);
            break;
          }
          case "addColumn":
            m.columns.splice(op.position ? op.position - 1 : m.columns.length, 0, {
              id: randomId("mc_"),
              name: op.name,
              instruction: op.instruction,
            });
            break;
          case "updateColumn": {
            const column = columnOf(m, op.column);
            if (op.name !== undefined) column.name = op.name;
            if (op.instruction !== undefined) column.instruction = op.instruction;
            break;
          }
          case "removeColumn": {
            const column = columnOf(m, op.column);
            m.columns = m.columns.filter((c) => c.id !== column.id);
            for (const key of Object.keys(m.cells)) setCell(m, key, column.id, undefined);
            break;
          }
          case "moveColumn": {
            const column = columnOf(m, op.column);
            m.columns = m.columns.filter((c) => c.id !== column.id);
            m.columns.splice(op.position - 1, 0, column);
            break;
          }
        }
      }
      changed(m);
      return { matrix: structuredClone(m), path: pathOf(m) };
    })
    .bind(matrixFillCell, async (_ctx, input) => {
      const m = find(input.project, input.matrix);
      requireRow(m, input.item);
      const column = columnOf(m, input.column);
      const status = statusOf(m, input.item, column.id);
      const job = startJob();
      if (status === "filling" || ((status === "filled" || status === "edited") && !input.force)) {
        const done = jobs.get(job);
        if (done) Object.assign(done, { status: "succeeded", progress: 1 });
        return { job };
      }
      run(m, [{ citekey: input.item, column }], job);
      return { job };
    })
    .bind(matrixFill, async (_ctx, input) => {
      const m = find(input.project, input.matrix);
      const targets = m.rows.flatMap((citekey) =>
        m.columns
          .filter((column) => {
            const status = statusOf(m, citekey, column.id);
            return (
              status === "empty" || status === "failed" || (input.force && status === "filled")
            );
          })
          .map((column) => ({ citekey, column })),
      );
      const job = startJob();
      if (targets.length === 0) {
        const done = jobs.get(job);
        if (done) Object.assign(done, { status: "succeeded", progress: 1 });
      } else {
        run(m, targets, job);
      }
      return { job, cells: targets.length };
    })
    .bind(matrixExport, async (_ctx, input) => {
      const m = find(input.project, input.matrix);
      return { text: exportMatrix(data, m, input.format), format: input.format };
    });
  return registry;
}
