import type { ZodType } from "zod";
import type { ModelClass } from "../types.js";

/** One eval case. `check` returns a list of failure reasons, empty when the output passes. */
export interface EvalFixture<I, O> {
  id: string;
  input: I;
  language: string;
  check: (output: O, input: I) => string[];
}

export interface TaskDefinition<I = unknown, O = unknown> {
  /** Registry name such as `card.paraphrase`. */
  name: string;
  /** Version of the prompt file. Bump it when the prompt text changes; evals compare across versions. */
  promptVersion: number;
  description: string;
  input: ZodType<I>;
  output: ZodType<O>;
  modelClass: ModelClass;
  system: (language: string) => string;
  prompt: (input: I, language: string) => string;
  fixtures: EvalFixture<I, O>[];
}

/** Defines a task with its input and output types inferred. */
export function defineTask<I, O>(task: TaskDefinition<I, O>): TaskDefinition<I, O> {
  return task;
}

/** English name of a BCP 47 tag for use inside prompts ("de" becomes "German"). */
export function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}
