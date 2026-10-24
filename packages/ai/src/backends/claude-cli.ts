import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aiErrors, snippet } from "../errors.js";
import { CLAUDE_ENV_BLOCKLIST, cleanEnv, nodeRunner, type ProcessRunner } from "../runner.js";
import { structured, toModelJsonSchema } from "../structured.js";
import {
  type AgentSession,
  type AiUsage,
  type CompleteRequest,
  type InferenceBackend,
  isModelClass,
  type ModelChoice,
  type SessionRequest,
} from "../types.js";

/** Claude Code version the flag set was measured against (spike S2). */
export const PINNED_CLAUDE_VERSION = "2.1.307";

export interface ClaudeCodeCliOptions {
  runner?: ProcessRunner;
  /** Executable name or path. */
  command?: string;
  /** Minimum CLI version that was tested (flags such as --json-schema). `null` turns the check off. */
  pinnedVersion?: string | null;
  models?: { fast: string; smart: string };
  timeoutMs?: number;
  /** Working directory for the child. Defaults to a fresh temp directory so no project files or CLAUDE.md are loaded. */
  cwd?: string;
  env?: Record<string, string | undefined>;
}

const INSTALL_HINT =
  "Install Claude Code (`npm install -g @anthropic-ai/claude-code` or https://claude.com/claude-code), run `claude` once to log in, then retry.";

export function parseClaudeVersion(output: string): string | undefined {
  return output.match(/(\d+\.\d+\.\d+)/)?.[1];
}

/** Text shape of a `claude -p --output-format json` result. Only the fields used here. */
interface ClaudeResult {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  modelUsage?: Record<
    string,
    {
      inputTokens?: number;
      outputTokens?: number;
      cacheReadInputTokens?: number;
      cacheCreationInputTokens?: number;
      costUSD?: number;
    }
  >;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Usage of a `claude -p --output-format json` result. `modelUsage` adds up every API call of the
 * run (the structured output costs a second turn), while `usage` only describes the last one, so
 * `modelUsage` wins when it is there. `total_cost_usd` is the list price.
 */
export function claudeUsage(r: ClaudeResult | undefined): AiUsage | undefined {
  if (!r) return undefined;
  const models = Object.entries(r.modelUsage ?? {});
  let usage: AiUsage | undefined;
  if (models.length > 0) {
    usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    for (const [, m] of models) {
      usage.inputTokens += num(m.inputTokens);
      usage.outputTokens += num(m.outputTokens);
      usage.cacheReadTokens += num(m.cacheReadInputTokens);
      usage.cacheWriteTokens += num(m.cacheCreationInputTokens);
    }
    usage.model = models[0]?.[0];
  } else if (r.usage) {
    usage = {
      inputTokens: num(r.usage.input_tokens),
      outputTokens: num(r.usage.output_tokens),
      cacheReadTokens: num(r.usage.cache_read_input_tokens),
      cacheWriteTokens: num(r.usage.cache_creation_input_tokens),
    };
  }
  if (!usage) return undefined;
  if (typeof r.total_cost_usd === "number") usage.costUsd = r.total_cost_usd;
  return usage;
}

const LOGGED_OUT = /not logged in|please run \/login|invalid api key|authentication/i;

/**
 * Fresh `claude -p` per call, flags from spike S2: Haiku, effort low, thinking off, no tools, no
 * user settings, no session persistence, isolated cwd. `--bare` stays off because it ignores the
 * subscription login.
 */
export class ClaudeCodeCliBackend implements InferenceBackend {
  readonly id = "claude-code-cli";
  private readonly runner: ProcessRunner;
  private readonly command: string;
  private readonly pinned: string | null;
  private readonly models: { fast: string; smart: string };
  private readonly timeoutMs: number;
  private readonly env: Record<string, string | undefined>;
  private cwdPromise: Promise<string> | undefined;
  private ready: Promise<void> | undefined;

  constructor(private readonly opts: ClaudeCodeCliOptions = {}) {
    this.runner = opts.runner ?? nodeRunner;
    this.command = opts.command ?? "claude";
    this.pinned = opts.pinnedVersion === undefined ? PINNED_CLAUDE_VERSION : opts.pinnedVersion;
    this.models = opts.models ?? { fast: "haiku", smart: "sonnet" };
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.env = cleanEnv(CLAUDE_ENV_BLOCKLIST, { MAX_THINKING_TOKENS: "0" }, opts.env);
  }

  resolveModel(choice: ModelChoice = "fast"): string {
    if (isModelClass(choice)) return this.models[choice];
    return choice;
  }

  session(_req: SessionRequest): AgentSession {
    throw aiErrors.sessionUnsupported(this.id);
  }

  private cwd(): Promise<string> {
    this.cwdPromise ??= this.opts.cwd
      ? Promise.resolve(this.opts.cwd)
      : mkdtemp(join(tmpdir(), "citegeist-claude-"));
    return this.cwdPromise;
  }

  /** Checks installation, version pin and login once per backend instance. */
  async preflight(): Promise<void> {
    this.ready ??= this.checkSetup().catch((e) => {
      this.ready = undefined;
      throw e;
    });
    return this.ready;
  }

  private async checkSetup(): Promise<void> {
    const cwd = await this.cwd();
    const base = { command: this.command, cwd, env: this.env, timeoutMs: 15_000 };
    const v = await this.runner({ ...base, args: ["--version"] });
    if (v.spawnError === "ENOENT") throw aiErrors.cliMissing("claude", INSTALL_HINT);
    if (v.exitCode !== 0) {
      throw aiErrors.backendFailed(this.id, "preflight", `claude --version failed: ${v.stderr}`);
    }
    const found = parseClaudeVersion(v.stdout);
    // Claude Code updates itself often, so the pin is a minimum version, not an exact match.
    if (
      this.pinned &&
      (found === undefined || found === null || compareVersions(found, this.pinned) < 0)
    ) {
      throw aiErrors.cliVersion("claude", found ?? snippet(v.stdout, 40), this.pinned);
    }
    const a = await this.runner({ ...base, args: ["auth", "status"] });
    let loggedIn = false;
    try {
      loggedIn = (JSON.parse(a.stdout) as { loggedIn?: boolean }).loggedIn === true;
    } catch {
      loggedIn = a.exitCode === 0 && !LOGGED_OUT.test(a.stdout);
    }
    if (!loggedIn) throw aiErrors.cliLoggedOut("claude", "claude auth login", a.stdout);
  }

  buildArgs(req: CompleteRequest<unknown>): string[] {
    const args = [
      "-p",
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(toModelJsonSchema(req.schema)),
      "--model",
      this.resolveModel(req.model),
      "--effort",
      "low",
      "--tools",
      "",
      "--setting-sources",
      "",
      "--disable-slash-commands",
      "--strict-mcp-config",
      "--no-session-persistence",
      "--exclude-dynamic-system-prompt-sections",
    ];
    if (req.system) args.push("--system-prompt", req.system);
    return args;
  }

  async complete<T>(req: CompleteRequest<T>): Promise<T> {
    await this.preflight();
    const cwd = await this.cwd();
    const args = this.buildArgs(req);
    return structured({
      backend: this.id,
      task: req.task,
      schema: req.schema,
      prompt: req.prompt,
      attempt: async (prompt) => {
        const r = await this.runner({
          command: this.command,
          args,
          cwd,
          env: this.env,
          stdin: prompt,
          timeoutMs: this.timeoutMs,
          ...(req.signal ? { signal: req.signal } : {}),
        });
        if (r.aborted || req.signal?.aborted) throw aiErrors.cancelled(this.id, req.task);
        if (r.timedOut) throw aiErrors.timeout(this.id, req.task, this.timeoutMs);
        if (r.spawnError === "ENOENT") throw aiErrors.cliMissing("claude", INSTALL_HINT);
        let parsed: ClaudeResult | undefined;
        try {
          parsed = JSON.parse(r.stdout) as ClaudeResult;
        } catch {
          // handled below
        }
        const used = claudeUsage(parsed);
        if (used) req.onUsage?.(used);
        const errText = `${parsed?.result ?? ""} ${r.stderr}`;
        if (LOGGED_OUT.test(errText) && (parsed?.is_error || r.exitCode !== 0)) {
          this.ready = undefined;
          throw aiErrors.cliLoggedOut("claude", "claude auth login", errText);
        }
        if (r.exitCode !== 0 || !parsed || parsed.is_error) {
          throw aiErrors.backendFailed(
            this.id,
            req.task,
            parsed?.result || r.stderr || r.stdout || `exit code ${r.exitCode}`,
            { exitCode: r.exitCode, subtype: parsed?.subtype },
          );
        }
        // A missing structured_output means the model answered in prose: let the schema retry handle it.
        return parsed.structured_output ?? parsed.result ?? "";
      },
    });
  }
}

/** Compares dotted numeric versions; returns negative, zero or positive. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
