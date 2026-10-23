import { join } from "node:path";
import { nodeRunner, type ProcessRunner } from "@citegeist/ai";
import type { ConvertWorker } from "../ingest/worker.js";
import type { JobQueue } from "../jobs/queue.js";
import { BackendRegistry, type FetchFn } from "./backends.js";
import { InMemoryKeychain, type Keychain, MacKeychain } from "./keychain.js";
import type { SettingsDeps } from "./service.js";
import { SettingsStore } from "./store.js";
import { defaultEnvDir } from "./worker-setup.js";

export interface DefaultSettingsOptions {
  /** Machine-local base directory (`~/Library/Application Support/citegeist`). */
  localBase: string;
  queue: JobQueue;
  /** The worker the ingest pipeline uses. It must run inside the managed environment. */
  worker: ConvertWorker;
  /** Directory of workers/convert (pyproject.toml, uv.lock). */
  workerSource: string;
  runner?: ProcessRunner;
  /** Default: the macOS Keychain on darwin, otherwise memory only (keys vanish on exit). */
  keychain?: Keychain;
  fetch?: FetchFn;
  onChange?: SettingsDeps["onChange"];
}

/**
 * Production wiring of the settings operations: real process runner, Keychain, a settings file at
 * `<localBase>/settings.json` and the Python environment at `<localBase>/worker/venv`.
 */
export function createSettingsDeps(opts: DefaultSettingsOptions): SettingsDeps {
  const runner = opts.runner ?? nodeRunner;
  const keychain =
    opts.keychain ??
    (process.platform === "darwin" ? new MacKeychain({ runner }) : new InMemoryKeychain());
  return {
    store: new SettingsStore(join(opts.localBase, "settings.json")),
    keychain,
    backends: new BackendRegistry({
      runner,
      keychain,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    }),
    queue: opts.queue,
    worker: opts.worker,
    workerConfig: { sourceDir: opts.workerSource, envDir: defaultEnvDir(opts.localBase) },
    runner,
    ...(opts.onChange ? { onChange: opts.onChange } : {}),
  };
}
