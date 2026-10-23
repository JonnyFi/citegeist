import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface ResolvedLibraryPath {
  path: string;
  source: "flag" | "env" | "default";
}

function expand(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return resolve(p);
}

/** Library folder: `--library`, then CITEGEIST_LIBRARY, then ~/Citegeist. */
export function resolveLibraryPath(
  env: NodeJS.ProcessEnv,
  flag?: string | undefined,
): ResolvedLibraryPath {
  if (flag) return { path: expand(flag), source: "flag" };
  if (env.CITEGEIST_LIBRARY) return { path: expand(env.CITEGEIST_LIBRARY), source: "env" };
  return { path: join(homedir(), "Citegeist"), source: "default" };
}

/** Reads `--library <path>` or `--library=<path>` from an argument list, for callers that parse argv themselves. */
export function libraryFlagFromArgv(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--library") return argv[i + 1];
    if (a?.startsWith("--library=")) return a.slice("--library=".length);
  }
  return undefined;
}
