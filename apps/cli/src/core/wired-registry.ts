import { createRuntime, Library } from "@citegeist/core";
import { CONTRACTS, defineContract, Registry } from "@citegeist/ops";
import { CitegeistError } from "@citegeist/schema";
import { z } from "zod";
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
  registry: Registry;
}

/**
 * A Registry that lists every contract and opens the library in this process on first use. The
 * CLI builds its commands before any library is open, so opening has to be lazy.
 *
 * Write and admin operations are refused while core.lock names a live process: the app owns the
 * library then. Forwarding to the running core replaces the refusal later.
 */
export function createWiredRegistry(env: NodeJS.ProcessEnv, options: WiredOptions = {}): Registry {
  const localBase = env.CITEGEIST_LOCAL_BASE || undefined;
  let opened: Promise<OpenCore> | undefined;

  const open = (): Promise<OpenCore> => {
    opened ??= (async () => {
      const where = resolveLibraryPath(env, options.library);
      try {
        const lib = await Library.open(where.path, {
          watch: false,
          ...(localBase ? { localBase } : {}),
        });
        return {
          lib,
          registry: createRuntime(lib, { autoStart: options.longLived ?? false }).registry,
        };
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
