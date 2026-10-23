import { aiErrors } from "../errors.js";
import { structured, toModelJsonSchema } from "../structured.js";
import {
  type AgentSession,
  type CompleteRequest,
  type InferenceBackend,
  isModelClass,
  type ModelChoice,
  type SessionRequest,
} from "../types.js";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface OpenAiCompatOptions {
  /** Registered backend id, for example `openrouter` or `ollama`. */
  id: string;
  /** Base URL including the version segment, without trailing slash, e.g. `https://api.openai.com/v1`. */
  baseUrl: string;
  apiKey?: string;
  models: { fast: string; smart: string };
  /**
   * How the schema reaches the model. `json_schema` sends `response_format` (OpenAI, OpenRouter,
   * xAI, Ollama). `prompt` only puts the schema into the system message, for endpoints that ignore
   * `response_format` (Anthropic's compatibility endpoint).
   */
  structured?: "json_schema" | "prompt";
  headers?: Record<string, string>;
  timeoutMs?: number;
  fetch?: FetchLike;
}

/** Ready-made settings for the OpenAI-compatible endpoints named in the architecture. */
export const OPENAI_COMPAT_PRESETS = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    structured: "json_schema",
    models: { fast: "gpt-5-mini", smart: "gpt-5" },
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    structured: "prompt",
    models: { fast: "claude-haiku-5-5", smart: "claude-sonnet-5-5" },
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    structured: "json_schema",
    models: { fast: "anthropic/claude-haiku-5-5", smart: "anthropic/claude-sonnet-5-5" },
  },
  xai: {
    baseUrl: "https://api.x.ai/v1",
    structured: "json_schema",
    models: { fast: "grok-4-fast", smart: "grok-4" },
  },
  ollama: {
    baseUrl: "http://localhost:11434/v1",
    structured: "json_schema",
    models: { fast: "qwen3:8b", smart: "qwen3:32b" },
  },
} as const satisfies Record<string, Pick<OpenAiCompatOptions, "baseUrl" | "structured" | "models">>;

interface ChatCompletion {
  choices?: { message?: { content?: string | null } }[];
  error?: { message?: string };
}

export class OpenAiCompatBackend implements InferenceBackend {
  readonly id: string;
  private readonly doFetch: FetchLike;
  private readonly timeoutMs: number;

  constructor(private readonly opts: OpenAiCompatOptions) {
    this.id = opts.id;
    this.doFetch = opts.fetch ?? ((url, init) => fetch(url, init));
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  resolveModel(choice: ModelChoice = "fast"): string {
    if (isModelClass(choice)) return this.opts.models[choice];
    return choice;
  }

  session(_req: SessionRequest): AgentSession {
    throw aiErrors.sessionUnsupported(this.id);
  }

  async complete<T>(req: CompleteRequest<T>): Promise<T> {
    const jsonSchema = toModelJsonSchema(req.schema);
    const system = [
      req.system ?? "",
      `Answer with a single JSON object that matches this JSON Schema, and nothing else:\n${JSON.stringify(jsonSchema)}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const mode = this.opts.structured ?? "json_schema";
    return structured({
      backend: this.id,
      task: req.task,
      schema: req.schema,
      prompt: req.prompt,
      attempt: async (prompt) => {
        const body: Record<string, unknown> = {
          model: this.resolveModel(req.model),
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
          stream: false,
        };
        if (mode === "json_schema") {
          body.response_format = {
            type: "json_schema",
            json_schema: { name: "result", strict: true, schema: jsonSchema },
          };
        }
        const headers: Record<string, string> = {
          "content-type": "application/json",
          ...this.opts.headers,
        };
        if (this.opts.apiKey) headers.authorization = `Bearer ${this.opts.apiKey}`;
        let res: Response;
        try {
          res = await this.doFetch(`${this.opts.baseUrl}/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(this.timeoutMs),
          });
        } catch (e) {
          if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
            throw aiErrors.timeout(this.id, req.task, this.timeoutMs);
          }
          throw aiErrors.backendFailed(
            this.id,
            req.task,
            `${e instanceof Error ? e.message : String(e)} (${this.opts.baseUrl})`,
          );
        }
        const text = await res.text();
        if (res.status === 401 || res.status === 403) {
          throw aiErrors.notConfigured(
            `API key for backend ${this.id}`,
            `Set a valid API key for ${this.id} in the AI settings (HTTP ${res.status}).`,
          );
        }
        if (!res.ok) {
          throw aiErrors.backendFailed(this.id, req.task, text, { status: res.status });
        }
        let data: ChatCompletion;
        try {
          data = JSON.parse(text) as ChatCompletion;
        } catch {
          throw aiErrors.backendFailed(this.id, req.task, `response is not JSON: ${text}`);
        }
        return data.choices?.[0]?.message?.content ?? "";
      },
    });
  }
}
