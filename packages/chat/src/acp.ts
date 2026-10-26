import { type ChildProcess, spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk/unstable";
import type { BackendDefinition } from "./backends.js";
import type { AgentDriver, DriverEvent, DriverRequest, DriverUsage } from "./driver.js";
import { addressesIn, webToolOf } from "./egress.js";
import { citegeistTool, decide, pickOption, type SessionMode } from "./policy.js";
import { chatError, oneLine } from "./util.js";

/**
 * citegeist as an ACP client. One adapter process per agent serves many sessions (research
 * note, section 8.4). The client advertises no file system, no terminal and no auth capability:
 * the agent edits files with its own tools under the permission policy, and the login is the one
 * the user made with the official CLI.
 */

export interface SessionSink {
  update(update: acp.SessionUpdate): void;
  permission(req: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse>;
}

const AUTH_REQUIRED = -32000;

export interface AcpSpawn {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}

export class AcpConnection {
  private readonly sinks = new Map<string, SessionSink>();
  private stderrTail = "";
  private exited = false;
  private readonly connection: acp.ClientConnection;
  capabilities: acp.AgentCapabilities = {};

  private constructor(
    readonly backend: string,
    private readonly child: ChildProcess,
    private readonly label: string,
  ) {
    if (!child.stdin || !child.stdout) throw new Error("adapter process has no stdio");
    child.stdin.on("error", () => {});
    child.stdout.on("error", () => {});
    child.stderr?.on("data", (d) => {
      this.stderrTail = (this.stderrTail + String(d)).slice(-4000);
    });
    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    );
    this.connection = acp
      .client({ name: "citegeist" })
      .onRequest(acp.methods.client.session.requestPermission, async ({ params }) => {
        const sink = this.sinks.get(params.sessionId);
        // A request for a session nobody listens to is cancelled instead of left hanging.
        if (!sink) return { outcome: { outcome: "cancelled" } };
        return sink.permission(params);
      })
      .onNotification(acp.methods.client.session.update, ({ params }) => {
        this.sinks.get(params.sessionId)?.update(params.update);
      })
      .connect(stream);
    child.on("exit", () => {
      this.exited = true;
    });
    void this.connection.closed.then(() => {
      this.exited = true;
    });
  }

  get alive(): boolean {
    return !this.exited && !this.connection.signal.aborted;
  }

  /** Last stderr lines of the adapter, for error messages. */
  get stderr(): string {
    return this.stderrTail.trim();
  }

  static async open(
    backend: string,
    label: string,
    spec: AcpSpawn,
    timeoutMs = 60_000,
  ): Promise<AcpConnection> {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ["pipe", "pipe", "pipe"],
      // Own process group: closing the adapter also ends the agent CLI and the tools it started.
      detached: true,
    });
    const spawnFailed = new Promise<never>((_, reject) => {
      child.once("error", (err: NodeJS.ErrnoException) =>
        reject(
          chatError(
            "CHAT_AGENT_START_FAILED",
            `Could not start the ${label} adapter (${spec.command}): ${err.code ?? err.message}`,
            "Check that Node.js is installed and the command is on the PATH, then retry.",
            "do-first",
            { backend, command: spec.command },
          ),
        ),
      );
    });
    // After a failed start `child.stdin` is still set but unusable; the error handler above wins.
    spawnFailed.catch(() => {});
    const conn = new AcpConnection(backend, child, label);
    try {
      const init = conn.connection.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: { name: "citegeist", version: "0.0.0" },
      });
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              chatError(
                "CHAT_AGENT_TIMEOUT",
                `The ${label} adapter did not answer the ACP handshake within ${Math.round(timeoutMs / 1000)} seconds.`,
                "Retry. The first start downloads the adapter and can take a while.",
                "retry",
                { backend },
              ),
            ),
          timeoutMs,
        );
      });
      try {
        const res = await Promise.race([init, spawnFailed, timeout]);
        conn.capabilities = res.agentCapabilities ?? {};
      } finally {
        clearTimeout(timer);
      }
      return conn;
    } catch (err) {
      conn.close();
      throw conn.wrap(err, "start");
    }
  }

  /** Turns a protocol or process failure into an error with a fix. */
  wrap(err: unknown, what: string): Error {
    if (err instanceof Error && err.name === "CitegeistError") return err;
    if (err instanceof acp.RequestError && err.code === AUTH_REQUIRED) {
      return chatError(
        "CHAT_AGENT_LOGGED_OUT",
        `The ${this.label} agent says you are not logged in.`,
        `Log in with the official ${this.label} CLI in a terminal, then retry.`,
        "do-first",
        { backend: this.backend },
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    const tail = this.stderr ? ` Adapter output: ${oneLine(this.stderr, 300)}` : "";
    return chatError(
      "CHAT_AGENT_FAILED",
      `The ${this.label} agent failed during ${what}: ${oneLine(detail, 300)}.${tail}`,
      "Retry. If it keeps failing, check the setup of the agent in the settings.",
      "retry",
      { backend: this.backend },
    );
  }

  async newSession(req: acp.NewSessionRequest, sink: SessionSink): Promise<{ sessionId: string }> {
    // Sinks are registered by session id, which is only known after the response. The agent
    // may send updates before the response arrives, so buffer nothing and accept the race: no
    // adapter emits updates for a session before it has answered session/new.
    const res = await this.connection.agent.request(acp.methods.agent.session.new, req);
    this.sinks.set(res.sessionId, sink);
    return { sessionId: res.sessionId };
  }

  prompt(sessionId: string, text: string): Promise<acp.PromptResponse> {
    return this.connection.agent.request(acp.methods.agent.session.prompt, {
      sessionId,
      prompt: [{ type: "text", text }],
    });
  }

  cancel(sessionId: string): void {
    void this.connection.agent
      .notify(acp.methods.agent.session.cancel, { sessionId })
      .catch(() => {});
  }

  async closeSession(sessionId: string): Promise<void> {
    this.sinks.delete(sessionId);
    if (!this.alive || !this.capabilities.sessionCapabilities?.close) return;
    try {
      await this.connection.agent.request(acp.methods.agent.session.close, { sessionId });
    } catch {
      // the adapter may be shutting down
    }
  }

  private signalGroup(signal: NodeJS.Signals): void {
    try {
      if (this.child.pid !== undefined) process.kill(-this.child.pid, signal);
      else this.child.kill(signal);
    } catch {
      this.child.kill(signal);
    }
  }

  close(): void {
    this.sinks.clear();
    if (!this.exited) {
      this.signalGroup("SIGTERM");
      const kill = setTimeout(() => this.signalGroup("SIGKILL"), 2000);
      // Not cleared when the adapter exits: helpers that ignored SIGTERM still get the SIGKILL.
      kill.unref();
    }
    this.connection.close();
  }
}

/** One shared adapter process per backend, restarted when it died. */
export class AcpPool {
  private readonly open = new Map<string, Promise<AcpConnection>>();

  constructor(private readonly start: (backend: BackendDefinition) => Promise<AcpConnection>) {}

  async get(def: BackendDefinition): Promise<AcpConnection> {
    const existing = this.open.get(def.id);
    if (existing) {
      try {
        const conn = await existing;
        if (conn.alive) return conn;
      } catch {
        // fall through and start again
      }
      this.open.delete(def.id);
    }
    const started = this.start(def);
    this.open.set(def.id, started);
    try {
      return await started;
    } catch (err) {
      this.open.delete(def.id);
      throw err;
    }
  }

  async close(): Promise<void> {
    const all = [...this.open.values()];
    this.open.clear();
    for (const p of all) {
      try {
        (await p).close();
      } catch {
        // failed to start anyway
      }
    }
  }
}

// Driver ---------------------------------------------------------------------------------------

const STATUS: Record<string, "pending" | "running" | "done" | "failed"> = {
  pending: "pending",
  in_progress: "running",
  completed: "done",
  failed: "failed",
};

export class AcpDriver implements AgentDriver {
  readonly transport = "acp";
  private readonly calls = new Map<
    string,
    { title: string; kind: string; tool?: string; input?: unknown; search?: boolean }
  >();
  /** Addresses of web search results: what a research job may fetch besides scholarly hosts. */
  private readonly seenUrls = new Set<string>();
  private sink: ((event: DriverEvent) => void) | undefined;
  private cancelled = false;
  /** Cumulative price of the session as of the last usage update, to turn it into per-turn prices. */
  private costSeen = 0;
  private turnCost: number | undefined;
  /** Context size at the last usage update, and the tokens the turn added to it. */
  private contextSeen = 0;
  private turnAdded = 0;

  private constructor(
    private readonly conn: AcpConnection,
    private readonly sessionId: string,
    private readonly mode: SessionMode,
    private readonly isolated: boolean,
    private readonly paths: { libraryRoot: string; cwd: string },
  ) {}

  static async create(
    conn: AcpConnection,
    def: BackendDefinition,
    req: DriverRequest,
  ): Promise<AcpDriver> {
    const extraDirs =
      req.directEdits && conn.capabilities.sessionCapabilities?.additionalDirectories
        ? [req.libraryRoot]
        : [];
    // The driver is needed inside the sink, which is needed to open the session.
    let driver: AcpDriver | undefined;
    const sink: SessionSink = {
      update: (u) => driver?.onUpdate(u),
      permission: (r) =>
        driver
          ? driver.onPermission(r)
          : Promise.resolve({ outcome: { outcome: "cancelled" } as const }),
    };
    const meta = def.sessionMeta?.(req.isolated);
    try {
      const { sessionId } = await conn.newSession(
        {
          cwd: req.cwd,
          mcpServers: req.mcpServers,
          ...(extraDirs.length > 0 ? { additionalDirectories: extraDirs } : {}),
          ...(meta ? { _meta: meta } : {}),
        },
        sink,
      );
      driver = new AcpDriver(conn, sessionId, req.mode, req.isolated, {
        libraryRoot: req.libraryRoot,
        cwd: req.cwd,
      });
      return driver;
    } catch (err) {
      throw conn.wrap(err, "session setup");
    }
  }

  private emit(event: DriverEvent): void {
    this.sink?.(event);
  }

  private onUpdate(update: acp.SessionUpdate): void {
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        if (update.content.type === "text") this.emit({ type: "text", text: update.content.text });
        break;
      case "tool_call":
      case "tool_call_update": {
        const prev = this.calls.get(update.toolCallId);
        const title = update.title ?? prev?.title ?? update.name ?? "tool";
        const kind = update.kind ?? prev?.kind ?? "other";
        const tool = citegeistTool({ name: update.name, title, _meta: update._meta }) ?? prev?.tool;
        const input = update.rawInput ?? prev?.input;
        const search =
          prev?.search === true ||
          webToolOf({
            name: update.name,
            title,
            kind,
            rawInput: input,
            _meta: update._meta,
          }) === "search";
        // Only the hits of a web search count. Text of a fetched page may name any address.
        if (search) {
          for (const url of addressesIn(update.rawOutput, update.content)) this.seenUrls.add(url);
        }
        this.calls.set(update.toolCallId, {
          title,
          kind,
          ...(tool ? { tool } : {}),
          input,
          search,
        });
        this.emit({
          type: "tool",
          callId: update.toolCallId,
          title,
          kind,
          status: STATUS[update.status ?? "pending"] ?? "pending",
          ...(tool ? { tool } : {}),
          ...(input !== undefined ? { input } : {}),
          ...(update.rawOutput !== undefined ? { output: update.rawOutput } : {}),
        });
        break;
      }
      case "usage_update": {
        const total = update.cost?.currency === "USD" ? update.cost.amount : undefined;
        let delta: number | undefined;
        if (total !== undefined) {
          // The price is cumulative for the session. A smaller value means the agent started over.
          delta = total >= this.costSeen ? total - this.costSeen : total;
          this.costSeen = total;
          this.turnCost = (this.turnCost ?? 0) + delta;
        }
        // Growth of the context is what the turn read and wrote anew; a drop is a compaction.
        this.turnAdded += Math.max(0, update.used - this.contextSeen);
        this.contextSeen = update.used;
        const model = update._meta?.["_claude/model"];
        this.emit({
          type: "usage",
          contextTokens: update.used,
          ...(delta !== undefined ? { costUsd: delta } : {}),
          ...(typeof model === "string" ? { model } : {}),
        });
        break;
      }
      default:
        break;
    }
  }

  private async onPermission(
    req: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    if (this.cancelled) return { outcome: { outcome: "cancelled" } };
    const verdict = decide(req, {
      mode: this.mode,
      isolated: this.isolated,
      libraryRoot: this.paths.libraryRoot,
      scratchDir: this.paths.cwd,
      seenUrls: this.seenUrls,
    });
    const option = pickOption(req.options, verdict.allow);
    if (!verdict.allow) {
      this.emit({
        type: "notice",
        level: "info",
        text: verdict.reason ?? "The agent asked for something citegeist does not allow.",
      });
    }
    if (!option) return { outcome: { outcome: "cancelled" } };
    return { outcome: { outcome: "selected", optionId: option.optionId } };
  }

  async prompt(
    text: string,
    sink: (event: DriverEvent) => void,
    signal: AbortSignal,
  ): Promise<{ stopReason: string; usage?: DriverUsage | undefined }> {
    this.sink = sink;
    this.cancelled = false;
    this.turnCost = undefined;
    this.turnAdded = 0;
    const onAbort = () => {
      this.cancelled = true;
      this.conn.cancel(this.sessionId);
    };
    if (signal.aborted) onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      const res = await this.conn.prompt(this.sessionId, text);
      const usage = this.turnUsage(res.usage);
      return { stopReason: res.stopReason, ...(usage ? { usage } : {}) };
    } catch (err) {
      if (this.cancelled) {
        const usage = this.turnUsage(undefined);
        return { stopReason: "cancelled", ...(usage ? { usage } : {}) };
      }
      throw this.conn.wrap(err, "the turn");
    } finally {
      signal.removeEventListener("abort", onAbort);
      this.sink = undefined;
    }
  }

  /**
   * What the turn used. The response carries exact token counts when the adapter sends them. If
   * not, the tokens the context grew by stand in for the input, and only the price is exact.
   */
  private turnUsage(
    reported:
      | {
          inputTokens: number;
          outputTokens: number;
          cachedReadTokens?: number | null | undefined;
          cachedWriteTokens?: number | null | undefined;
        }
      | null
      | undefined,
  ): DriverUsage | undefined {
    const costUsd = this.turnCost === undefined ? {} : { costUsd: this.turnCost };
    if (reported) {
      return {
        inputTokens: reported.inputTokens,
        outputTokens: reported.outputTokens,
        cacheReadTokens: reported.cachedReadTokens ?? 0,
        cacheWriteTokens: reported.cachedWriteTokens ?? 0,
        ...costUsd,
      };
    }
    if (this.turnCost === undefined && this.turnAdded === 0) return undefined;
    return {
      inputTokens: this.turnAdded,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      ...costUsd,
    };
  }

  async close(): Promise<void> {
    await this.conn.closeSession(this.sessionId);
  }
}
