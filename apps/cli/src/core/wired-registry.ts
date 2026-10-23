import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRuntime, defaultLocalBase, Library, LocalPaths } from "@citegeist/core";
import { bindLinkOperations } from "@citegeist/mcp/links";
import { CONTRACTS, defineContract, Registry } from "@citegeist/ops";
import { CitegeistError } from "@citegeist/schema";
import { z } from "zod";
import { actorNotForwardable, findRunningCore, forwardCall, type RunningCore } from "./forward.js";
import { resolveLibraryPath } from "./library-path.js";
import { liveForeignLock, ownedByApp } from "./lock.js";

export interface WiredOptions {
  /** Value of the `--library` flag, if the caller parsed one. */
  library?: string | undefined;
  /** `cg mcp` keeps running and executes background jobs; one-shot commands only enqueue them. */
  longLived?: boolean;
}

/**
 * `cg init <path>`: a local CLI command. It is not part of the shared contracts (no MCP tool, no
 * RPC procedure), it only rides on the Registry so the command is generated like the others.
 */
export const libraryInit = defineContract({
  name: "library.init",
  summary: "Create a new library folder with manifest and agent rules",
  access: "admin",
  cli: ["init"],
  input: z.object({
    path: z.string().min(1).describe("folder of the new library"),
    name: z.string().min(1).optional().describe("library name, default: folder name"),
  }),
  output: z.object({ path: z.string(), id: z.string(), name: z.string() }),
});

interface OpenCore {
  lib: Library;
  runtime: ReturnType<typeof createRuntime>;
  registry: Registry;
}

/** What a caller can do with the registry besides calling operations. */
export interface RegistryControls {
  /**
   * Opens the library in this process now, unless an app core serves it. `cg mcp` calls it at
   * start, so the watcher indexes external edits from the first minute on.
   */
  warm(): Promise<void>;
  /** Stops the watcher and the job queue of a library this process opened. */
  close(): Promise<void>;
}

const controls = new WeakMap<Registry, RegistryControls>();

/** Controls of a registry built by createWiredRegistry; no-ops for any other registry. */
export function registryControls(registry: Registry): RegistryControls {
  return controls.get(registry) ?? { warm: async () => {}, close: async () => {} };
}

/** Id of the library at `path`, read from its manifest, or undefined if it is not one. */
function libraryIdAt(path: string): string | undefined {
  try {
    const manifest = JSON.parse(readFileSync(join(path, "citegeist.json"), "utf8")) as {
      id?: unknown;
    };
    return typeof manifest.id === "string" ? manifest.id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A Registry that lists every contract and opens the library in this process on first use. The
 * CLI builds its commands before any library is open, so opening has to be lazy.
 *
 * While an app core serves the library (core.lock names a live process, core.token and a health
 * call confirm it), every call is forwarded to it over HTTP on 127.0.0.1, so the app stays the
 * only writer. Without an app, the library opens in this process. If a core owns the lock but
 * cannot be reached, writes are refused and reads run in this process.
 */
export function createWiredRegistry(env: NodeJS.ProcessEnv, options: WiredOptions = {}): Registry {
  const localBase = env.CITEGEIST_LOCAL_BASE || undefined;
  const where = resolveLibraryPath(env, options.library);
  let opened: Promise<OpenCore> | undefined;

  /** A running app core for this library, if there is one. Checked on every call, because the app can start and quit at any time. */
  const runningCore = async (): Promise<RunningCore | undefined> => {
    const id = libraryIdAt(where.path);
    if (!id) return undefined;
    return findRunningCore(new LocalPaths(localBase ?? defaultLocalBase(), id).dir);
  };

  const open = (): Promise<OpenCore> => {
    opened ??= (async () => {
      try {
        const lib = await Library.open(where.path, {
          watch: options.longLived ?? false,
          ...(localBase ? { localBase } : {}),
        });
        const runtime = createRuntime(lib, { autoStart: options.longLived ?? false });
        return { lib, runtime, registry: bindLinkOperations(runtime.registry, lib) };
      } catch (err) {
        if (err instanceof CitegeistError && err.detail.code === "LIBRARY_NOT_FOUND") {
          const via =
            where.source === "flag"
              ? "--library"
              : where.source === "env"
                ? "CITEGEIST_LIBRARY"
                : "the default location";
          throw new CitegeistError({
            ...err.detail,
            message: `${err.detail.message} (path from ${via}: ${where.path})`,
            fix: `Pass an existing library with --library <path> or set CITEGEIST_LIBRARY, or create one with "cg init ${where.path}".`,
            recovery: "ask-human",
          });
        }
        throw err;
      }
    })();
    opened.catch(() => {
      opened = undefined;
    });
    return opened;
  };

  const registry = new Registry();
  for (const contract of CONTRACTS) {
    registry.bind(contract, async (ctx, input) => {
      const app = await runningCore();
      if (app) {
        if (contract.access !== "read" && ctx.actor !== "human" && !app.actors) {
          throw actorNotForwardable(contract.name, app);
        }
        return forwardCall(app, contract.name, ctx.actor, input);
      }
      const core = await open();
      if (contract.access !== "read") {
        const lock = liveForeignLock(core.lib.local.lock);
        if (lock) throw ownedByApp(contract.name, lock, core.lib.local.lock);
      }
      const entry = core.registry.get(contract.name);
      if (!entry) {
        throw new CitegeistError({
          code: "OPERATION_NOT_IMPLEMENTED",
          message: `The core in this build does not implement ${contract.name} yet.`,
          fix: "Use an operation that is implemented, or ask the user to update citegeist.",
          recovery: "ask-human",
          sideEffects: "none",
          context: { operation: contract.name },
        });
      }
      return entry.handler(ctx, input);
    });
  }

  controls.set(registry, {
    async warm() {
      if (!(await runningCore())) await open();
    },
    async close() {
      const core = await opened?.catch(() => undefined);
      opened = undefined;
      if (!core) return;
      await core.runtime.close();
      await core.lib.close();
    },
  });

  registry.bind(libraryInit, async (_ctx, input) => {
    const lib = await Library.init(resolveLibraryPath({}, input.path).path, {
      watch: false,
      ...(input.name ? { name: input.name } : {}),
      ...(localBase ? { localBase } : {}),
    });
    try {
      return { path: lib.root, id: lib.manifest.id, name: lib.manifest.name };
    } finally {
      await lib.close();
    }
  });

  return registry;
}
