import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { nodeRunner, type ProcessRunner } from "@citegeist/ai";
import { CitegeistError } from "@citegeist/schema";
import type { ChildProcessWorkerOptions, ConvertWorker } from "../ingest/worker.js";
import type { JobContext } from "../jobs/queue.js";
import { extendedPath, findExecutable } from "./executables.js";

export interface WorkerEnvConfig {
  /** Directory of workers/convert with pyproject.toml and uv.lock. */
  sourceDir: string;
  /** Machine-local directory of the Python environment, outside the library and the repo. */
  envDir: string;
  /** Location of `uv`. Default: found on PATH or in the usual install directories. */
  uv?: string;
}

/** Default environment location below the machine-local base: `<base>/worker/venv`. */
export function defaultEnvDir(localBase: string): string {
  return join(localBase, "worker", "venv");
}

/**
 * Process options for the conversion worker that run it inside the managed environment. The
 * lead passes these to `ChildProcessConvertWorker` instead of the repo-relative default.
 */
export function managedWorkerOptions(cfg: WorkerEnvConfig): ChildProcessWorkerOptions {
  return {
    command: cfg.uv ?? findExecutable("uv") ?? "uv",
    args: ["run", "--frozen", "--directory", cfg.sourceDir, "citegeist-convert"],
    env: { PATH: extendedPath(), UV_PROJECT_ENVIRONMENT: cfg.envDir },
  };
}

function setupError(
  code: string,
  message: string,
  fix: string,
  recovery: "do-first" | "fix-and-retry",
): CitegeistError {
  // A job error carries only code and message, so the fix travels inside the message too.
  return new CitegeistError({
    code,
    message: `${message} ${fix}`,
    fix,
    recovery,
    sideEffects: "none",
  });
}

const tail = (text: string, max = 600): string => text.trim().slice(-max);

export interface WorkerSetupDeps {
  runner?: ProcessRunner;
  worker: ConvertWorker;
  config: WorkerEnvConfig;
}

export interface WorkerSetupResult {
  version: string;
  engines: Record<string, string>;
  ready: boolean;
}

/**
 * The body of the `worker.setup` job: check `uv`, create the Python environment in the
 * machine-local directory, then ask the worker for `health`.
 */
export async function runWorkerSetup(
  ctx: JobContext,
  deps: WorkerSetupDeps,
  force: boolean,
): Promise<WorkerSetupResult> {
  const runner = deps.runner ?? nodeRunner;
  const { config } = deps;
  const env = {
    PATH: extendedPath(),
    HOME: process.env.HOME,
    UV_PROJECT_ENVIRONMENT: config.envDir,
  };
  const uv = config.uv ?? findExecutable("uv") ?? "uv";
  const run = (args: string[], timeoutMs: number) =>
    runner({ command: uv, args, cwd: "/", env, timeoutMs });

  if (!existsSync(join(config.sourceDir, "pyproject.toml"))) {
    throw setupError(
      "WORKER_SOURCE_MISSING",
      `The worker sources were not found in ${config.sourceDir}.`,
      "Reinstall citegeist, or set CITEGEIST_WORKER_DIR to a checkout of workers/convert.",
      "do-first",
    );
  }
  ctx.progress(0.05, "Checking uv");
  const version = await run(["--version"], 15_000);
  if (version.spawnError === "ENOENT") {
    throw setupError(
      "WORKER_UV_MISSING",
      "The `uv` command was not found.",
      "Install uv with `brew install uv` or `curl -LsSf https://astral.sh/uv/install.sh | sh`, then run the worker setup again.",
      "do-first",
    );
  }
  if (version.exitCode !== 0) {
    throw setupError(
      "WORKER_UV_BROKEN",
      `\`uv --version\` failed: ${tail(version.stderr || version.stdout)}`,
      "Reinstall uv (`brew reinstall uv`), then run the worker setup again.",
      "do-first",
    );
  }

  if (force && existsSync(config.envDir)) {
    ctx.progress(0.1, "Removing the old environment");
    rmSync(config.envDir, { recursive: true, force: true });
  }

  ctx.progress(0.15, "Installing the Python environment");
  const sync = await run(["sync", "--frozen", "--project", config.sourceDir], 15 * 60_000);
  if (ctx.signal.aborted)
    throw setupError("JOB_CANCELLED", "Setup was cancelled.", "Run it again.", "fix-and-retry");
  if (sync.timedOut) {
    throw setupError(
      "WORKER_SETUP_TIMEOUT",
      "Installing the Python environment took longer than 15 minutes.",
      "Check the network connection and run the worker setup again.",
      "fix-and-retry",
    );
  }
  if (sync.exitCode !== 0) {
    throw setupError(
      "WORKER_SETUP_FAILED",
      `\`uv sync\` failed: ${tail(sync.stderr || sync.stdout)}`,
      "Fix the problem named above (often the network or disk space) and run the worker setup again.",
      "fix-and-retry",
    );
  }

  ctx.progress(0.85, "Starting the worker");
  // A worker child that started before the environment existed must not answer this check.
  await deps.worker.close();
  let health: WorkerSetupResult;
  try {
    health = await deps.worker.health();
  } catch (err) {
    throw setupError(
      "WORKER_HEALTH_FAILED",
      `The worker did not answer health: ${err instanceof Error ? err.message : String(err)}`,
      "Run the worker setup again with force to rebuild the environment.",
      "fix-and-retry",
    );
  }
  if (!health.ready) {
    throw setupError(
      "WORKER_NOT_READY",
      "The worker started but reports it is not ready.",
      "Run the worker setup again with force to rebuild the environment.",
      "fix-and-retry",
    );
  }
  ctx.progress(1, "Worker ready");
  return health;
}
