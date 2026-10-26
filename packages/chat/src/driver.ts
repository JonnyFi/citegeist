import type { McpServer } from "@agentclientprotocol/sdk";
import type { SessionMode } from "./policy.js";

/** What an agent turn consumed. `costUsd` is the list price when the agent reports one. */
export interface DriverUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd?: number | undefined;
  model?: string | undefined;
}

/** What a driver reports while an agent works on a turn. */
export type DriverEvent =
  | { type: "text"; text: string }
  | {
      type: "tool";
      callId: string;
      title: string;
      kind: string;
      status: "pending" | "running" | "done" | "failed";
      /** Name of the citegeist MCP tool, when the agent called one. */
      tool?: string;
      input?: unknown;
      output?: unknown;
    }
  | { type: "notice"; level: "info" | "error"; text: string; fix?: string }
  /**
   * ACP `usage_update`: how many tokens the context holds now and the price added since the last
   * update. Adapters send it rarely (Claude's once per turn), so it is no meter for a running turn.
   */
  | { type: "usage"; contextTokens: number; costUsd?: number | undefined; model?: string };

export interface DriverRequest {
  /** citegeist session id, for logs. */
  session: string;
  mode: SessionMode;
  /** Scratch directory of the session, the agent's working directory. */
  cwd: string;
  libraryRoot: string;
  mcpServers: McpServer[];
  /** Let the agent edit text files in the library directly (docs/decisions/0018-direct-agent-edits-with-undo.md). */
  directEdits: boolean;
  /**
   * False gives the agent the user's own environment (shell, the user's MCP servers and
   * settings). True is the sandbox: no shell, no user settings, only the citegeist tools.
   * Research jobs always run isolated.
   */
  isolated: boolean;
}

/** One live conversation with one agent. A driver is created per session and closed with it. */
export interface AgentDriver {
  /** Name of the transport, for diagnostics: `acp` or `claude-print`. */
  readonly transport: string;
  prompt(
    text: string,
    sink: (event: DriverEvent) => void,
    signal: AbortSignal,
  ): Promise<{ stopReason: string; usage?: DriverUsage | undefined }>;
  close(): Promise<void>;
}

export type DriverFactory = (backend: string, req: DriverRequest) => Promise<AgentDriver>;
