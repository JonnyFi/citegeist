import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@agentclientprotocol/sdk";
import { SCHOLARLY_HOSTS } from "@citegeist/ops";
import type { AgentDriver, DriverEvent, DriverRequest } from "./driver.js";
import { citegeistTool } from "./policy.js";
import { chatError, oneLine } from "./util.js";

/**
 * Fallback for Claude Code when the ACP adapter cannot start: `claude -p` with streaming JSON
 * output, one process per turn, the conversation continued with `--resume`. In the sandbox (A11)
 * it keeps the isolation (no user settings, only citegeist's MCP server, no shell). Otherwise it
 * loads the settings of the user and the project, which bring the user's MCP servers, and allows
 * the shell. It cannot ask for permissions, so tools outside the allow list are simply denied.
 */

export interface PrintDriverOptions {
  command: string;
  env: Record<string, string>;
  req: DriverRequest;
  /** Shown once, before the first answer. */
  note?: string;
}

/** Claude Code's MCP config for the servers ACP would have received. */
export function mcpConfigJson(servers: readonly McpServer[]): string {
  const out: Record<string, unknown> = {};
  for (const s of servers) {
    if ("command" in s) {
      out[s.name] = {
        command: s.command,
        args: s.args,
        env: Object.fromEntries(s.env.map((e) => [e.name, e.value])),
      };
    } else {
      out[s.name] = {
        type: "type" in s && s.type === "sse" ? "sse" : "http",
        url: s.url,
        headers: Object.fromEntries(s.headers.map((h) => [h.name, h.value])),
      };
    }
  }
  return JSON.stringify({ mcpServers: out });
}

const TOOL_KIND: Array<[RegExp, string]> = [
  [/^(Edit|Write|MultiEdit|NotebookEdit)$/, "edit"],
  [/^(Read|NotebookRead)$/, "read"],
  [/^(Grep|Glob|WebSearch|LS)$/, "search"],
  [/^WebFetch$/, "fetch"],
  [/^(Bash|BashOutput|KillShell)$/, "execute"],
];

function describeInput(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const o = input as Record<string, unknown>;
  for (const key of ["file_path", "path", "url", "query", "pattern", "command"]) {
    if (typeof o[key] === "string") return oneLine(o[key] as string, 120);
  }
  return undefined;
}

interface StreamLine {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  event?: { type?: string; delta?: { type?: string; text?: string } };
  message?: { content?: unknown };
}

interface Block {
  type?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

const LOGGED_OUT = /not logged in|please run \/login|invalid api key|authentication/i;

export class ClaudePrintDriver implements AgentDriver {
  readonly transport = "claude-print";
  private readonly id = randomUUID();
  private started = false;
  private noted = false;
  private configDir: string | undefined;
  private readonly names = new Map<string, { title: string; kind: string; tool?: string }>();

  constructor(private readonly opts: PrintDriverOptions) {}

  async close(): Promise<void> {
    // One process per turn: nothing stays alive between turns. Only the MCP config is left.
    if (this.configDir) rmSync(this.configDir, { recursive: true, force: true });
    this.configDir = undefined;
  }

  /**
   * Path of the MCP config of this session. It holds the session's bearer token, so it goes into
   * a file with mode 0600 in a private folder (mode 0700) instead of the command line, where
   * every process of the system could read it with `ps` (M6). `close` removes it.
   */
  configFile(): string {
    if (!this.configDir) {
      this.configDir = mkdtempSync(join(tmpdir(), "citegeist-mcp-"));
      chmodSync(this.configDir, 0o700);
    }
    const file = join(this.configDir, "mcp.json");
    writeFileSync(file, mcpConfigJson(this.opts.req.mcpServers), { mode: 0o600 });
    chmodSync(file, 0o600);
    return file;
  }

  /** The arguments of one `claude -p` call. `mcpConfig` is the path of the MCP config file. */
  buildArgs(mcpConfig: string): string[] {
    const { req } = this.opts;
    const research = req.mode === "research";
    const common = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--mcp-config",
      mcpConfig,
      "--permission-mode",
      "acceptEdits",
    ];
    // `claude -p` cannot ask for permission, so a research job gets the web search and the web
    // fetch of the scholarly hosts only. The ACP route also allows the addresses that a web
    // search returned, because the permission policy can check them (egress.ts, L9).
    const webFetch = research ? SCHOLARLY_HOSTS.map((h) => `WebFetch(domain:${h})`) : ["WebFetch"];
    const args = req.isolated
      ? [
          ...common,
          "--strict-mcp-config",
          "--setting-sources",
          "",
          "--disable-slash-commands",
          "--allowedTools",
          "mcp__citegeist",
          "WebSearch",
          ...webFetch,
          "--disallowedTools",
          "Bash",
          "BashOutput",
          "KillShell",
          ...(research ? ["Edit", "Write", "MultiEdit", "NotebookEdit"] : []),
        ]
      : [
          ...common,
          "--setting-sources",
          "user,project",
          "--allowedTools",
          "mcp__citegeist",
          "WebSearch",
          ...webFetch,
          "Bash",
        ];
    if (req.directEdits && !research) args.push("--add-dir", req.libraryRoot);
    args.push(this.started ? "--resume" : "--session-id", this.id);
    return args;
  }

  async prompt(
    text: string,
    sink: (event: DriverEvent) => void,
    signal: AbortSignal,
  ): Promise<{ stopReason: string }> {
    const { command, env, req } = this.opts;
    if (!this.noted && this.opts.note) {
      this.noted = true;
      sink({ type: "notice", level: "info", text: this.opts.note });
    }
    const child = spawn(command, this.buildArgs(this.configFile()), {
      cwd: req.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.started = true;
    child.stdin.on("error", () => {});
    child.stdin.end(text);

    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr = (stderr + String(d)).slice(-2000);
    });
    let cancelled = false;
    const onAbort = () => {
      cancelled = true;
      child.kill("SIGTERM");
    };
    if (signal.aborted) onAbort();
    signal.addEventListener("abort", onAbort, { once: true });

    let failure: string | undefined;
    let buffer = "";
    const handle = (line: string) => {
      let msg: StreamLine;
      try {
        msg = JSON.parse(line) as StreamLine;
      } catch {
        return;
      }
      failure = this.onLine(msg, sink) ?? failure;
    };

    const exit = new Promise<{ code: number | null; error?: string }>((resolve) => {
      child.once("error", (err: NodeJS.ErrnoException) =>
        resolve({ code: null, error: err.code ?? err.message }),
      );
      child.once("close", (code) => resolve({ code }));
    });
    child.stdout.on("data", (d) => {
      buffer += String(d);
      let nl = buffer.indexOf("\n");
      while (nl >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) handle(line);
        nl = buffer.indexOf("\n");
      }
    });

    const { code, error } = await exit;
    signal.removeEventListener("abort", onAbort);
    if (buffer.trim()) handle(buffer.trim());
    if (cancelled) return { stopReason: "cancelled" };
    if (error) {
      throw chatError(
        "CHAT_AGENT_START_FAILED",
        `Could not start \`${command}\`: ${error}`,
        "Install Claude Code and make sure `claude` is on the PATH, then retry.",
        "do-first",
      );
    }
    if (failure !== undefined || code !== 0) {
      const detail = failure ?? stderr;
      if (LOGGED_OUT.test(detail)) {
        throw chatError(
          "CHAT_AGENT_LOGGED_OUT",
          "The Claude Code CLI says you are not logged in.",
          "Run `claude auth login` in a terminal, then retry.",
          "do-first",
        );
      }
      throw chatError(
        "CHAT_AGENT_FAILED",
        `\`claude -p\` failed (exit code ${code}): ${oneLine(detail || "no output", 300)}`,
        "Retry. If it keeps failing, run `claude auth status` and update Claude Code.",
        "retry",
      );
    }
    return { stopReason: "end_turn" };
  }

  /** Handles one stream line. Returns an error text when the line reports a failure. */
  private onLine(msg: StreamLine, sink: (event: DriverEvent) => void): string | undefined {
    if (msg.type === "stream_event") {
      const d = msg.event?.delta;
      if (msg.event?.type === "content_block_delta" && d?.type === "text_delta" && d.text) {
        sink({ type: "text", text: d.text });
      }
      return undefined;
    }
    if (msg.type === "assistant" || msg.type === "user") {
      const content = msg.message?.content;
      if (!Array.isArray(content)) return undefined;
      for (const raw of content as Block[]) {
        if (raw.type === "tool_use" && raw.id && raw.name) {
          const kind = TOOL_KIND.find(([re]) => re.test(raw.name as string))?.[1] ?? "other";
          const tool = citegeistTool({ name: raw.name });
          const detail = describeInput(raw.input);
          const title = detail ? `${raw.name} ${detail}` : raw.name;
          this.names.set(raw.id, { title, kind, ...(tool ? { tool } : {}) });
          sink({
            type: "tool",
            callId: raw.id,
            title,
            kind,
            status: "running",
            ...(tool ? { tool } : {}),
            input: raw.input,
          });
        } else if (raw.type === "tool_result" && raw.tool_use_id) {
          const known = this.names.get(raw.tool_use_id);
          sink({
            type: "tool",
            callId: raw.tool_use_id,
            title: known?.title ?? "tool",
            kind: known?.kind ?? "other",
            status: raw.is_error ? "failed" : "done",
            ...(known?.tool ? { tool: known.tool } : {}),
            output: raw.content,
          });
        }
      }
      return undefined;
    }
    if (msg.type === "result" && msg.is_error) return msg.result ?? "the CLI reported an error";
    return undefined;
  }
}
