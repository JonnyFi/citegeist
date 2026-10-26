import { aiErrors } from "./errors.js";
import type { TaskOutput } from "./tasks/registry.js";
import { type RunTaskOptions, runTask, type TaskName, type TaskResult } from "./tasks/registry.js";
import type { InferenceBackend } from "./types.js";

/** Settings: which backend id serves which task. `"*"` is the fallback for tasks without an entry. */
export interface AiRoutingSettings {
  routing: Record<string, string>;
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

/** Holds the configured backends and sends each task to the one the settings name. */
export class AiRouter {
  private readonly backends = new Map<string, InferenceBackend>();

  constructor(
    backends: InferenceBackend[],
    private settings: AiRoutingSettings,
  ) {
    for (const b of backends) this.backends.set(b.id, b);
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

  run<N extends TaskName>(
    task: N,
    input: unknown,
    opts?: RunTaskOptions,
  ): Promise<TaskResult<TaskOutput<N>>> {
    return runTask(this.backendFor(task), task, input, opts);
  }
}
