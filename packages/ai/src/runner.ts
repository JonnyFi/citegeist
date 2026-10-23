import { spawn } from "node:child_process";

export interface RunSpec {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  /** Written to stdin, then stdin is closed. */
  stdin?: string;
  timeoutMs: number;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  /** Null when the process did not start or was killed. */
  exitCode: number | null;
  timedOut: boolean;
  /** Node spawn error code such as `ENOENT` when the process could not start. */
  spawnError?: string;
}

/** All process spawning goes through this seam so tests never call real CLIs. */
export type ProcessRunner = (spec: RunSpec) => Promise<RunResult>;

export const nodeRunner: ProcessRunner = (spec) =>
  new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const done = (r: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, spec.timeoutMs);
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      done({ stdout, stderr, exitCode: null, timedOut, spawnError: err.code ?? err.message });
    });
    child.on("close", (code) => {
      done({ stdout, stderr, exitCode: code, timedOut });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(spec.stdin ?? "");
  });

/** Variables of a parent Claude Code session and API-key variables that would override the subscription login. */
export const CLAUDE_ENV_BLOCKLIST = /^(CLAUDECODE$|CLAUDE_CODE_|ANTHROPIC_|AI_AGENT)/i;
/** Parent Codex session variables. CODEX_HOME stays, because it can hold the login. */
export const CODEX_ENV_BLOCKLIST = /^(CODEX_(SANDBOX|THREAD|CI)|AI_AGENT)/i;

/** Environment for child CLIs with session-specific variables removed. */
export function cleanEnv(
  blocklist: RegExp,
  extra: Record<string, string> = {},
  base: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(base)) {
    if (blocklist.test(k)) continue;
    env[k] = v;
  }
  return { ...env, ...extra };
}
