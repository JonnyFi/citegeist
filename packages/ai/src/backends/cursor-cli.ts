import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aiErrors, snippet } from "../errors.js";
import { CURSOR_ENV_BLOCKLIST, cleanEnv, nodeRunner, type ProcessRunner } from "../runner.js";
import { structured, toModelJsonSchema } from "../structured.js";
import {
  type AgentSession,
  type CompleteRequest,
  type InferenceBackend,
  isModelClass,
  type ModelChoice,
  type SessionRequest,
} from "../types.js";
import { compareVersions } from "./claude-cli.js";

/** Cursor CLI version the flag set was checked against (`--mode ask`, `--trust`, `--format json`). */
export const PINNED_CURSOR_VERSION = "2026.05.16";

export interface CursorCliOptions {
  runner?: ProcessRunner;
  /** Executable name or path (`agent`, older installs call it `cursor-agent`). */
  command?: string;
  /** Minimum CLI version that was tested. `null` turns the check off. */
  pinnedVersion?: string | null;
  /**
   * Concrete models for the classes, as listed by `agent --list-models`. Cursor model ids carry
   * the reasoning effort (`...-low`, `...-high`), there is no separate effort flag. Unset means
   * `auto`, the default of the logged-in Cursor account.
   */
  models?: { fast?: string; smart?: string };
  timeoutMs?: number;
  /** Working directory for the child. Defaults to a fresh temp directory so no project files are visible. */
  cwd?: string;
  env?: Record<string, string | undefined>;
}

const INSTALL_HINT =
  "Install the Cursor CLI (https://cursor.com/cli), run `agent login`, then retry.";
const UPGRADE_HINT = "Update the Cursor CLI (`agent update`), then retry.";

const LOGGED_OUT =
  /not logged in|not authenticated|unauthenticated|authentication required|api key is invalid|agent login/i;

export function parseCursorVersion(output: string): string | undefined {
  return output.match(/(\d{4}\.\d{1,2}\.\d{1,2})/)?.[1];
}

/** Shape of an `agent -p --output-format json` result. Only the fields used here. */
interface CursorResult {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
}

/**
 * Fresh `agent -p` per call. The prompt goes in on stdin. `--mode ask` is Cursor's read-only mode
 * (no edits, no shell), `--trust` skips the workspace prompt of headless runs, and the empty temp
 * cwd leaves nothing to read. The CLI has no JSON schema flag, so the schema is part of the prompt
 * and `structured` validates and retries. The login is the one of `agent login` or CURSOR_API_KEY.
 */
export class CursorCliBackend implements InferenceBackend {
  readonly id = "cursor-cli";
  private readonly runner: ProcessRunner;
  private readonly command: string;
  private readonly pinned: string | null;
  private readonly timeoutMs: number;
  private readonly env: Record<string, string | undefined>;
  private cwdPromise: Promise<string> | undefined;
  private ready: Promise<void> | undefined;

  constructor(private readonly opts: CursorCliOptions = {}) {
    this.runner = opts.runner ?? nodeRunner;
    this.command = opts.command ?? "agent";
    this.pinned = opts.pinnedVersion === undefined ? PINNED_CURSOR_VERSION : opts.pinnedVersion;
    this.timeoutMs = opts.timeoutMs ?? 90_000;
    this.env = cleanEnv(CURSOR_ENV_BLOCKLIST, {}, opts.env);
  }

  resolveModel(choice: ModelChoice = "fast"): string {
    if (isModelClass(choice)) return this.opts.models?.[choice] ?? "auto";
    return choice;
  }

  session(_req: SessionRequest): AgentSession {
    throw aiErrors.sessionUnsupported(this.id);
  }

  private cwd(): Promise<string> {
    this.cwdPromise ??= this.opts.cwd
      ? Promise.resolve(this.opts.cwd)
      : mkdtemp(join(tmpdir(), "citegeist-cursor-"));
    return this.cwdPromise;
  }

  /** Checks installation, version and login once per backend instance. */
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
    if (v.spawnError === "ENOENT") throw aiErrors.cliMissing("agent", INSTALL_HINT);
    if (v.exitCode !== 0) {
      throw aiErrors.backendFailed(this.id, "preflight", `agent --version failed: ${v.stderr}`);
    }
    const found = parseCursorVersion(v.stdout);
    if (this.pinned && (found === undefined || compareVersions(found, this.pinned) < 0)) {
      throw aiErrors.cliVersion("agent", found ?? snippet(v.stdout, 40), this.pinned, UPGRADE_HINT);
    }
    // `agent status` only reads the stored login. A set CURSOR_API_KEY is the login instead, and
    // a wrong key shows up on the first call.
    if (this.env.CURSOR_API_KEY) return;
    const a = await this.runner({ ...base, args: ["status", "--format", "json"] });
    let loggedIn = false;
    try {
      loggedIn = (JSON.parse(a.stdout) as { isAuthenticated?: boolean }).isAuthenticated === true;
    } catch {
      loggedIn = a.exitCode === 0 && !LOGGED_OUT.test(a.stdout);
    }
    if (!loggedIn) throw aiErrors.cliLoggedOut("agent", "agent login", a.stdout);
  }

  buildArgs(req: CompleteRequest<unknown>): string[] {
    return [
      "-p",
      "--output-format",
      "json",
      "--mode",
      "ask",
      "--trust",
      "--model",
      this.resolveModel(req.model),
    ];
  }

  /** The CLI takes no schema flag and no system prompt flag, so both go into the stdin text. */
  buildInput(req: CompleteRequest<unknown>, prompt: string): string {
    const schema = JSON.stringify(toModelJsonSchema(req.schema));
    return [
      req.system,
      `Answer with exactly one JSON object that matches this JSON Schema, and nothing else (no prose, no code fence). Do not use any tools.\n${schema}`,
      prompt,
    ]
      .filter(Boolean)
      .join("\n\n");
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
          stdin: this.buildInput(req, prompt),
          timeoutMs: this.timeoutMs,
        });
        if (r.timedOut) throw aiErrors.timeout(this.id, req.task, this.timeoutMs);
        if (r.spawnError === "ENOENT") throw aiErrors.cliMissing("agent", INSTALL_HINT);
        let parsed: CursorResult | undefined;
        try {
          parsed = JSON.parse(r.stdout) as CursorResult;
        } catch {
          // plain-text errors are handled below
        }
        const errText = `${parsed?.result ?? ""} ${r.stderr} ${parsed ? "" : r.stdout}`;
        if (LOGGED_OUT.test(errText) && (parsed?.is_error || r.exitCode !== 0)) {
          this.ready = undefined;
          throw aiErrors.cliLoggedOut("agent", "agent login", errText);
        }
        if (r.exitCode !== 0 || !parsed || parsed.is_error) {
          throw aiErrors.backendFailed(
            this.id,
            req.task,
            parsed?.result || r.stderr || r.stdout || `exit code ${r.exitCode}`,
            { exitCode: r.exitCode, subtype: parsed?.subtype },
          );
        }
        return parsed.result ?? "";
      },
    });
  }
}
