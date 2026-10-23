import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aiErrors } from "../errors.js";
import { CODEX_ENV_BLOCKLIST, cleanEnv, nodeRunner, type ProcessRunner } from "../runner.js";
import { structured, toModelJsonSchema } from "../structured.js";
import {
  type AgentSession,
  type CompleteRequest,
  type InferenceBackend,
  isModelClass,
  type ModelChoice,
  type SessionRequest,
} from "../types.js";

export interface CodexExecOptions {
  runner?: ProcessRunner;
  command?: string;
  /** Concrete models for the classes. Unset means the account default of the logged-in Codex. */
  models?: { fast?: string; smart?: string };
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
}

const INSTALL_HINT =
  "Install the Codex CLI (`npm install -g @openai/codex`), run `codex login`, then retry.";

/**
 * `codex exec --output-schema --ephemeral`, fresh process per call. Flags are the ones written in
 * spikes/s2/codex.mjs; that script was never run against a logged-in Codex, so this backend is
 * covered by recorded-output tests only.
 */
export class CodexExecBackend implements InferenceBackend {
  readonly id = "codex-exec";
  private readonly runner: ProcessRunner;
  private readonly command: string;
  private readonly timeoutMs: number;
  private readonly env: Record<string, string | undefined>;
  private ready: Promise<void> | undefined;

  constructor(private readonly opts: CodexExecOptions = {}) {
    this.runner = opts.runner ?? nodeRunner;
    this.command = opts.command ?? "codex";
    this.timeoutMs = opts.timeoutMs ?? 90_000;
    this.env = cleanEnv(CODEX_ENV_BLOCKLIST, {}, opts.env);
  }

  resolveModel(choice: ModelChoice = "fast"): string {
    if (isModelClass(choice)) return this.opts.models?.[choice] ?? "default";
    return choice;
  }

  session(_req: SessionRequest): AgentSession {
    throw aiErrors.sessionUnsupported(this.id);
  }

  async preflight(): Promise<void> {
    this.ready ??= this.checkSetup().catch((e) => {
      this.ready = undefined;
      throw e;
    });
    return this.ready;
  }

  private async checkSetup(): Promise<void> {
    const r = await this.runner({
      command: this.command,
      args: ["login", "status"],
      cwd: tmpdir(),
      env: this.env,
      timeoutMs: 15_000,
    });
    if (r.spawnError === "ENOENT") throw aiErrors.cliMissing("codex", INSTALL_HINT);
    if (r.exitCode !== 0) {
      throw aiErrors.cliLoggedOut("codex", "codex login", `${r.stdout} ${r.stderr}`);
    }
  }

  async complete<T>(req: CompleteRequest<T>): Promise<T> {
    await this.preflight();
    const dir = await mkdtemp(join(tmpdir(), "citegeist-codex-"));
    try {
      const schemaFile = join(dir, "schema.json");
      const outFile = join(dir, "last.json");
      await writeFile(schemaFile, JSON.stringify(toModelJsonSchema(req.schema)));
      const concrete =
        req.model && !isModelClass(req.model)
          ? req.model
          : this.opts.models?.[req.model === "smart" ? "smart" : "fast"];
      const args = [
        "exec",
        "--output-schema",
        schemaFile,
        "--ephemeral",
        "--skip-git-repo-check",
        "--ignore-user-config",
        "--ignore-rules",
        "-s",
        "read-only",
        "-C",
        dir,
        "-o",
        outFile,
        "-c",
        `model_reasoning_effort="${this.opts.reasoningEffort ?? "low"}"`,
        ...(concrete ? ["-m", concrete] : []),
      ];
      return await structured({
        backend: this.id,
        task: req.task,
        schema: req.schema,
        prompt: req.prompt,
        attempt: async (prompt) => {
          await rm(outFile, { force: true });
          const r = await this.runner({
            command: this.command,
            args,
            cwd: dir,
            env: this.env,
            stdin: req.system ? `${req.system}\n\n${prompt}` : prompt,
            timeoutMs: this.timeoutMs,
          });
          if (r.timedOut) throw aiErrors.timeout(this.id, req.task, this.timeoutMs);
          if (r.spawnError === "ENOENT") throw aiErrors.cliMissing("codex", INSTALL_HINT);
          if (r.exitCode !== 0) {
            if (/not logged in|login/i.test(r.stderr)) {
              this.ready = undefined;
              throw aiErrors.cliLoggedOut("codex", "codex login", r.stderr);
            }
            throw aiErrors.backendFailed(this.id, req.task, r.stderr || r.stdout, {
              exitCode: r.exitCode,
            });
          }
          try {
            return await readFile(outFile, "utf8");
          } catch {
            throw aiErrors.backendFailed(this.id, req.task, "codex exec wrote no output file", {
              exitCode: r.exitCode,
            });
          }
        },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
