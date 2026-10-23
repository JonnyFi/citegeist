import { createFixtureRegistry } from "@citegeist/mcp";
import type { Registry } from "@citegeist/ops";
import { createWiredRegistry, type WiredOptions } from "./core/wired-registry.js";

export { libraryFlagFromArgv, resolveLibraryPath } from "./core/library-path.js";
export { libraryInit, registryControls } from "./core/wired-registry.js";

/**
 * The one place where the CLI gets its Registry. Everything else in the CLI is generated from
 * whatever Registry this returns.
 *
 * The library is resolved from `options.library` (the `--library` flag), CITEGEIST_LIBRARY, then
 * ~/Citegeist, and opened in this process on first use. CITEGEIST_FIXTURE=1 selects an in-memory
 * registry with sample data, for tests.
 */
export function createRegistry(
  env: NodeJS.ProcessEnv = process.env,
  options: WiredOptions = {},
): Registry {
  if (env.CITEGEIST_FIXTURE === "1") return createFixtureRegistry();
  return createWiredRegistry(env, options);
}
