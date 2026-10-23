import type { z } from "zod";
import { aiErrors } from "../errors.js";
import type { InferenceBackend, ModelChoice } from "../types.js";
import { cardParaphrase } from "./card-paraphrase/index.js";
import { cardVerify } from "./card-verify/index.js";
import { metadataFromFirstPage } from "./metadata-from-first-page/index.js";
import { noteProposeLinks } from "./note-propose-links/index.js";
import type { TaskDefinition } from "./types.js";

export const TASKS = {
  "card.paraphrase": cardParaphrase,
  "card.verify": cardVerify,
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
}

export interface TaskResult<O> {
  output: O;
  /** Matches `ModelStamp` in the schema package: who wrote the text. */
  stamp: { by: string; at: string; language: string };
  promptVersion: number;
  /** Wall time of the backend call in milliseconds. */
  ms: number;
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
  const output = await backend.complete({
    task: name,
    system: task.system(language),
    prompt: task.prompt(parsed.data, language),
    schema: task.output,
    model,
    language,
  });
  return {
    output: output as TaskOutput<N>,
    stamp: {
      by: `${backend.id}:${backend.resolveModel(model)}`,
      at: new Date().toISOString(),
      language,
    },
    promptVersion: task.promptVersion,
    ms: Math.round(performance.now() - t0),
  };
}
