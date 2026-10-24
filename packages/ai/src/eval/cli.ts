/**
 * Manual eval runner, not part of CI. It spends real model calls on the chosen backend.
 *
 *   pnpm --filter @citegeist/ai eval -- --task card.paraphrase --backend claude --max-calls 5
 *
 * Backends: claude, codex, cursor, or an OpenAI-compatible preset (openai, anthropic, openrouter,
 * xai, ollama) with the API key in the environment variable CITEGEIST_API_KEY.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { ClaudeCodeCliBackend } from "../backends/claude-cli.js";
import { CodexExecBackend } from "../backends/codex-exec.js";
import { CursorCliBackend } from "../backends/cursor-cli.js";
import { OPENAI_COMPAT_PRESETS, OpenAiCompatBackend } from "../backends/openai-http.js";
import { nodeRunner, type ProcessRunner } from "../runner.js";
import { TASK_NAMES, type TaskName } from "../tasks/registry.js";
import type { InferenceBackend } from "../types.js";
import { runEval } from "./run.js";

const { values } = parseArgs({
  options: {
    task: { type: "string", default: "card.paraphrase" },
    backend: { type: "string", default: "claude" },
    "max-calls": { type: "string", default: "5" },
    record: { type: "string" },
    "pinned-version": { type: "string" },
    json: { type: "boolean", default: false },
  },
  allowPositionals: true,
});

const maxCalls = Number(values["max-calls"]);
const task = values.task as TaskName;
if (!TASK_NAMES.includes(task)) {
  console.error(`Unknown task ${task}. Known: ${TASK_NAMES.join(", ")}`);
  process.exit(2);
}

/** Counts model calls (not the version and login probes) and refuses to start more than the budget. */
function budgetRunner(
  inner: ProcessRunner,
  isModelCall: (args: string[]) => boolean,
): ProcessRunner {
  let used = 0;
  let n = 0;
  return async (spec) => {
    if (isModelCall(spec.args)) {
      if (used >= maxCalls) {
        return { stdout: "", stderr: "eval call budget exhausted", exitCode: 1, timedOut: false };
      }
      used++;
      const res = await inner(spec);
      if (values.record) {
        mkdirSync(values.record, { recursive: true });
        n++;
        writeFileSync(
          join(values.record, `${task}-${n}.json`),
          JSON.stringify(
            { args: spec.args, exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr },
            null,
            2,
          ),
        );
      }
      return res;
    }
    return inner(spec);
  };
}

function makeBackend(id: string): InferenceBackend {
  if (id === "claude") {
    return new ClaudeCodeCliBackend({
      runner: budgetRunner(nodeRunner, (a) => a.includes("-p")),
      ...(values["pinned-version"] ? { pinnedVersion: values["pinned-version"] } : {}),
    });
  }
  if (id === "codex") {
    return new CodexExecBackend({
      runner: budgetRunner(nodeRunner, (a) => a[0] === "exec"),
    });
  }
  if (id === "cursor") {
    return new CursorCliBackend({
      runner: budgetRunner(nodeRunner, (a) => a.includes("-p")),
    });
  }
  if (id in OPENAI_COMPAT_PRESETS) {
    const preset = OPENAI_COMPAT_PRESETS[id as keyof typeof OPENAI_COMPAT_PRESETS];
    const apiKey = process.env.CITEGEIST_API_KEY;
    return new OpenAiCompatBackend({ id, ...preset, ...(apiKey ? { apiKey } : {}) });
  }
  console.error(`Unknown backend ${id}.`);
  process.exit(2);
}

const backend = makeBackend(values.backend as string);
const summary = await runEval(backend, task, {
  limit: maxCalls,
  onRow: (r) => {
    if (!values.json) {
      console.error(
        `${r.ok ? "PASS" : "FAIL"} ${r.fixture} ${(r.ms / 1000).toFixed(1)}s ${r.failures.join(" | ")}`,
      );
    }
  },
});

if (values.json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(
    `${summary.task} v${summary.promptVersion} on ${summary.backend}/${summary.model}: ` +
      `${summary.passed}/${summary.n} passed (${Math.round(summary.passRate * 100)}%), ` +
      `p50 ${(summary.p50Ms / 1000).toFixed(1)}s, p95 ${(summary.p95Ms / 1000).toFixed(1)}s`,
  );
}
process.exit(summary.passed === summary.n ? 0 : 1);
