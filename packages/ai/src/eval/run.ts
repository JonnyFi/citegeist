import { CitegeistError } from "@citegeist/schema";
import { getTask, runTask, type TaskName } from "../tasks/registry.js";
import type { TaskDefinition } from "../tasks/types.js";
import type { InferenceBackend } from "../types.js";

export interface EvalRow {
  fixture: string;
  ok: boolean;
  /** Check failures, or the error code when the call itself failed. */
  failures: string[];
  ms: number;
  output?: unknown;
}

export interface EvalSummary {
  task: string;
  promptVersion: number;
  backend: string;
  model: string;
  n: number;
  passed: number;
  passRate: number;
  p50Ms: number;
  p95Ms: number;
  rows: EvalRow[];
}

/** Linear interpolation between closest ranks. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return (s[lo] as number) + ((s[hi] as number) - (s[lo] as number)) * (i - lo);
}

/** Runs the fixtures of a task on a backend. `limit` caps the number of fixtures, and so the model calls. */
export async function runEval(
  backend: InferenceBackend,
  taskName: TaskName,
  opts: { limit?: number; onRow?: (row: EvalRow) => void } = {},
): Promise<EvalSummary> {
  const task = getTask(taskName) as TaskDefinition<unknown, unknown>;
  const fixtures = task.fixtures.slice(0, opts.limit ?? task.fixtures.length);
  const rows: EvalRow[] = [];
  for (const f of fixtures) {
    let row: EvalRow;
    const t0 = performance.now();
    try {
      const res = await runTask(backend, taskName, f.input, { language: f.language });
      const failures = f.check(res.output, f.input);
      row = { fixture: f.id, ok: failures.length === 0, failures, ms: res.ms, output: res.output };
    } catch (e) {
      const code = e instanceof CitegeistError ? e.detail.code : "ERROR";
      const msg = e instanceof Error ? e.message : String(e);
      row = {
        fixture: f.id,
        ok: false,
        failures: [code === "ERROR" ? msg : `${code}: ${msg}`],
        ms: Math.round(performance.now() - t0),
      };
    }
    rows.push(row);
    opts.onRow?.(row);
  }
  const times = rows.map((r) => r.ms);
  const passed = rows.filter((r) => r.ok).length;
  return {
    task: taskName,
    promptVersion: task.promptVersion,
    backend: backend.id,
    model: backend.resolveModel(task.modelClass),
    n: rows.length,
    passed,
    passRate: rows.length ? passed / rows.length : 0,
    p50Ms: Math.round(percentile(times, 0.5)),
    p95Ms: Math.round(percentile(times, 0.95)),
    rows,
  };
}
