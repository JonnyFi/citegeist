import { existsSync, readdirSync, readFileSync } from "node:fs";
import {
  type AiRouter,
  MatrixFillCellInput,
  noInfoText,
  resolveLanguage,
  sanitizeCell,
} from "@citegeist/ai";
import type { MatrixOp, MatrixSummary } from "@citegeist/ops";
import {
  type Actor,
  type CellEvidence,
  CitegeistError,
  type Matrix,
  type MatrixCell,
  type MatrixColumn,
} from "@citegeist/schema";
import type { Library } from "../library.js";
import type { SemanticRank } from "../planning/service.js";
import type { SearchHit, SearchInput } from "../search.js";
import { exportMatrix } from "./export.js";
import {
  DetachedMatrixJobs,
  type MatrixJobContext,
  type MatrixJobQueue,
  type MatrixJobSpec,
} from "./jobs.js";
import {
  applyMatrixOps,
  cellOf,
  findColumn,
  matrixError,
  newMatrixId,
  parseMatrix,
  requireRow,
  serializeMatrix,
  setCell,
} from "./model.js";
import { type Passage, pageOfRange, retrievePassages } from "./passages.js";

export interface MatrixDeps {
  /** Routes `matrix.fillCell` to the configured backend. */
  ai: Pick<AiRouter, "run">;
  /** Core job queue with progress. Without one, fills run detached in this process. */
  jobs?: MatrixJobQueue | undefined;
  /** Hybrid search of the runtime (the same one `search.query` uses). */
  search?: ((input: SearchInput) => Promise<SearchHit[]>) | undefined;
  /** Semantic ranking of texts against a query; absent while no embedding model is ready. */
  rank?: SemanticRank | undefined;
  now?: () => Date;
  /** Passages handed to the model per cell. Default 6. */
  passageLimit?: number;
}

export interface FillSummary {
  filled: number;
  /** Cells the document gave no answer for, stored as "keine Angabe im Text". */
  noInfo: number;
  failed: number;
}

interface Target {
  item: string;
  column: string;
}

const key = (matrix: string, t: Target): string => `${matrix}|${t.item}|${t.column}`;

/** Literature matrices: rows are items, columns are questions, cells are answers with evidence. */
export class MatrixService {
  readonly jobs: MatrixJobQueue;
  /** Set when no queue was injected: lets callers and tests wait for detached fills. */
  readonly detached: DetachedMatrixJobs | undefined;
  private readonly now: () => Date;
  /** Cells this process is filling right now. A "filling" cell outside this set is a leftover. */
  private readonly running = new Set<string>();

  constructor(
    private readonly lib: Library,
    private readonly deps: MatrixDeps,
  ) {
    this.now = deps.now ?? (() => new Date());
    if (deps.jobs) {
      this.jobs = deps.jobs;
      this.detached = undefined;
    } else {
      this.detached = new DetachedMatrixJobs();
      this.jobs = this.detached;
    }
  }

  // Files ----------------------------------------------------------------------------------------

  private dir = (project: string): string => `projects/${project}/matrices`;
  private rel = (project: string, id: string): string => `${this.dir(project)}/${id}.yaml`;

  private read(project: string, id: string): Matrix {
    this.lib.getProject(project);
    const abs = this.lib.paths.abs(this.rel(project, id));
    if (!/^m_/.test(id) || !existsSync(abs)) {
      throw matrixError(
        "MATRIX_NOT_FOUND",
        `project '${project}' has no matrix '${id}'`,
        "Call matrix.list to see the matrices of the project, or matrix.create to make one.",
        { project, matrix: id },
      );
    }
    return parseMatrix(readFileSync(abs, "utf8"), this.rel(project, id));
  }

  private write(m: Matrix): Matrix {
    this.lib.writeFile(this.rel(m.project, m.id), serializeMatrix(m));
    return m;
  }

  /** Reads, changes and writes in one synchronous step, so concurrent fills cannot lose each other's cells. */
  private mutate(project: string, id: string, fn: (m: Matrix) => Matrix | undefined): Matrix {
    const current = this.read(project, id);
    return this.write(fn(current) ?? current);
  }

  private env(actor: Actor) {
    return {
      actor,
      now: this.now(),
      requireItem: (citekey: string) => {
        this.lib.getItem(citekey);
      },
      cardEvidence: (id: string): CellEvidence => {
        const row = this.lib.index.get<{ citekey: string }>(
          "SELECT citekey FROM cards WHERE id = ?",
          id,
        );
        const card = row
          ? this.lib
              .listCards({ citekey: row.citekey, limit: 500 })
              .cards.find((c) => c.frontmatter.id === id)
          : undefined;
        if (!card) {
          throw matrixError(
            "CARD_NOT_FOUND",
            `no card with id '${id}'`,
            "Use card ids from cards.list.",
            { card: id },
          );
        }
        // matrix evidence cites printed pages; a paragraph locator has no page to show
        const loc =
          card.frontmatter.locator?.label === "page" ? card.frontmatter.locator : undefined;
        return {
          type: "card",
          card: id,
          quote: card.body.quote,
          page: loc
            ? loc.end && loc.end !== loc.start
              ? `${loc.start}-${loc.end}`
              : loc.start
            : null,
        };
      },
    };
  }

  // CRUD -----------------------------------------------------------------------------------------

  create(
    actor: Actor,
    input: {
      project: string;
      title: string;
      columns: Array<{ name: string; instruction: string }>;
      items: string[];
    },
  ): { matrix: Matrix; path: string } {
    this.lib.getProject(input.project);
    const empty: Matrix = {
      id: newMatrixId(),
      project: input.project,
      title: input.title.trim(),
      created: this.lib.stamp(actor),
      columns: [],
      rows: [],
      cells: {},
    };
    const ops: MatrixOp[] = [
      ...input.columns.map((c) => ({
        op: "addColumn" as const,
        name: c.name,
        instruction: c.instruction,
      })),
      ...input.items.map((item) => ({ op: "addRow" as const, item })),
    ];
    const matrix = this.write(applyMatrixOps(empty, ops, this.env(actor)));
    return { matrix, path: this.rel(matrix.project, matrix.id) };
  }

  get(project: string, id: string): { matrix: Matrix; path: string } {
    return { matrix: this.read(project, id), path: this.rel(project, id) };
  }

  list(project: string): { matrices: MatrixSummary[] } {
    this.lib.getProject(project);
    let files: string[] = [];
    try {
      files = readdirSync(this.lib.paths.abs(this.dir(project)))
        .filter((f) => /^m_.*\.yaml$/.test(f))
        .sort();
    } catch {
      return { matrices: [] };
    }
    const matrices = files.map((f) => {
      const m = this.read(project, f.replace(/\.yaml$/, ""));
      const cells = { empty: 0, filling: 0, filled: 0, edited: 0, failed: 0 };
      for (const row of m.rows) for (const col of m.columns) cells[cellOf(m, row, col.id).status]++;
      return {
        id: m.id,
        project: m.project,
        title: m.title,
        path: this.rel(project, m.id),
        rows: m.rows.length,
        columns: m.columns.length,
        cells,
      };
    });
    return { matrices };
  }

  update(
    actor: Actor,
    input: { project: string; matrix: string; ops: MatrixOp[] },
  ): { matrix: Matrix; path: string } {
    const env = this.env(actor);
    const matrix = this.mutate(input.project, input.matrix, (m) =>
      applyMatrixOps(m, input.ops, env),
    );
    return { matrix, path: this.rel(matrix.project, matrix.id) };
  }

  export(input: {
    project: string;
    matrix: string;
    format: "markdown" | "csv";
    style?: string | undefined;
    locale?: string | undefined;
  }): { text: string; format: "markdown" | "csv" } {
    const matrix = this.read(input.project, input.matrix);
    return {
      text: exportMatrix(this.lib, matrix, {
        format: input.format,
        style: input.style,
        locale: input.locale,
      }),
      format: input.format,
    };
  }

  // Filling --------------------------------------------------------------------------------------

  private language(project: string): string {
    const p = this.lib.getProject(project).frontmatter;
    return resolveLanguage({
      project: p.ai_language,
      library: this.lib.manifest.defaults.ai_language,
    });
  }

  /** Whether a fill may start on this cell. Hand-edited cells need `force`, running ones never. */
  private fillable(m: Matrix, t: Target, force: boolean, explicit: boolean): boolean {
    const cell = cellOf(m, t.item, t.column);
    if (this.running.has(key(m.id, t))) return false;
    switch (cell.status) {
      case "empty":
      case "failed":
      case "filling": // left behind by a process that stopped
        return true;
      case "filled":
        return force;
      case "edited":
        return force && explicit;
    }
  }

  /** Marks the cells as filling, so a reader of the file sees work that is queued or under way. */
  private markFilling(project: string, id: string, targets: Target[]): void {
    this.mutate(project, id, (m) => {
      for (const t of targets) {
        const prev = cellOf(m, t.item, t.column);
        const { error: _gone, ...rest } = prev;
        setCell(m, t.item, t.column, { ...rest, status: "filling" });
        this.running.add(key(m.id, t));
      }
      return m;
    });
  }

  fillCell(
    actor: Actor,
    input: { project: string; matrix: string; item: string; column: string; force: boolean },
  ): { job: string } {
    const m = this.read(input.project, input.matrix);
    requireRow(m, input.item);
    const target: Target = { item: input.item, column: findColumn(m, input.column).id };
    if (this.running.has(key(m.id, target))) {
      throw matrixError(
        "MATRIX_CELL_BUSY",
        `the cell of '${input.item}' and column '${input.column}' is being filled`,
        "Wait for the running job; poll it with jobs.get.",
        { matrix: m.id, ...target },
      );
    }
    if (!this.fillable(m, target, input.force, true)) {
      const status = cellOf(m, target.item, target.column).status;
      throw matrixError(
        "MATRIX_CELL_FILLED",
        `the cell of '${input.item}' and column '${input.column}' is already ${status}`,
        "Pass force to replace it.",
        { matrix: m.id, ...target, status },
        "ask-human",
      );
    }
    this.markFilling(m.project, m.id, [target]);
    return {
      job: this.enqueue(m, [target], {
        kind: "ai-task",
        label: `matrix.fillCell ${m.id} ${input.item}`,
        by: actor,
        input: { matrix: m.id, project: m.project, ...target },
        run: async (ctx) => {
          ctx.progress(0, input.item);
          const summary: FillSummary = { filled: 0, noInfo: 0, failed: 0 };
          await this.runTarget(actor, m.project, m.id, target, summary, ctx);
          return summary;
        },
      }),
    };
  }

  fill(
    actor: Actor,
    input: { project: string; matrix: string; force: boolean },
  ): { job: string; cells: number } {
    const m = this.read(input.project, input.matrix);
    const targets: Target[] = [];
    for (const item of m.rows) {
      for (const col of m.columns) {
        const t = { item, column: col.id };
        if (this.fillable(m, t, input.force, false)) targets.push(t);
      }
    }
    if (targets.length === 0) {
      return {
        job: this.jobs.enqueue({
          kind: "ai-task",
          label: `matrix.fill ${m.id}`,
          by: actor,
          input: { matrix: m.id, project: m.project, cells: 0 },
          run: async (ctx) => {
            ctx.progress(1, "nothing to fill");
            return { filled: 0, noInfo: 0, failed: 0 } satisfies FillSummary;
          },
        }),
        cells: 0,
      };
    }
    this.markFilling(m.project, m.id, targets);
    const job = this.enqueue(m, targets, {
      kind: "ai-task",
      label: `matrix.fill ${m.id}`,
      by: actor,
      input: { matrix: m.id, project: m.project, cells: targets.length },
      run: async (ctx) => {
        const summary: FillSummary = { filled: 0, noInfo: 0, failed: 0 };
        for (const [i, t] of targets.entries()) {
          if (ctx.signal.aborted) {
            this.release(m.project, m.id, targets.slice(i), "cancelled");
            break;
          }
          ctx.progress(i / targets.length, `${t.item} (${i + 1} of ${targets.length})`);
          await this.runTarget(actor, m.project, m.id, t, summary, ctx);
        }
        ctx.progress(
          1,
          `${summary.filled} filled, ${summary.noInfo} without answer, ${summary.failed} failed`,
        );
        return summary;
      },
    });
    return { job, cells: targets.length };
  }

  /** Enqueues a fill. When the queue refuses, the cells it marked are released again. */
  private enqueue(m: Matrix, targets: Target[], spec: MatrixJobSpec): string {
    try {
      return this.jobs.enqueue(spec);
    } catch (err) {
      this.release(m.project, m.id, targets, "the job could not be queued");
      throw err;
    }
  }

  /** Sets cells that will not be filled after all to failed, so none stays "filling". */
  private release(project: string, id: string, targets: Target[], reason: string): void {
    try {
      this.mutate(project, id, (m) => {
        for (const t of targets) {
          this.running.delete(key(m.id, t));
          if (!m.rows.includes(t.item) || !m.columns.some((c) => c.id === t.column)) continue;
          const cell = cellOf(m, t.item, t.column);
          if (cell.status === "filling")
            setCell(m, t.item, t.column, { ...cell, status: "failed", error: reason });
        }
        return m;
      });
    } catch {
      for (const t of targets) this.running.delete(key(id, t));
    }
  }

  /** Fills one cell and records the outcome. Never throws: a failed cell is a result, not a crash. */
  private async runTarget(
    actor: Actor,
    project: string,
    id: string,
    t: Target,
    summary: FillSummary,
    ctx: MatrixJobContext,
  ): Promise<void> {
    try {
      const outcome = await this.compute(actor, project, id, t, ctx.signal);
      const stored = this.store(project, id, t, outcome.cell);
      if (stored) {
        if (outcome.noInfo) summary.noInfo++;
        else summary.filled++;
      }
    } catch (err) {
      const message =
        err instanceof CitegeistError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      this.release(project, id, [t], ctx.signal.aborted ? "cancelled" : message);
      summary.failed++;
    } finally {
      this.running.delete(key(id, t));
    }
  }

  /** Retrieves passages, asks the model and checks its quotes. Reads the matrix, writes nothing. */
  private async compute(
    actor: Actor,
    project: string,
    id: string,
    t: Target,
    signal: AbortSignal,
  ): Promise<{ cell: MatrixCell; noInfo: boolean }> {
    const m = this.read(project, id);
    const column: MatrixColumn = findColumn(m, t.column);
    const language = this.language(project);
    const at = this.now().toISOString();
    const noInfo = (
      model?: string,
      promptVersion?: number,
    ): { cell: MatrixCell; noInfo: boolean } => ({
      noInfo: true,
      cell: {
        status: "filled",
        answer: noInfoText(language),
        evidence: [],
        provenance: {
          source: "model",
          by: actor,
          at,
          language,
          ...(model ? { model } : {}),
          ...(promptVersion ? { promptVersion } : {}),
        },
      },
    });

    const query = [column.name, column.instruction].filter(Boolean).join(". ");
    const passages = await retrievePassages(
      this.lib,
      t.item,
      query,
      { search: this.deps.search, rank: this.deps.rank },
      this.deps.passageLimit ? { limit: this.deps.passageLimit } : {},
    );
    if (signal.aborted) throw new Error("cancelled");
    if (passages.length === 0) return noInfo();

    const input = MatrixFillCellInput.parse({
      item: this.itemInfo(t.item),
      column: { name: column.name, instruction: column.instruction },
      passages: passages.map((p) => ({ ref: p.ref, kind: p.kind, page: p.page, text: p.text })),
    });
    const res = await this.deps.ai.run("matrix.fillCell", input, { language });
    const clean = sanitizeCell(res.output, input);
    if (!clean.found) return noInfo(res.stamp.by, res.promptVersion);

    const byRef = new Map(passages.map((p) => [p.ref, p]));
    const evidence = clean.evidence.map((e): CellEvidence => {
      const p = byRef.get(e.ref) as Passage;
      const page = pageOfRange(p, e.start, e.end);
      return p.kind === "card"
        ? { type: "card", card: p.ref, quote: e.quote, page }
        : { type: "block", block: p.ref, source: p.source as string, quote: e.quote, page };
    });
    return {
      noInfo: false,
      cell: {
        status: "filled",
        answer: clean.answer,
        evidence,
        provenance: {
          source: "model",
          by: actor,
          at,
          model: res.stamp.by,
          language,
          promptVersion: res.promptVersion,
        },
      },
    };
  }

  /** Writes a computed cell unless the user changed the cell while the model worked. */
  private store(project: string, id: string, t: Target, cell: MatrixCell): boolean {
    let stored = false;
    this.mutate(project, id, (m) => {
      if (!m.rows.includes(t.item) || !m.columns.some((c) => c.id === t.column)) return m;
      if (cellOf(m, t.item, t.column).status !== "filling") return m;
      setCell(m, t.item, t.column, cell);
      stored = true;
      return m;
    });
    return stored;
  }

  private itemInfo(citekey: string) {
    const row = this.lib.index.get<{ title: string; year: string | null; authors: string | null }>(
      "SELECT title, year, authors FROM items WHERE citekey = ?",
      citekey,
    );
    return {
      citekey,
      title: row?.title ?? citekey,
      ...(row?.authors ? { authors: row.authors } : {}),
      ...(row?.year ? { year: String(row.year) } : {}),
    };
  }
}
