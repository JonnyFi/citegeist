import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import type { LitsearchRunStatus } from "@citegeist/ops";
import { CitegeistError } from "@citegeist/schema";
import { writeFileAtomic } from "../fsutil.js";
import { extendedPath, findExecutable } from "../settings/executables.js";

/** How to start a script of workers/research. */
export interface LitsearchCommand {
  command: string;
  /** Arguments before the script path, for example `uv run ... python -u`. */
  args: string[];
  env?: Record<string, string>;
}

export interface LitsearchCommandConfig {
  /** Directory of workers/research with pyproject.toml and uv.lock. */
  sourceDir: string;
  /** Machine-local Python environment, outside the library and the app bundle. */
  envDir: string;
  /** Location of `uv`. Default: found on PATH or in the usual install directories. */
  uv?: string;
}

/** Default environment location below the machine-local base: `<base>/research/venv`. */
export function defaultLitsearchEnvDir(localBase: string): string {
  return join(localBase, "research", "venv");
}

/**
 * Runs the scripts with uv in their own environment. The worker has no dependencies, so the first
 * run only installs Python 3.12 if the machine has none.
 */
export function litsearchCommand(cfg: LitsearchCommandConfig): LitsearchCommand {
  return {
    command: cfg.uv ?? findExecutable("uv") ?? "uv",
    args: ["run", "--frozen", "--directory", cfg.sourceDir, "python", "-u"],
    env: { PATH: extendedPath(), UV_PROJECT_ENVIRONMENT: cfg.envDir },
  };
}

/** What the scripts read from the environment (workers/research/scripts/settings.py). */
export interface LitsearchEnv {
  /** <library>/research */
  dataDir: string;
  /** Machine-local lookup cache. */
  cacheDir: string;
  openalexKey?: string | undefined;
  mailto?: string | undefined;
  /** Part of the launchd labels of the library's watchlists. */
  libraryId?: string | undefined;
  /** Keychain service a launchd agent reads the OpenAlex key from. */
  keychainService?: string | undefined;
}

/** The command could not be started because `uv` is not installed (or not where it was looked for). */
export function uvMissing(command: string): CitegeistError {
  return new CitegeistError({
    code: "LITSEARCH_UV_MISSING",
    message: `The literature search could not start: "${command}" was not found.`,
    fix: "Install uv with `brew install uv` (or from https://docs.astral.sh/uv/), then try again.",
    recovery: "do-first",
    sideEffects: "none",
  });
}

/** Sends a signal to the child and everything it started (uv runs python as a grandchild). */
function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    // the group is gone already, or never existed (no setsid): fall back to the child alone
    try {
      child.kill(signal);
    } catch {
      // already exited
    }
  }
}

export function scriptEnv(e: LitsearchEnv): Record<string, string> {
  return {
    // the scripts live in the signed app bundle, where Python must not write __pycache__
    PYTHONDONTWRITEBYTECODE: "1",
    CITEGEIST_LITSEARCH_DIR: e.dataDir,
    CITEGEIST_LITSEARCH_CACHE: e.cacheDir,
    ...(e.openalexKey ? { OPENALEX_API_KEY: e.openalexKey } : {}),
    ...(e.mailto ? { OPENDRAFT_CONTACT_EMAIL: e.mailto } : {}),
    ...(e.libraryId ? { CITEGEIST_LIBRARY_ID: e.libraryId } : {}),
    ...(e.keychainService ? { CITEGEIST_KEYCHAIN_SERVICE: e.keychainService } : {}),
  };
}

/** The settings of a run as run.json stores them (same keys as research-pipeline). */
export interface RunRequest {
  topic: string;
  queries: string[];
  since?: number | undefined;
  top?: number | undefined;
  disableSources?: string[] | undefined;
  /** The watchlist that started the run. */
  watch?: string | undefined;
}

export interface PipelineRun {
  /** Path of workers/research/scripts/pipeline.py, or a stub in tests. */
  script: string;
  command: LitsearchCommand;
  env: LitsearchEnv;
  /** The run folder; run.json is written here. */
  dir: string;
  runId: string;
  request: RunRequest;
  /** Each parsed progress event, as it arrives. */
  onEvent?: (event: Record<string, unknown>) => void;
  signal?: AbortSignal;
  /** Grace period between SIGTERM and SIGKILL on cancel. Default 5 s. */
  killAfterMs?: number;
  now?: () => Date;
}

export interface PipelineOutcome {
  status: Extract<LitsearchRunStatus, "done" | "failed" | "cancelled">;
  counts: Record<string, number>;
  error?: string;
}

const iso = (d: Date): string => d.toISOString().slice(0, 19);

function readMeta(dir: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeMeta(dir: string, meta: Record<string, unknown>): void {
  writeFileAtomic(join(dir, "run.json"), `${JSON.stringify(meta, null, 2)}\n`);
}

/**
 * Writes run.json for a run that is queued, before its job has started: `running` with the
 * settings, so the run can be listed and opened at once. A resumed run keeps its folder's history
 * (creation time, attempts); runPipeline takes over when the job starts.
 */
export function writeQueuedMeta(
  dir: string,
  runId: string,
  request: RunRequest,
  now: () => Date = () => new Date(),
): void {
  mkdirSync(dir, { recursive: true });
  const { error: _e, finished: _f, pid: _p, host: _h, ...previous } = readMeta(dir);
  writeMeta(dir, {
    dropped_queries: [],
    counts: {},
    attempts: 0,
    ...previous,
    id: runId,
    topic: request.topic,
    queries: request.queries,
    since: request.since ?? null,
    top: request.top ?? null,
    created: typeof previous.created === "string" ? previous.created : iso(now()),
    status: "running",
    ...(request.disableSources?.length ? { disabled_sources: request.disableSources } : {}),
    ...(request.watch ? { watchlist: request.watch } : {}),
  });
}

/**
 * Runs pipeline.py for one run folder and keeps run.json current: `running` with the settings at
 * the start, then `done` with the section counts, `failed` with the last error message or
 * `cancelled`. A resumed run reuses the folder: finished queries come from its query-cache.
 */
export function runPipeline(run: PipelineRun): Promise<PipelineOutcome> {
  const now = run.now ?? (() => new Date());
  const { dir, request } = run;
  mkdirSync(dir, { recursive: true });
  const previous = readMeta(dir);
  const attempts = (typeof previous.attempts === "number" ? previous.attempts : 0) + 1;
  const meta: Record<string, unknown> = {
    id: run.runId,
    topic: request.topic,
    queries: request.queries,
    dropped_queries: [],
    since: request.since ?? null,
    top: request.top ?? null,
    created: typeof previous.created === "string" ? previous.created : iso(now()),
    status: "running",
    counts: {},
    attempts,
    ...(request.disableSources?.length ? { disabled_sources: request.disableSources } : {}),
    ...(request.watch ? { watchlist: request.watch } : {}),
  };
  writeMeta(dir, meta);

  const args = [
    ...run.command.args,
    run.script,
    // --flag=value: a topic or query that starts with "-" would otherwise read as an option
    `--topic=${request.topic}`,
    ...request.queries.map((q) => `--query=${q}`),
    ...(request.since !== undefined ? ["--since", String(request.since)] : []),
    ...(request.top !== undefined ? ["--top", String(request.top)] : []),
    ...(request.disableSources ?? []).map((s) => `--disable-source=${s}`),
    "--out",
    dir,
    "--progress-jsonl",
    "--query-cache",
    join(dir, "query-cache"),
  ];

  return new Promise((resolve) => {
    // A resumed run starts a fresh progress log; the stages of the earlier attempt no longer apply.
    const progress = createWriteStream(join(dir, "progress.jsonl"), { flags: "w" });
    const stderr = createWriteStream(join(dir, "stderr.log"), { flags: attempts > 1 ? "a" : "w" });
    const child = spawn(run.command.command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...run.command.env, ...scriptEnv(run.env) },
      cwd: dir,
      detached: true, // own process group, so cancel reaches python behind uv
    });
    // The pid tells a reader whether a "running" run is still alive (watch.py writes it too). It
    // is synced with the library, so the host says on which Mac the pid means anything.
    if (child.pid) writeMeta(dir, { ...meta, pid: child.pid, host: hostname() });
    let buffer = "";
    let counts: Record<string, number> = {};
    let lastError: string | undefined;
    let cancelled = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const onLine = (line: string): void => {
      if (!line.trim()) return;
      progress.write(`${line}\n`);
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return;
      }
      if (event.type === "error" && typeof event.msg === "string") lastError = event.msg;
      if (event.type === "done" && event.counts && typeof event.counts === "object") {
        counts = Object.fromEntries(
          Object.entries(event.counts as Record<string, unknown>).filter(
            (e): e is [string, number] =>
              ["main", "preprint", "grey", "rejected"].includes(e[0]) && Number.isInteger(e[1]),
          ),
        );
      }
      run.onEvent?.(event);
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let nl = buffer.indexOf("\n");
      while (nl >= 0) {
        onLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf("\n");
      }
    });
    child.stderr.pipe(stderr);

    const onAbort = (): void => {
      cancelled = true;
      killTree(child, "SIGTERM");
      killTimer = setTimeout(() => killTree(child, "SIGKILL"), run.killAfterMs ?? 5000);
    };
    if (run.signal?.aborted) onAbort();
    else run.signal?.addEventListener("abort", onAbort, { once: true });

    let settled = false;
    const finish = (code: number | null, startError?: string): void => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      run.signal?.removeEventListener("abort", onAbort);
      if (buffer) onLine(buffer);
      const status: PipelineOutcome["status"] = cancelled
        ? "cancelled"
        : code === 0
          ? "done"
          : "failed";
      const error =
        status === "failed"
          ? (startError ?? lastError ?? `pipeline.py exited with code ${code}`)
          : undefined;
      // run.json says "done" only once both logs are on disk, so a reader never sees a cut log.
      progress.end();
      if (!child.stderr.readableEnded) stderr.end();
      void Promise.all([finished(progress), finished(stderr)])
        .catch(() => undefined)
        .then(() => {
          writeMeta(dir, {
            ...meta,
            status,
            counts,
            finished: iso(now()),
            ...(error ? { error } : {}),
          });
          resolve({ status, counts, ...(error ? { error } : {}) });
        });
    };
    child.on("error", (err) => {
      const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
      const why = missing
        ? `"${run.command.command}" was not found. Install uv with \`brew install uv\`.`
        : err.message;
      finish(null, `could not start the literature search: ${why}`);
    });
    child.on("close", (code) => finish(code));
  });
}

export interface ScriptResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Longest a short script may run. The first run also downloads Python through uv. */
export const SCRIPT_TIMEOUT_MS = 10 * 60_000;

/**
 * Runs a short script of workers/research to the end (report.py, watch.py, preprints.py) and
 * collects its output. A start failure resolves with code null and the reason; a missing `uv`
 * rejects with LITSEARCH_UV_MISSING. The timeout kills the whole process group.
 */
export function runScript(opts: {
  command: LitsearchCommand;
  script: string;
  args: string[];
  env: LitsearchEnv;
  cwd?: string;
  timeoutMs?: number;
}): Promise<ScriptResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(opts.command.command, [...opts.command.args, opts.script, ...opts.args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...opts.command.env, ...scriptEnv(opts.env) },
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      detached: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (c: string) => {
      stdout += c;
    });
    child.stderr.setEncoding("utf8").on("data", (c: string) => {
      stderr = (stderr + c).slice(-4000);
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child, "SIGKILL");
    }, opts.timeoutMs ?? SCRIPT_TIMEOUT_MS);
    let settled = false;
    const done = (r: ScriptResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(
        timedOut
          ? { ...r, code: null, stderr: `${r.stderr}\nstopped after the timeout`.trim() }
          : r,
      );
    };
    child.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT" && !settled) {
        settled = true;
        clearTimeout(timer);
        reject(uvMissing(opts.command.command));
        return;
      }
      done({ code: null, stdout, stderr: err.message });
    });
    child.on("close", (code) => done({ code, stdout, stderr }));
  });
}
