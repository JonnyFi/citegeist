import { aiErrors } from "./errors.js";
import { classifyFailure, FAILURE_CODES } from "./failure.js";
import { BackendHealth } from "./health.js";
import {
  type FallbackInfo,
  type RunTaskOptions,
  runTask,
  type TaskName,
  type TaskOutput,
  type TaskResult,
  type UsageRecord,
} from "./tasks/registry.js";
import type { InferenceBackend } from "./types.js";

/** Settings: which backend id serves which task. `"*"` is the fallback for tasks without an entry. */
export interface AiRoutingSettings {
  routing: Record<string, string>;
  /**
   * Backend ids to try, in this order, when the one the routing names hits a limit, is overloaded
   * or is not logged in. Content errors never fall back. Unset or empty: no fallback.
   */
  fallback?: string[] | undefined;
}

/** Backend id for a task: exact task entry, then `"*"`, otherwise undefined. */
export function resolveBackendId(settings: AiRoutingSettings, task: string): string | undefined {
  return settings.routing[task] ?? settings.routing["*"];
}

/**
 * The language of AI texts follows the chain item (reader dropdown), project, library
 * default. The first defined, non-empty value wins.
 */
export function resolveLanguage(chain: {
  item?: string | undefined;
  project?: string | undefined;
  library: string;
}): string {
  return chain.item || chain.project || chain.library;
}

export interface AiRouterOptions {
  /** Which backends rest after a failure. Share one instance across routers to keep the state. */
  health?: BackendHealth;
}

/**
 * Holds the configured backends and sends each task to the one the settings name. When that
 * backend runs into a limit, is overloaded or is logged out, the task moves on to the next entry
 * of `fallback`, and the failed backend is skipped by later tasks until its pause ends.
 */
export class AiRouter {
  private readonly backends = new Map<string, InferenceBackend>();
  readonly health: BackendHealth;

  constructor(
    backends: InferenceBackend[],
    private settings: AiRoutingSettings,
    opts: AiRouterOptions = {},
  ) {
    for (const b of backends) this.backends.set(b.id, b);
    this.health = opts.health ?? new BackendHealth();
  }

  updateSettings(settings: AiRoutingSettings): void {
    this.settings = settings;
  }

  backendFor(task: string): InferenceBackend {
    const id = resolveBackendId(this.settings, task);
    if (!id) {
      throw aiErrors.notConfigured(
        `Backend for task ${task}`,
        `Add a routing entry for ${task} or "*" in the AI settings.`,
      );
    }
    const backend = this.backends.get(id);
    if (!backend) throw aiErrors.unknownBackend(id, [...this.backends.keys()]);
    return backend;
  }

  /** The routed backend first, then the fallback entries that exist, each once. */
  private chain(task: string): InferenceBackend[] {
    const primaryId = resolveBackendId(this.settings, task);
    const fallback = (this.settings.fallback ?? []).filter((id) => id !== primaryId);
    const rest = [...new Set(fallback)].flatMap((id) => {
      const b = this.backends.get(id);
      return b ? [b] : [];
    });
    const primary = primaryId ? this.backends.get(primaryId) : undefined;
    if (!primary && rest.length === 0) this.backendFor(task);
    return primary ? [primary, ...rest] : rest;
  }

  async run<N extends TaskName>(
    task: N,
    input: unknown,
    opts: RunTaskOptions = {},
  ): Promise<TaskResult<TaskOutput<N>>> {
    const chain = this.chain(task);
    const first = chain[0] as InferenceBackend;
    // Paused backends are skipped. When all of them are paused, the pauses may be stale (the user
    // topped up or logged in), so the chain is tried in order and a failure pauses it again.
    const open = chain.filter((b) => !this.health.get(b.id));
    const order = open.length > 0 ? open : chain;

    let note: FallbackInfo | undefined;
    const firstPause = this.health.get(first.id);
    const start = order[0];
    if (start && start !== first && firstPause) {
      note = {
        task,
        from: first.id,
        to: start.id,
        kind: firstPause.kind,
        resetAt: new Date(firstPause.until),
      };
    }

    let lastError: unknown;
    for (const [i, backend] of order.entries()) {
      if (opts.signal?.aborted) throw aiErrors.cancelled(backend.id, task);
      if (note) opts.onFallback?.(note);
      let record: UsageRecord | undefined;
      try {
        const result = await runTask(backend, task, input, {
          ...opts,
          record: (r) => {
            record = r;
          },
        });
        if (record) opts.record?.(record);
        return note ? { ...result, via: { from: note.from, kind: note.kind } } : result;
      } catch (err) {
        const failure = classifyFailure(err, new Date(this.health.now()));
        if (record) {
          opts.record?.(
            failure.kind === "other" ? record : { ...record, error: FAILURE_CODES[failure.kind] },
          );
        }
        if (failure.kind === "other") throw err;
        this.health.pause(backend.id, failure.kind, failure.resetAt);
        lastError = err;
        const next = order[i + 1];
        note = next
          ? { task, from: backend.id, to: next.id, kind: failure.kind, resetAt: failure.resetAt }
          : undefined;
      }
    }
    throw lastError;
  }
}
