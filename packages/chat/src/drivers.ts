import { mkdirSync } from "node:fs";
import { AcpConnection, AcpDriver, AcpPool } from "./acp.js";
import { agentEnv, type BackendDefinition, DEFAULT_BACKENDS, findExecutable } from "./backends.js";
import type { AgentDriver, DriverFactory, DriverRequest } from "./driver.js";
import { ClaudePrintDriver } from "./print-driver.js";
import { chatError, oneLine } from "./util.js";

export interface DriverFactoryOptions {
  /** Where the adapter processes run. Created when missing. */
  workspaceRoot: string;
  backends?: readonly BackendDefinition[];
  find?: (name: string) => string | undefined;
  /** Environment for spawned agents. Default: the process environment through the scrub. */
  env?: () => Record<string, string>;
  handshakeTimeoutMs?: number;
}

export interface Drivers {
  factory: DriverFactory;
  definition(id: string): BackendDefinition | undefined;
  definitions(): readonly BackendDefinition[];
  close(): Promise<void>;
}

/** Errors after which the streaming fallback makes sense: the adapter did not come up. */
const FALLBACK_CODES = new Set([
  "CHAT_AGENT_START_FAILED",
  "CHAT_AGENT_TIMEOUT",
  "CHAT_AGENT_FAILED",
]);

export function createDrivers(opts: DriverFactoryOptions): Drivers {
  const backends = opts.backends ?? DEFAULT_BACKENDS;
  const find = opts.find ?? ((name) => findExecutable(name));
  const env = opts.env ?? (() => agentEnv());
  mkdirSync(opts.workspaceRoot, { recursive: true });

  const pool = new AcpPool(async (def) => {
    const launch = def.launch(find);
    if (!launch) {
      throw chatError(
        "CHAT_AGENT_UNAVAILABLE",
        `The ${def.label} adapter cannot be started because its launcher was not found.`,
        def.cli.installHint,
        "do-first",
        { backend: def.id },
      );
    }
    return AcpConnection.open(
      def.id,
      def.label,
      {
        command: launch.command,
        args: launch.args,
        env: { ...env(), ...(launch.env ?? {}) },
        cwd: opts.workspaceRoot,
      },
      opts.handshakeTimeoutMs,
    );
  });

  const printDriver = (
    def: BackendDefinition,
    req: DriverRequest,
    note: string,
  ): AgentDriver | undefined => {
    const claude = find(def.cli.command);
    if (!claude) return undefined;
    return new ClaudePrintDriver({ command: claude, env: env(), req, note });
  };

  const factory: DriverFactory = async (backend, req) => {
    const def = backends.find((b) => b.id === backend);
    if (!def) {
      throw chatError(
        "CHAT_UNKNOWN_BACKEND",
        `No chat backend named ${backend}.`,
        `Use one of: ${backends.map((b) => b.id).join(", ")}.`,
        "fix-and-retry",
        { backend },
      );
    }
    if (!def.launch(find)) {
      const fallback = def.fallback === "claude-print" ? printDriver(def, req, "") : undefined;
      if (fallback) return fallback;
      throw chatError(
        "CHAT_AGENT_UNAVAILABLE",
        `${def.label} is not available: the ACP adapter cannot be launched.`,
        def.cli.installHint,
        "do-first",
        { backend },
      );
    }
    try {
      const conn = await pool.get(def);
      return await AcpDriver.create(conn, def, req);
    } catch (err) {
      const code = (err as { detail?: { code?: string } }).detail?.code;
      if (def.fallback === "claude-print" && code && FALLBACK_CODES.has(code)) {
        const note = `The ACP adapter did not start (${oneLine(err instanceof Error ? err.message : String(err), 120)}). Using claude -p instead.`;
        const fallback = printDriver(def, req, note);
        if (fallback) return fallback;
      }
      throw err;
    }
  };

  return {
    factory,
    definition: (id) => backends.find((b) => b.id === id),
    definitions: () => backends,
    close: () => pool.close(),
  };
}
