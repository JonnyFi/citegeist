import {
  aiErrors,
  ClaudeCodeCliBackend,
  CodexExecBackend,
  CursorCliBackend,
  type InferenceBackend,
  OPENAI_COMPAT_PRESETS,
  OpenAiCompatBackend,
  type ProcessRunner,
} from "@citegeist/ai";
import { CitegeistError } from "@citegeist/schema";
import { extendedPath, findExecutable } from "./executables.js";
import type { Keychain } from "./keychain.js";

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface BackendStatus {
  id: string;
  kind: "subscription-cli" | "api-key" | "local";
  label: string;
  available: boolean;
  detail?: string;
  /** For a missing or logged-out CLI: the agent-ready error with the install or login command. */
  error?: { code: string; message: string; fix: string; recovery: string };
}

/**
 * Detail values of `BackendStatus`. The UI maps the part before the colon to a translated text and
 * shows the rest, if any, as given.
 */
export const BACKEND_DETAIL = {
  ready: "ready",
  notInstalled: "not-installed",
  loggedOut: "logged-out",
  outdated: "outdated",
  noKey: "no-key",
  unreachable: "unreachable",
} as const;

interface CatalogEntry {
  id: string;
  kind: BackendStatus["kind"];
  label: string;
  /** Provider name under which the API key is stored. */
  keyProvider?: string;
}

/** Every backend the settings screen can show, in display order. */
export const BACKEND_CATALOG: readonly CatalogEntry[] = [
  { id: "claude-code-cli", kind: "subscription-cli", label: "Claude Code CLI" },
  { id: "codex-exec", kind: "subscription-cli", label: "Codex CLI" },
  { id: "cursor-cli", kind: "subscription-cli", label: "Cursor CLI" },
  { id: "ollama", kind: "local", label: "Ollama" },
  { id: "openai", kind: "api-key", label: "OpenAI API", keyProvider: "openai" },
  { id: "anthropic", kind: "api-key", label: "Anthropic API", keyProvider: "anthropic" },
  { id: "openrouter", kind: "api-key", label: "OpenRouter", keyProvider: "openrouter" },
  { id: "xai", kind: "api-key", label: "xAI API", keyProvider: "xai" },
];

export const BACKEND_IDS: readonly string[] = BACKEND_CATALOG.map((b) => b.id);
/** Key slot of the free NCBI E-utilities key (PubMed). It raises the rate limit of PMID lookups. */
export const NCBI_KEY_PROVIDER = "ncbi";
/** Key slot of the free OpenAlex key. It raises the daily limit of the literature search. */
export const OPENALEX_KEY_PROVIDER = "openalex";

/** Providers whose API key can be stored: the AI backends, the NCBI key and the OpenAlex key. */
export const KEY_PROVIDERS: readonly string[] = [
  ...BACKEND_CATALOG.flatMap((b) => (b.keyProvider ? [b.keyProvider] : [])),
  NCBI_KEY_PROVIDER,
  OPENALEX_KEY_PROVIDER,
];

/** Hands out inference backends by id. */
export interface BackendProvider {
  /** Throws a CitegeistError when the id is unknown or the backend lacks its key. */
  get(id: string): Promise<InferenceBackend>;
  status(): Promise<BackendStatus[]>;
  /** All backends that can be built right now, for the AiRouter. */
  build(): Promise<InferenceBackend[]>;
}

export interface BackendRegistryOptions {
  runner: ProcessRunner;
  keychain: Keychain;
  fetch?: FetchFn;
  /** Locates `claude`, `codex` and `agent`. Default: PATH plus the usual install directories. */
  find?: (name: string) => string | undefined;
  env?: Record<string, string | undefined>;
  ollamaUrl?: string;
}

function codeOf(err: unknown): string | undefined {
  return err instanceof CitegeistError ? err.detail.code : undefined;
}

export class BackendRegistry implements BackendProvider {
  private readonly find: (name: string) => string | undefined;
  private readonly env: Record<string, string | undefined>;
  private readonly doFetch: FetchFn;

  constructor(private readonly opts: BackendRegistryOptions) {
    this.find = opts.find ?? ((name) => findExecutable(name));
    this.env = opts.env ?? { ...process.env, PATH: extendedPath() };
    this.doFetch = opts.fetch ?? ((url, init) => fetch(url, init));
  }

  private claude(): ClaudeCodeCliBackend {
    return new ClaudeCodeCliBackend({
      runner: this.opts.runner,
      command: this.find("claude") ?? "claude",
      env: this.env,
    });
  }

  private codex(): CodexExecBackend {
    return new CodexExecBackend({
      runner: this.opts.runner,
      command: this.find("codex") ?? "codex",
      env: this.env,
    });
  }

  private cursor(): CursorCliBackend {
    return new CursorCliBackend({
      runner: this.opts.runner,
      command: this.find("agent") ?? this.find("cursor-agent") ?? "agent",
      env: this.env,
    });
  }

  private compat(provider: string, apiKey?: string): OpenAiCompatBackend {
    const preset = OPENAI_COMPAT_PRESETS[provider as keyof typeof OPENAI_COMPAT_PRESETS];
    return new OpenAiCompatBackend({
      id: provider,
      baseUrl: provider === "ollama" ? `${this.ollamaBase()}/v1` : preset.baseUrl,
      structured: preset.structured,
      models: { ...preset.models },
      ...(apiKey ? { apiKey } : {}),
      fetch: this.doFetch,
    });
  }

  private ollamaBase(): string {
    return (this.opts.ollamaUrl ?? "http://localhost:11434").replace(/\/$/, "");
  }

  async get(id: string): Promise<InferenceBackend> {
    switch (id) {
      case "claude-code-cli":
        return this.claude();
      case "codex-exec":
        return this.codex();
      case "cursor-cli":
        return this.cursor();
      case "ollama":
        return this.compat("ollama");
      default: {
        const entry = BACKEND_CATALOG.find((b) => b.id === id);
        if (!entry?.keyProvider) throw aiErrors.unknownBackend(id, [...BACKEND_IDS]);
        const key = await this.opts.keychain.get(entry.keyProvider);
        if (!key) {
          throw aiErrors.notConfigured(
            `API key for ${entry.label}`,
            `Enter the ${entry.label} key in the settings, then test again.`,
          );
        }
        return this.compat(entry.keyProvider, key);
      }
    }
  }

  async build(): Promise<InferenceBackend[]> {
    const out: InferenceBackend[] = [
      this.claude(),
      this.codex(),
      this.cursor(),
      this.compat("ollama"),
    ];
    for (const entry of BACKEND_CATALOG) {
      if (!entry.keyProvider) continue;
      const key = await this.opts.keychain.get(entry.keyProvider);
      if (key) out.push(this.compat(entry.keyProvider, key));
    }
    return out;
  }

  async status(): Promise<BackendStatus[]> {
    const probes = BACKEND_CATALOG.map((entry) => this.probe(entry));
    return Promise.all(probes);
  }

  private async probe(entry: CatalogEntry): Promise<BackendStatus> {
    const base = { id: entry.id, kind: entry.kind, label: entry.label };
    const result = (available: boolean, detail: string, error?: CitegeistError): BackendStatus => ({
      ...base,
      available,
      detail,
      ...(error
        ? {
            error: {
              code: error.detail.code,
              message: error.detail.message,
              fix: error.detail.fix,
              recovery: error.detail.recovery,
            },
          }
        : {}),
    });
    try {
      if (
        entry.id === "claude-code-cli" ||
        entry.id === "codex-exec" ||
        entry.id === "cursor-cli"
      ) {
        const backend =
          entry.id === "claude-code-cli"
            ? this.claude()
            : entry.id === "codex-exec"
              ? this.codex()
              : this.cursor();
        try {
          await backend.preflight();
          return result(true, BACKEND_DETAIL.ready);
        } catch (err) {
          const code = codeOf(err);
          const agentError = err instanceof CitegeistError ? err : undefined;
          if (code === "AI_CLI_MISSING") {
            return result(false, BACKEND_DETAIL.notInstalled, agentError);
          }
          if (code === "AI_CLI_LOGGED_OUT") {
            return result(false, BACKEND_DETAIL.loggedOut, agentError);
          }
          if (code === "AI_CLI_VERSION_MISMATCH") {
            const d = err instanceof CitegeistError ? err.detail.context : undefined;
            return result(false, `${BACKEND_DETAIL.outdated}: ${String(d?.found ?? "?")}`);
          }
          return result(
            false,
            `${BACKEND_DETAIL.unreachable}: ${(err as Error).message}`.slice(0, 200),
          );
        }
      }
      if (entry.id === "ollama") {
        const res = await this.doFetch(`${this.ollamaBase()}/api/tags`, {
          signal: AbortSignal.timeout(1500),
        });
        if (!res.ok) return result(false, `${BACKEND_DETAIL.unreachable}: HTTP ${res.status}`);
        const body = (await res.json()) as { models?: unknown[] };
        const n = Array.isArray(body.models) ? body.models.length : 0;
        return result(true, `${BACKEND_DETAIL.ready}: ${n} models`);
      }
      if (entry.keyProvider) {
        const has = await this.opts.keychain.has(entry.keyProvider);
        return result(has, has ? BACKEND_DETAIL.ready : BACKEND_DETAIL.noKey);
      }
    } catch (err) {
      return result(
        false,
        `${BACKEND_DETAIL.unreachable}: ${(err as Error).message}`.slice(0, 200),
      );
    }
    return result(false, BACKEND_DETAIL.unreachable);
  }
}
