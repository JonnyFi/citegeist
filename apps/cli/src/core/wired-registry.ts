import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRuntime, defaultLocalBase, Library, LocalPaths } from "@citegeist/core";
import { CONTRACTS, defineContract, Registry } from "@citegeist/ops";
import { CitegeistError } from "@citegeist/schema";
import { bindImport, type CoreServer, LockHeldError, startCoreServer } from "@citegeist/server";
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
  /** Set when this process serves the library to others (`cg mcp`): it holds core.lock. */
  server?: CoreServer;
}

/** How long a call waits for another process that has just taken the lock to publish its port. */
const LOCK_WAIT_MS = 15_000;

/** What a caller can do with the registry besides calling operations. */
export interface RegistryControls {
  /**
   * Opens the library in this process now, unless another core serves it. `cg mcp` calls it at
   * start, so the watcher indexes external edits from the first minute on, and the lock is taken
   * before anyone else opens a second writer.
   */
  warm(): Promise<void>;
  /** Stops the watcher and the job queue of a library this process opened and releases its lock. */
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
 * While a core serves the library (core.lock names a live process, core.token and a health call
 * confirm it), every call is forwarded to it over HTTP on 127.0.0.1, so there is only one writer.
 * Without one, the library opens in this process. A long-lived process (`cg mcp`) opens it as a
 * core of its own: it takes core.lock and serves the same HTTP endpoint, so the desktop app that
 * starts later attaches to it. One-shot commands do not take the lock. If a core owns the lock but
 * cannot be reached, writes are refused and reads run in this process.
 */
export function createWiredRegistry(env: NodeJS.ProcessEnv, options: WiredOptions = {}): Registry {
  const localBase = env.CITEGEIST_LOCAL_BASE || undefined;
  const where = resolveLibraryPath(env, options.library);
  let opened: Promise<OpenCore> | undefined;
  /** True after another process turned out to hold the lock without answering: read-only fallback. */
  let degraded = false;

  /** A running app core for this library, if there is one. Checked on every call, because the app can start and quit at any time. */
  const runningCore = async (): Promise<RunningCore | undefined> => {
    const id = libraryIdAt(where.path);
    if (!id) return undefined;
    return findRunningCore(new LocalPaths(localBase ?? defaultLocalBase(), id).dir);
  };

  const open = (): Promise<OpenCore> => {
    opened ??= (async () => {
      try {
        if (options.longLived && !degraded) {
          const server = await startCoreServer({
            library: where.path,
            ...(localBase ? { localBase } : {}),
          });
          return {
            lib: server.library,
            runtime: server.runtime,
            registry: server.registry,
            server,
          };
        }
        const lib = await Library.open(where.path, {
          watch: false,
          ...(localBase ? { localBase } : {}),
        });
        const runtime = createRuntime(lib, { autoStart: false });
        bindImport(runtime, lib);
        return { lib, runtime, registry: runtime.registry };
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

  /** Waits for the core that holds the lock to publish its port, or gives up. */
  const waitForCore = async (): Promise<RunningCore | undefined> => {
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      const found = await runningCore();
      if (found || Date.now() >= deadline) return found;
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  /**
   * This process as a core, or the core that won the race for the lock. A holder that has a port
   * but does not answer is not waited for: the library opens here without the lock, and write
   * operations are refused by the check in the handler below.
   */
  const openOrForward = async (): Promise<{ core?: OpenCore; app?: RunningCore }> => {
    try {
      return { core: await open() };
    } catch (err) {
      if (!(err instanceof LockHeldError)) throw err;
      const app = err.holder.port === 0 ? await waitForCore() : await runningCore();
      if (app) return { app };
      degraded = true;
      return { core: await open() };
    }
  };

  const registry = new Registry();
  for (const contract of CONTRACTS) {
    registry.bind(contract, async (ctx, input) => {
      let app = await runningCore();
      let core: OpenCore | undefined;
      if (!app) ({ core, app } = await openOrForward());
      if (app) {
        if (contract.access !== "read" && ctx.actor !== "human" && !app.actors) {
          throw actorNotForwardable(contract.name, app);
        }
        return forwardCall(app, contract.name, ctx.actor, input);
      }
      if (!core) throw new Error("no library open");
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
      if (!(await runningCore())) await openOrForward();
    },
    async close() {
      const core = await opened?.catch(() => undefined);
      opened = undefined;
      if (!core) return;
      if (core.server) return core.server.close();
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
