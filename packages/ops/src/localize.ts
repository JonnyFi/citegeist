import type { OperationContract } from "./registry.js";

/** Where a caller meets an operation: as an MCP tool or as a `cg` command. */
export type Surface = "mcp" | "cli";

export function kebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}

/** CLI path of a contract: `cli` when set, else the name split at dots (camelCase becomes kebab-case). */
export function commandPath(contract: OperationContract): string[] {
  return contract.cli ?? contract.name.split(".").map(kebab);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Error texts are written once with the operation names (`items.trash`, `projects.create`). A
 * caller does not know those names: over MCP it sees tools (`trash_item`), on the command line it
 * types `cg items trash`. This rewrites every operation name in a text to what exists on the
 * calling surface.
 *
 * `available` limits which operations count as reachable on the surface (a read-scoped MCP
 * connection has no write tools). An operation that is not reachable becomes the `cg` command
 * with a note, so the text never names something the caller cannot call.
 */
export function localizeOperations(
  text: string,
  surface: Surface,
  contracts: readonly OperationContract[],
  available: readonly OperationContract[] = contracts,
): string {
  const names = contracts.map((c) => c.name).sort((a, b) => b.length - a.length);
  if (names.length === 0 || text.length === 0) return text;
  const byName = new Map(contracts.map((c) => [c.name, c]));
  const reachable = new Set(available.map((c) => c.name));
  const re = new RegExp(
    `(?<![A-Za-z0-9_./-])(?:${names.map(escapeRegExp).join("|")})(?![A-Za-z0-9_-])(?!\\.[A-Za-z])`,
    "g",
  );
  return text.replace(re, (name) => {
    const contract = byName.get(name);
    if (!contract) return name;
    const cli = `cg ${commandPath(contract).join(" ")}`;
    if (surface === "cli") return cli;
    if (contract.mcp && reachable.has(name)) return contract.mcp.tool;
    return `${cli} (not an MCP tool, ask the user to run it)`;
  });
}

interface ErrorText {
  message: string;
  fix: string;
}

/** `localizeOperations` for the message and the fix of an agent-ready error. */
export function localizeError<E extends ErrorText>(
  error: E,
  surface: Surface,
  contracts: readonly OperationContract[],
  available?: readonly OperationContract[],
): E {
  return {
    ...error,
    message: localizeOperations(error.message, surface, contracts, available),
    fix: localizeOperations(error.fix, surface, contracts, available),
  };
}
