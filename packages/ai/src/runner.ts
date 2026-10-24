import { spawn } from "node:child_process";

export interface RunSpec {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  /** Written to stdin, then stdin is closed. */
  stdin?: string;
  timeoutMs: number;
  /** Aborting kills the process and everything it started, and resolves with `aborted: true`. */
  signal?: AbortSignal;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  /** Null when the process did not start or was killed. */
  exitCode: number | null;
  timedOut: boolean;
  /** True when `signal` ended the run. */
  aborted?: boolean;
  /** Node spawn error code such as `ENOENT` when the process could not start. */
  spawnError?: string;
}

/** All process spawning goes through this seam so tests never call real CLIs. */
export type ProcessRunner = (spec: RunSpec) => Promise<RunResult>;

/** Process groups of running children, so that a dying parent does not leave them behind. */
const liveGroups = new Set<number>();
let exitHookInstalled = false;

function killGroup(pid: number | undefined, fallback: () => void): void {
  if (pid === undefined) {
    fallback();
    return;
  }
  try {
    // A negative pid addresses the whole group; the child leads its own group (detached).
    process.kill(-pid, "SIGKILL");
  } catch {
    fallback();
  }
}

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once("exit", () => {
    for (const pid of liveGroups) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  });
}

/**
 * Runs the command in its own process group. A timeout or an abort signal kills the group with
 * SIGKILL, so the CLI and every child it started (node helpers, MCP servers, shells) are gone.
 */
export const nodeRunner: ProcessRunner = (spec) =>
  new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const done = (r: RunResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      spec.signal?.removeEventListener("abort", onAbort);
      if (child.pid !== undefined) liveGroups.delete(child.pid);
      resolve(r);
    };
    if (spec.signal?.aborted) {
      resolve({ stdout, stderr, exitCode: null, timedOut: false, aborted: true });
      return;
    }
    installExitHook();
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });
    if (child.pid !== undefined) liveGroups.add(child.pid);
    const kill = () => killGroup(child.pid, () => child.kill("SIGKILL"));
    function onAbort() {
      aborted = true;
      kill();
      // The group is dead; do not wait for pipes that a grandchild might still hold open.
      done({ stdout, stderr, exitCode: null, timedOut, aborted: true });
    }
    spec.signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => {
      timedOut = true;
      kill();
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
      done({ stdout, stderr, exitCode: code, timedOut, ...(aborted ? { aborted } : {}) });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(spec.stdin ?? "");
  });

/** Variables of a parent Claude Code session and API-key variables that would override the subscription login. */
export const CLAUDE_ENV_BLOCKLIST = /^(CLAUDECODE$|CLAUDE_CODE_|ANTHROPIC_|AI_AGENT)/i;
/** Parent Codex session variables. CODEX_HOME stays, because it can hold the login. */
export const CODEX_ENV_BLOCKLIST = /^(CODEX_(SANDBOX|THREAD|CI)|AI_AGENT)/i;

/** Parent agent session variables. CURSOR_API_KEY stays, because the Cursor CLI takes its login from it. */
export const CURSOR_ENV_BLOCKLIST = /^(CURSOR_AGENT$|AI_AGENT)/i;

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
