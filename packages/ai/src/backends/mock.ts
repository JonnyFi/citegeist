import { aiErrors } from "../errors.js";
import { structured } from "../structured.js";
import type {
  AgentSession,
  AiUsage,
  CompleteRequest,
  InferenceBackend,
  ModelChoice,
  SessionRequest,
} from "../types.js";

/** A canned answer: a value (object or raw text), or a function of the request. */
export type MockResponse =
  | unknown
  | ((req: CompleteRequest<unknown>, attempt: number) => unknown | Promise<unknown>);

export interface MockCall {
  task: string;
  prompt: string;
  system: string | undefined;
  model: ModelChoice | undefined;
  language: string | undefined;
}

/**
 * Test backend. `responses` maps a task name to one answer or a queue of answers consumed per
 * attempt, so a test can script "invalid first, valid second". It runs through the same schema
 * validation and retry as the real backends.
 */
export class MockBackend implements InferenceBackend {
  readonly id: string;
  readonly calls: MockCall[] = [];
  private readonly queues = new Map<string, MockResponse[]>();
  private readonly fallbacks = new Map<string, MockResponse>();
  /** Reported as the usage of every attempt, to test the ledger. */
  usage: AiUsage | undefined;

  constructor(responses: Record<string, MockResponse | MockResponse[]> = {}, id = "mock") {
    this.id = id;
    for (const [task, r] of Object.entries(responses)) this.set(task, r);
  }

  /** Arrays are queues (last entry repeats), anything else is a fixed answer. */
  set(task: string, response: MockResponse | MockResponse[]): void {
    if (Array.isArray(response)) {
      this.queues.set(task, [...response]);
    } else {
      this.queues.delete(task);
      this.fallbacks.set(task, response);
    }
  }

  resolveModel(choice: ModelChoice = "fast"): string {
    return choice === "fast" || choice === "smart" ? `mock-${choice}` : choice;
  }

  session(_req: SessionRequest): AgentSession {
    throw aiErrors.sessionUnsupported(this.id);
  }

  async complete<T>(req: CompleteRequest<T>): Promise<T> {
    this.calls.push({
      task: req.task,
      prompt: req.prompt,
      system: req.system,
      model: req.model,
      language: req.language,
    });
    let attempts = 0;
    return structured({
      backend: this.id,
      task: req.task,
      schema: req.schema,
      prompt: req.prompt,
      attempt: async () => {
        attempts++;
        if (req.signal?.aborted) throw aiErrors.cancelled(this.id, req.task);
        if (this.usage) req.onUsage?.(this.usage);
        const queue = this.queues.get(req.task);
        let response: MockResponse;
        if (queue) {
          response = queue.length > 1 ? queue.shift() : queue[0];
        } else if (this.fallbacks.has(req.task)) {
          response = this.fallbacks.get(req.task);
        } else {
          throw aiErrors.backendFailed(this.id, req.task, "no mock response registered");
        }
        return typeof response === "function"
          ? (response as (r: CompleteRequest<unknown>, a: number) => unknown)(req, attempts)
          : response;
      },
    });
  }
}
