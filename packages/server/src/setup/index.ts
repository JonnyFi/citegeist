import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ChildProcessConvertWorker,
  type ConvertWorker,
  createSettingsDeps,
  type DefaultSettingsOptions,
  defaultEnvDir,
  managedWorkerOptions,
  type SettingsDeps,
} from "@citegeist/core";

export interface WorkerSourceOptions {
  /** Explicit override, normally the CITEGEIST_WORKER_DIR environment variable. */
  override?: string | undefined;
  /** `process.resourcesPath` in the packaged app, where electron-builder puts `workers/convert`. */
  resourcesPath?: string | undefined;
  exists?: (path: string) => boolean;
}

/** Repo root when running from source: packages/server/src/setup -> four levels up. */
function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
}

/**
 * Directory with the worker's pyproject.toml and uv.lock. Order: explicit override, the packaged
 * resources, then the repository checkout (development).
 */
export function resolveWorkerSource(opts: WorkerSourceOptions = {}): string {
  const exists = opts.exists ?? existsSync;
  const candidates = [
    opts.override,
    opts.resourcesPath ? join(opts.resourcesPath, "workers", "convert") : undefined,
  ].filter((c): c is string => Boolean(c));
  for (const dir of candidates) if (exists(join(dir, "pyproject.toml"))) return dir;
  return join(repoRoot(), "workers", "convert");
}

/** The conversion worker running inside the machine-local Python environment. */
export function createManagedWorker(localBase: string, workerSource: string): ConvertWorker {
  return new ChildProcessConvertWorker(
    managedWorkerOptions({ sourceDir: workerSource, envDir: defaultEnvDir(localBase) }),
  );
}

export interface DesktopSetupOptions
  extends Omit<DefaultSettingsOptions, "worker" | "workerSource"> {
  worker?: ConvertWorker;
  workerSource?: string;
}

/**
 * Settings dependencies for the core process of the desktop app: Keychain on macOS, settings
 * file and Python environment under the local base, worker sources from the app bundle.
 */
export function createDesktopSettingsDeps(opts: DesktopSetupOptions): SettingsDeps {
  const workerSource =
    opts.workerSource ??
    resolveWorkerSource({
      override: process.env.CITEGEIST_WORKER_DIR,
      resourcesPath: (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
    });
  return createSettingsDeps({
    ...opts,
    worker: opts.worker ?? createManagedWorker(opts.localBase, workerSource),
    workerSource,
  });
}
