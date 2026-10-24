import type { ZodType } from "zod";

/** `fast` is the highlighter class (Haiku-sized), `smart` is for extraction and judging. */
export type ModelClass = "fast" | "smart";

/**
 * Either a model class, resolved by the backend to a concrete model, or a concrete model name
 * that is passed through unchanged.
 */
export type ModelChoice = ModelClass | (string & {});

export function isModelClass(choice: string): choice is ModelClass {
  return choice === "fast" || choice === "smart";
}

/**
 * What one backend call consumed, as the backend reports it. `inputTokens` counts the input that
 * was not served from the cache; cache reads and writes are listed apart. `costUsd` is the list
 * price the backend computed, when it reports one. With a subscription nothing is billed per call,
 * so it is an estimate of what the call would cost on the API.
 */
export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd?: number | undefined;
  /** Concrete model when the backend names one that differs from the requested model. */
  model?: string | undefined;
}

export interface CompleteRequest<T> {
  /** Task name such as `card.paraphrase`. Used for logging and routing, never for behavior. */
  task: string;
  /** The user turn. */
  prompt: string;
  /** System instructions. Backends without a system channel prepend it to the prompt. */
  system?: string;
  /** Validates the model output. Also exported as JSON Schema to backends that take one. */
  schema: ZodType<T>;
  model?: ModelChoice;
  /** BCP 47 tag the output should be written in. The task puts it into the prompt itself. */
  language?: string;
  /** Aborting stops the call: CLI backends kill their process group, HTTP backends abort the fetch. */
  signal?: AbortSignal | undefined;
  /** Called once per model round trip that reports usage (a schema retry is a second one). */
  onUsage?: ((usage: AiUsage) => void) | undefined;
}

export interface McpConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface SessionRequest {
  system: string;
  mcpServers: McpConfig[];
  cwd: string;
}

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; input: unknown }
  | { type: "done" };

/** Typed stub for agentic work (library.ask, research.run). No backend implements it yet. */
export interface AgentSession {
  send(message: string): AsyncIterable<AgentEvent>;
  close(): Promise<void>;
}

export interface InferenceBackend {
  /** Stable id used in settings routing, e.g. `claude-code-cli`. */
  readonly id: string;
  /** Concrete model name for a choice, used to stamp AI texts (`by` in ModelStamp). */
  resolveModel(choice?: ModelChoice): string;
  complete<T>(req: CompleteRequest<T>): Promise<T>;
  session(req: SessionRequest): AgentSession;
}
