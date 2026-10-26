import type { z } from "zod";
import { aiErrors } from "../errors.js";
import type { AiUsage, InferenceBackend, ModelChoice } from "../types.js";
import { cardParaphrase } from "./card-paraphrase/index.js";
import { cardVerify } from "./card-verify/index.js";
import { conceptDescribe } from "./concept-describe/index.js";
import { conceptName } from "./concept-name/index.js";
import { litsearchSuggestQueries } from "./litsearch-suggest-queries/index.js";
import { matrixFillCell } from "./matrix-fill-cell/index.js";
import { metadataFromFirstPage } from "./metadata-from-first-page/index.js";
import { noteProposeLinks } from "./note-propose-links/index.js";
import type { TaskDefinition } from "./types.js";

export const TASKS = {
  "card.paraphrase": cardParaphrase,
  "card.verify": cardVerify,
  "concept.describe": conceptDescribe,
  "concept.name": conceptName,
  "litsearch.suggestQueries": litsearchSuggestQueries,
  "matrix.fillCell": matrixFillCell,
  "metadata.fromFirstPage": metadataFromFirstPage,
  "note.proposeLinks": noteProposeLinks,
} as const;

export type TaskName = keyof typeof TASKS;
export type TaskInput<N extends TaskName> = z.infer<(typeof TASKS)[N]["input"]>;
export type TaskOutput<N extends TaskName> = z.infer<(typeof TASKS)[N]["output"]>;

export const TASK_NAMES = Object.keys(TASKS) as TaskName[];

export function getTask(name: string): TaskDefinition<unknown, unknown> {
  const task = (TASKS as Record<string, unknown>)[name];
  if (!task) throw aiErrors.unknownTask(name, TASK_NAMES);
  return task as TaskDefinition<unknown, unknown>;
}

export interface RunTaskOptions {
  /** BCP 47 tag, resolved by `resolveLanguage`. Defaults to English. */
  language?: string;
  /** Overrides the task's model class. */
  model?: ModelChoice;
  /** Aborting stops the backend call (CLI process group killed, HTTP request aborted). */
  signal?: AbortSignal | undefined;
  /** Who asked for the run. Only carried into the usage record. */
  actor?: string | undefined;
  /**
   * Called once when the run ends, whether it worked or not, with what it consumed. Not called
   * when the input is invalid, because nothing was sent.
   */
  record?: ((record: UsageRecord) => void) | undefined;
  /**
   * Called by the router before it moves a task to another backend, either because the one it
   * tried failed with a limit, overload or login problem, or because that backend is paused.
   */
  onFallback?: ((info: FallbackInfo) => void) | undefined;
}

/** The router moves a task from one backend to the next. */
export interface FallbackInfo {
  task: string;
  /** The backend that failed or is paused. */
  from: string;
  /** The backend that takes over. */
  to: string;
  /** Why `from` is out: `limit`, `overloaded` or `auth`. */
  kind: "limit" | "overloaded" | "auth";
  /** When `from` is expected to work again, if it said so. */
  resetAt?: Date | undefined;
}

/** One finished AI call, for the usage ledger. */
export interface UsageRecord extends AiUsage {
  task: string;
  backend: string;
  /** Concrete model name. */
  model: string;
  ms: number;
  ok: boolean;
  /** Error code of a failed call. */
  error?: string | undefined;
  /** The `actor` option of the run. */
  actor?: string | undefined;
}

export interface TaskResult<O> {
  output: O;
  /** Matches `ModelStamp` in the schema package: who wrote the text. */
  stamp: { by: string; at: string; language: string };
  promptVersion: number;
  /** Wall time of the backend call in milliseconds. */
  ms: number;
  /** Tokens and list price of the call, when the backend reports them. */
  usage?: AiUsage;
  /** Set when the router ran the task on another backend than the one the routing names. */
  via?: { from: string; kind: FallbackInfo["kind"] };
}

/** Validates the input, builds the versioned prompt and runs it on the backend. */
export async function runTask<N extends TaskName>(
  backend: InferenceBackend,
  name: N,
  input: unknown,
  opts: RunTaskOptions = {},
): Promise<TaskResult<TaskOutput<N>>> {
  const task = getTask(name);
  const language = opts.language ?? "en";
  const parsed = task.input.safeParse(input);
  if (!parsed.success) {
    throw aiErrors.inputInvalid(
      name,
      parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
    );
  }
  const model = opts.model ?? task.modelClass;
  const t0 = performance.now();
  const total: AiUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  let reported = false;
  let reportedModel: string | undefined;
  const finish = (ok: boolean, error?: string): number => {
    const ms = Math.round(performance.now() - t0);
    opts.record?.({
      ...total,
      task: name,
      backend: backend.id,
      model: reportedModel ?? backend.resolveModel(model),
      ms,
      ok,
      error,
      actor: opts.actor,
    });
    return ms;
  };
  let output: unknown;
  try {
    output = await backend.complete({
      task: name,
      system: task.system(language),
      prompt: task.prompt(parsed.data, language),
      schema: task.output,
      model,
      language,
      signal: opts.signal,
      onUsage: (u) => {
        reported = true;
        total.inputTokens += u.inputTokens;
        total.outputTokens += u.outputTokens;
        total.cacheReadTokens += u.cacheReadTokens;
        total.cacheWriteTokens += u.cacheWriteTokens;
        if (u.costUsd !== undefined) total.costUsd = (total.costUsd ?? 0) + u.costUsd;
        reportedModel ??= u.model;
      },
    });
  } catch (err) {
    const code = (err as { detail?: { code?: string } }).detail?.code;
    finish(false, code ?? "AI_BACKEND_FAILED");
    throw err;
  }
  const ms = finish(true);
  return {
    output: output as TaskOutput<N>,
    stamp: {
      by: `${backend.id}:${backend.resolveModel(model)}`,
      at: new Date().toISOString(),
      language,
    },
    promptVersion: task.promptVersion,
    ms,
    ...(reported ? { usage: { ...total } } : {}),
  };
}
