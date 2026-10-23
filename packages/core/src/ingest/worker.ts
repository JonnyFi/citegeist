import { type ChildProcess, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  CitegeistError,
  WORKER_METHODS,
  type WorkerConvertParams as WorkerConvertParamsSchema,
  type WorkerConvertResult as WorkerConvertResultSchema,
  type WorkerHealthResult as WorkerHealthResultSchema,
} from "@citegeist/schema";
import type { z } from "zod";
import { TransientError } from "../jobs/queue.js";

/** A worker error that is worth another attempt (the process crashed, the worker is busy). */
export class WorkerTransientError extends TransientError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WorkerTransientError";
  }
}

export type ConvertParams = z.input<typeof WorkerConvertParamsSchema>;
export type ConvertResult = z.infer<typeof WorkerConvertResultSchema>;
export type HealthResult = z.infer<typeof WorkerHealthResultSchema>;

export interface ConvertCallOptions {
  signal?: AbortSignal;
  /** Called for `progress` notifications of the worker. */
  onProgress?: (progress: number, message?: string) => void;
}

/** The conversion worker as the ingest pipeline sees it. */
export interface ConvertWorker {
  convert(params: ConvertParams, opts?: ConvertCallOptions): Promise<ConvertResult>;
  health(): Promise<HealthResult>;
  close(): Promise<void>;
}

export interface ChildProcessWorkerOptions {
  command: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Stop the child after this many ms without a request. Default 60000, 0 disables. */
  idleMs?: number;
  /** Fail a request that takes longer than this (ms). Default 30 minutes. */
  requestTimeoutMs?: number;
}

interface Pending {
  method: keyof typeof WORKER_METHODS;
  resolve(value: unknown): void;
  reject(err: unknown): void;
  onProgress?: ((progress: number, message?: string) => void) | undefined;
  cleanup(): void;
}

/**
 * JSON-RPC 2.0 over stdio to a child process, one JSON object per line (see
 * packages/schema/src/worker.ts). The child starts on the first request and stops when idle.
 * Cancelling a request kills the child, because the protocol has no cancel message; the next
 * request starts a fresh one. A crash fails all pending requests with a transient error.
 */
export class ChildProcessConvertWorker implements ConvertWorker {
  private child: ChildProcess | undefined;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private idleTimer: NodeJS.Timeout | undefined;
  private buffer = "";
  private stderrTail = "";

  constructor(private readonly opts: ChildProcessWorkerOptions) {}

  convert(
    params: Parameters<ConvertWorker["convert"]>[0],
    opts: ConvertCallOptions = {},
  ): Promise<ConvertResult> {
    const parsed = WORKER_METHODS.convert.params.parse(params);
    return this.request("convert", parsed, opts) as Promise<ConvertResult>;
  }

  health(): Promise<HealthResult> {
    return this.request("health", {}, {}) as Promise<HealthResult>;
  }

  async close(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const child = this.child;
    if (!child) return;
    await this.kill(child, new WorkerTransientError("worker was closed"));
  }

  private ensureChild(): ChildProcess {
    if (this.child) return this.child;
    const child = spawn(this.opts.command, this.opts.args ?? [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...this.opts.env },
      ...(this.opts.cwd ? { cwd: this.opts.cwd } : {}),
    });
    this.child = child;
    this.buffer = "";
    this.stderrTail = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => this.onData(chunk));
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-2000);
    });
    child.stdin?.on("error", () => {
      // EPIPE: the exit handler fails the pending requests
    });
    child.on("error", (err) => this.onExit(child, `could not start: ${err.message}`));
    child.on("exit", (code, signal) =>
      this.onExit(child, `exited with ${signal ?? `code ${code}`}`),
    );
    return child;
  }

  private request(
    method: keyof typeof WORKER_METHODS,
    params: unknown,
    opts: ConvertCallOptions,
  ): Promise<unknown> {
    if (opts.signal?.aborted) return Promise.reject(abortError());
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const child = this.ensureChild();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeoutMs = this.opts.requestTimeoutMs ?? 30 * 60_000;
      const timeout = setTimeout(() => {
        void this.kill(
          child,
          new WorkerTransientError(`worker request ${method} timed out after ${timeoutMs} ms`),
        );
      }, timeoutMs);
      const onAbort = (): void => {
        void this.kill(child, abortError());
      };
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, {
        method,
        resolve,
        reject,
        onProgress: opts.onProgress,
        cleanup: () => {
          clearTimeout(timeout);
          opts.signal?.removeEventListener("abort", onAbort);
        },
      });
      child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const nl = this.buffer.indexOf("\n");
      if (nl < 0) return;
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line) this.onMessage(line);
    }
  }

  private onMessage(line: string): void {
    let msg: {
      id?: number;
      method?: string;
      params?: { progress?: number; message?: string; id?: number };
      result?: unknown;
      error?: { code?: number; message?: string; data?: { retryable?: boolean } };
    };
    try {
      msg = JSON.parse(line);
    } catch {
      return; // stray output of a library; stdout lines that are not JSON are ignored
    }
    if (msg.method === "progress" && msg.params) {
      const target = msg.params.id !== undefined ? this.pending.get(msg.params.id) : undefined;
      const handlers = target ? [target] : [...this.pending.values()];
      for (const p of handlers) p.onProgress?.(msg.params.progress ?? 0, msg.params.message);
      return;
    }
    if (msg.id === undefined) return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    p.cleanup();
    this.scheduleIdle();
    if (msg.error) {
      const text = msg.error.message ?? "unknown worker error";
      if (msg.error.data?.retryable) p.reject(new WorkerTransientError(`worker: ${text}`));
      else
        p.reject(
          new CitegeistError({
            code: "CONVERT_FAILED",
            message: `The conversion worker failed: ${text} (method ${p.method}, code ${msg.error.code ?? "none"})`,
            fix: "Check the source file and the worker log, then run documents.convert with force.",
            recovery: "fix-and-retry",
            sideEffects: "none",
            context: { method: p.method, rpcCode: msg.error.code ?? null },
          }),
        );
      return;
    }
    const check = WORKER_METHODS[p.method].result.safeParse(msg.result);
    if (!check.success) {
      p.reject(
        new CitegeistError({
          code: "WORKER_PROTOCOL",
          message: `The worker answered ${p.method} with an invalid result: ${check.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}`,
          fix: "Update the worker to a version that matches packages/schema/src/worker.ts.",
          recovery: "ask-human",
          context: { method: p.method },
        }),
      );
      return;
    }
    p.resolve(check.data);
  }

  private onExit(child: ChildProcess, why: string): void {
    if (this.child !== child) return;
    this.child = undefined;
    const tail = this.stderrTail.trim().split("\n").slice(-3).join(" | ");
    const err = new WorkerTransientError(
      `The conversion worker ${why}${tail ? `. Last output: ${tail}` : ""}`,
    );
    this.failAll(err);
  }

  private failAll(err: unknown): void {
    const all = [...this.pending.values()];
    this.pending.clear();
    for (const p of all) {
      p.cleanup();
      p.reject(err);
    }
  }

  private async kill(child: ChildProcess, reason: unknown): Promise<void> {
    if (this.child === child) this.child = undefined;
    this.failAll(reason);
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    });
  }

  private scheduleIdle(): void {
    const idle = this.opts.idleMs ?? 60_000;
    if (idle <= 0 || this.pending.size > 0) return;
    this.idleTimer = setTimeout(() => {
      const child = this.child;
      if (child && this.pending.size === 0) void this.kill(child, new Error("idle"));
    }, idle);
    this.idleTimer.unref();
  }
}

function abortError(): Error {
  const e = new Error("The operation was cancelled");
  e.name = "AbortError";
  return e;
}

export const STUB_WORKER_PATH = fileURLToPath(new URL("./stub-worker.mjs", import.meta.url));

/** The stub worker for tests: speaks the protocol and writes a small deterministic document. */
export function createStubWorker(
  opts: { env?: NodeJS.ProcessEnv; idleMs?: number } = {},
): ChildProcessConvertWorker {
  return new ChildProcessConvertWorker({
    command: process.execPath,
    args: [STUB_WORKER_PATH],
    ...(opts.env ? { env: opts.env } : {}),
    ...(opts.idleMs !== undefined ? { idleMs: opts.idleMs } : {}),
  });
}
