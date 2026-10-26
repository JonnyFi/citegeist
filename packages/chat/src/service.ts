import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@agentclientprotocol/sdk";
import {
  type ChatContext,
  type ChatEntry,
  type ChatSessionSummary,
  type ChatTurn,
  chatChangePath,
} from "@citegeist/ops";
import { CitegeistError } from "@citegeist/schema";
import { type BackendStatus, checkBackend, findExecutable } from "./backends.js";
import type { AgentDriver, DriverEvent, DriverUsage } from "./driver.js";
import { createDrivers, type Drivers } from "./drivers.js";
import { diffSnapshots, revertEdits, SnapshotCache } from "./journal.js";
import type { SessionMode } from "./policy.js";
import { instructions, transcriptMarkdown, turnPrompt } from "./prompts.js";
import type { ResearchBudget } from "./research-budget.js";
import { ChatStore, type SessionState } from "./store.js";
import { extractCitekey, toolDetail } from "./tools.js";
import { chatError, newId, oneLine, slugify, writeAtomic } from "./util.js";

/** One finished agent turn, for the usage ledger of the host. */
export interface ChatUsageEntry {
  session: string;
  /** `chat` for a conversation, `research` for a research job. */
  kind: "chat" | "research";
  /** Chat backend id such as `claude-code`. */
  backend: string;
  /** The job a research session belongs to. */
  job?: string | undefined;
  ok: boolean;
  ms: number;
  /** Absent when the agent reported nothing. */
  usage?: DriverUsage | undefined;
}

export interface ChatHost {
  /** Absolute path of the library folder. */
  libraryRoot: string;
  /** Machine-local folder of this library (index and state live here). Chat state goes below it. */
  localDir: string;
  /** MCP servers every session gets, normally the citegeist server with a write token. */
  mcpServers(req: { session: string; mode: SessionMode }): McpServer[] | Promise<McpServer[]>;
  /**
   * Called when the agent of a session is gone (closed, replaced or crashed). The host revokes
   * what it handed out in `mcpServers`, such as the session's write token. The next agent of the
   * session gets fresh credentials from `mcpServers`.
   */
  release?(session: string): void;
  /**
   * Announces a change as the core's change event: `chat/<session>` while a session streams, and
   * the library-relative path of every file that an undo wrote. The host emits it on the library
   * so that the WebSocket delivers it to the UI.
   */
  notify(path: string): void;
  /** Backend to use when `chat.start` names none: the routing setting. */
  defaultBackend?(): string | undefined;
  /**
   * True when chat sessions run in the sandbox (setting "Isolierter Agent"). Otherwise they
   * get the user's own environment. Research jobs ignore this and always run isolated.
   */
  isolated?(): boolean;
  /** Called after every agent turn with what it consumed. Chat sessions and research jobs both report. */
  recordUsage?(entry: ChatUsageEntry): void;
  /** Limits of research jobs from the settings. Fields that are missing fall back to the defaults. */
  researchBudget?(): Partial<ResearchBudget> | undefined;
  now?(): Date;
}

export interface ServiceOptions {
  drivers?: Drivers;
  /** Milliseconds between change events while text streams. */
  notifyIntervalMs?: number;
}

interface Live {
  state: SessionState;
  driver?: AgentDriver | undefined;
  /** Whether `driver` was started in the sandbox; a changed setting starts a new one. */
  driverIsolated?: boolean | undefined;
  abort?: AbortController | undefined;
  running?: Promise<void> | undefined;
  timer?: NodeJS.Timeout | undefined;
  dirty: boolean;
  persistTimer?: NodeJS.Timeout | undefined;
}

export interface TurnOptions {
  /** Aborts the turn like `chat.cancel`. */
  signal?: AbortSignal;
  /** Sees every tool event, with input and output. */
  onEvent?(event: DriverEvent): void;
}

const TITLE_MAX = 60;

export class ChatService {
  readonly store: ChatStore;
  readonly drivers: Drivers;
  private readonly sessions = new Map<string, Live>();
  private readonly cache: SnapshotCache;
  private loaded = false;
  private status: { at: number; value: BackendStatus[] } | undefined;
  private readonly interval: number;

  constructor(
    readonly host: ChatHost,
    opts: ServiceOptions = {},
  ) {
    this.store = new ChatStore(join(host.localDir, "chats"));
    this.drivers =
      opts.drivers ?? createDrivers({ workspaceRoot: join(host.localDir, "agent-workspace") });
    this.cache = new SnapshotCache(host.libraryRoot);
    this.interval = opts.notifyIntervalMs ?? 40;
  }

  private now(): Date {
    return this.host.now?.() ?? new Date();
  }

  /** Research jobs and the setting "Isolierter Agent" give the sandbox. */
  private isolated(kind: "chat" | "research"): boolean {
    return kind === "research" || this.host.isolated?.() === true;
  }

  // Sessions ------------------------------------------------------------------------------------

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    for (const id of this.store.ids()) {
      if (this.sessions.has(id)) continue;
      const state = this.store.load(id);
      if (!state) continue;
      // A turn that was running when the app stopped did not finish.
      for (const t of state.turns) if (t.status === "running") t.status = "failed";
      state.instructed = false;
      this.sessions.set(id, { state, dirty: false });
    }
  }

  private require(id: string): Live {
    this.load();
    const live = this.sessions.get(id);
    if (!live) {
      throw chatError(
        "CHAT_SESSION_NOT_FOUND",
        `No chat session with id ${id}.`,
        "Call chat.list to see the sessions, or start a new one with chat.start.",
        "fix-and-retry",
        { session: id },
      );
    }
    return live;
  }

  summary(live: Live): ChatSessionSummary {
    const s = live.state;
    return {
      id: s.id,
      title: s.title,
      backend: s.backend,
      kind: s.kind,
      ...(s.project ? { project: s.project } : {}),
      ...(s.item ? { item: s.item } : {}),
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      running: live.running !== undefined,
      turns: s.turns.length,
      ...(s.job ? { job: s.job } : {}),
      ...(s.saved ? { saved: s.saved } : {}),
    };
  }

  async backends(): Promise<{ default: string; backends: BackendStatus[] }> {
    const fresh = this.status && Date.now() - this.status.at < 30_000;
    if (!fresh) {
      const find = (name: string) => findExecutable(name);
      const value = await Promise.all(this.drivers.definitions().map((d) => checkBackend(d, find)));
      this.status = { at: Date.now(), value };
    }
    const value = this.status?.value ?? [];
    const preferred = this.host.defaultBackend?.();
    const fallback = value.find((b) => b.available)?.id ?? value[0]?.id ?? "claude-code";
    return {
      default: preferred && value.some((b) => b.id === preferred) ? preferred : fallback,
      backends: value,
    };
  }

  create(input: {
    backend?: string | undefined;
    title?: string | undefined;
    kind?: "chat" | "research" | undefined;
    project?: string | undefined;
    plan?: string | undefined;
    node?: string | undefined;
    item?: string | undefined;
    selection?: ChatContext["selection"];
    job?: string | undefined;
  }): ChatSessionSummary {
    this.load();
    const backend = input.backend ?? this.host.defaultBackend?.() ?? "claude-code";
    if (!this.drivers.definition(backend)) {
      throw chatError(
        "CHAT_UNKNOWN_BACKEND",
        `No chat backend named ${backend}.`,
        `Use one of: ${this.drivers
          .definitions()
          .map((d) => d.id)
          .join(", ")}.`,
        "fix-and-retry",
        { backend },
      );
    }
    const at = this.now().toISOString();
    const id = newId("ch_", this.now().getTime());
    const context: ChatContext = {
      ...(input.project ? { project: input.project } : {}),
      ...(input.plan ? { plan: input.plan } : {}),
      ...(input.node ? { node: input.node } : {}),
      ...(input.item ? { item: input.item } : {}),
      ...(input.selection ? { selection: input.selection } : {}),
    };
    const state: SessionState = {
      id,
      title: input.title ?? "New chat",
      titled: input.title !== undefined,
      backend,
      kind: input.kind ?? "chat",
      ...(input.project ? { project: input.project } : {}),
      ...(input.item ? { item: input.item } : {}),
      ...(input.job ? { job: input.job } : {}),
      createdAt: at,
      updatedAt: at,
      context,
      entries: [],
      turns: [],
      instructed: false,
    };
    const live: Live = { state, dirty: false };
    this.sessions.set(id, live);
    this.store.scratch(id);
    this.store.save(state);
    return this.summary(live);
  }

  list(opts: {
    project?: string | undefined;
    kind?: string | undefined;
    limit: number;
  }): ChatSessionSummary[] {
    this.load();
    return [...this.sessions.values()]
      .filter((l) => (opts.project ? l.state.project === opts.project : true))
      .filter((l) => (opts.kind ? l.state.kind === opts.kind : true))
      .sort((a, b) => b.state.updatedAt.localeCompare(a.state.updatedAt))
      .slice(0, opts.limit)
      .map((l) => this.summary(l));
  }

  get(id: string) {
    const live = this.require(id);
    return {
      session: this.summary(live),
      context: live.state.context,
      entries: live.state.entries,
      turns: live.state.turns,
    };
  }

  // Turns ---------------------------------------------------------------------------------------

  /** Starts a turn and returns at once. The answer streams through change events. */
  send(id: string, message: string, context?: ChatContext): { turn: number } {
    const live = this.require(id);
    const { turn } = this.begin(live, message, context);
    live.running = this.execute(live, turn, message, {})
      .catch(() => {})
      .finally(() => {
        live.running = undefined;
        this.touch(live, true);
      });
    this.touch(live, true);
    return { turn };
  }

  /** Runs a turn to the end. Used by research jobs, which wait for the agent. */
  async run(id: string, message: string, opts: TurnOptions = {}): Promise<ChatTurn> {
    const live = this.require(id);
    const { turn } = this.begin(live, message, undefined);
    const done = this.execute(live, turn, message, opts);
    live.running = done
      .catch(() => {})
      .finally(() => {
        live.running = undefined;
        this.touch(live, true);
      });
    this.touch(live, true);
    await done;
    const result = live.state.turns.find((t) => t.turn === turn);
    if (!result) throw new Error("turn vanished");
    return result;
  }

  /** Resolves when no turn of the session is running. For tests and shutdown. */
  async idle(id: string): Promise<void> {
    await this.require(id).running;
  }

  cancel(id: string): void {
    this.require(id).abort?.abort();
  }

  private begin(live: Live, message: string, context: ChatContext | undefined): { turn: number } {
    if (live.running) {
      throw chatError(
        "CHAT_BUSY",
        `Session ${live.state.id} is still answering the previous message.`,
        "Wait for the answer, or stop it with chat.cancel, then send again.",
        "retry",
        { session: live.state.id },
      );
    }
    const s = live.state;
    if (context) s.context = context;
    const turn = s.turns.length + 1;
    const at = this.now().toISOString();
    s.turns.push({ turn, status: "running", startedAt: at, edits: [] });
    s.entries.push({
      id: s.entries.length,
      turn,
      at,
      type: "user",
      text: message,
      ...(Object.keys(s.context).length > 0 ? { context: s.context } : {}),
    });
    if (!s.titled) {
      s.title = oneLine(message, TITLE_MAX);
      s.titled = true;
    }
    s.updatedAt = at;
    return { turn };
  }

  private async execute(
    live: Live,
    turn: number,
    message: string,
    opts: TurnOptions,
  ): Promise<void> {
    const s = live.state;
    const record = s.turns.find((t) => t.turn === turn);
    if (!record) return;
    const abort = new AbortController();
    live.abort = abort;
    const relay = () => abort.abort();
    opts.signal?.addEventListener("abort", relay, { once: true });
    if (opts.signal?.aborted) abort.abort();

    // Research writes through add_item only and has its own record (the job), so it is not journaled.
    const journaled = s.kind === "chat";
    let before: Awaited<ReturnType<SnapshotCache["take"]>> | undefined;
    let started: number | undefined;
    try {
      if (journaled) before = await this.cache.take();
      let fresh = false;
      const isolated = this.isolated(s.kind);
      if (live.driver && live.driverIsolated !== isolated) {
        // The setting changed since this agent started: the next turn gets the other environment.
        await this.dropDriver(live);
      }
      if (!live.driver) {
        const mode: SessionMode = s.kind;
        live.driver = await this.drivers.factory(s.backend, {
          session: s.id,
          mode,
          cwd: this.store.scratch(s.id),
          libraryRoot: this.host.libraryRoot,
          mcpServers: await this.host.mcpServers({ session: s.id, mode }),
          directEdits: s.kind === "chat",
          isolated,
        });
        live.driverIsolated = isolated;
        s.instructed = false;
        fresh = true;
      }
      const first = s.instructed
        ? undefined
        : [
            instructions({
              mode: s.kind,
              libraryRoot: this.host.libraryRoot,
              directEdits: s.kind === "chat",
              isolated,
            }),
            fresh ? recap(s, turn) : "",
          ]
            .filter(Boolean)
            .join("\n\n");
      s.instructed = true;
      const prompt = turnPrompt({ first, context: s.context, message });
      started = performance.now();
      const res = await live.driver.prompt(
        prompt,
        (event) => this.apply(live, turn, event, opts),
        abort.signal,
      );
      this.reportUsage(s, true, started, res.usage);
      record.stopReason = res.stopReason;
      record.status = res.stopReason === "cancelled" || abort.signal.aborted ? "cancelled" : "done";
    } catch (err) {
      if (started !== undefined) this.reportUsage(s, false, started, undefined);
      record.status = abort.signal.aborted ? "cancelled" : "failed";
      if (record.status === "failed") this.addNotice(live, turn, err);
      // The agent process may be gone; the next turn starts a new session.
      void this.dropDriver(live);
    } finally {
      opts.signal?.removeEventListener("abort", relay);
      live.abort = undefined;
      if (journaled && before) {
        try {
          const edits = diffSnapshots(before, await this.cache.take());
          if (edits.length > 0) this.store.writeJournal(s.id, turn, edits);
          record.edits = edits.map((e) => ({
            path: e.path,
            change: e.before === null ? "created" : e.after === null ? "deleted" : "modified",
          }));
        } catch {
          // The turn itself succeeded; a failed comparison only means no undo for it.
        }
      }
      record.endedAt = this.now().toISOString();
      s.updatedAt = record.endedAt;
      this.persist(live);
    }
  }

  private reportUsage(
    s: SessionState,
    ok: boolean,
    started: number,
    usage: DriverUsage | undefined,
  ): void {
    try {
      this.host.recordUsage?.({
        session: s.id,
        kind: s.kind,
        backend: s.backend,
        ...(s.job ? { job: s.job } : {}),
        ok,
        ms: Math.round(performance.now() - started),
        usage,
      });
    } catch {
      // The ledger must never break a turn.
    }
  }

  /** Closes the agent of a session and revokes its credentials. */
  private async dropDriver(live: Live): Promise<void> {
    const driver = live.driver;
    live.driver = undefined;
    this.host.release?.(live.state.id);
    await driver?.close().catch(() => {});
  }

  /**
   * Ends the agent of a session that will not take another turn (a finished research job) and
   * revokes its token. The record of the session stays.
   */
  async end(id: string): Promise<void> {
    const live = this.sessions.get(id);
    if (!live) return;
    await live.running?.catch(() => {});
    await this.dropDriver(live);
  }

  private apply(live: Live, turn: number, event: DriverEvent, opts: TurnOptions): void {
    const s = live.state;
    const at = this.now().toISOString();
    switch (event.type) {
      case "text": {
        const last = s.entries[s.entries.length - 1];
        if (last?.type === "assistant" && last.turn === turn) last.text += event.text;
        else
          s.entries.push({ id: s.entries.length, turn, at, type: "assistant", text: event.text });
        break;
      }
      case "tool": {
        const existing = s.entries.find((e) => e.type === "tool" && e.callId === event.callId);
        const detail =
          toolDetail(event.tool, event.input) ??
          (existing?.type === "tool" ? existing.detail : undefined);
        const done = event.status === "done" ? extractCitekey(event.output) : undefined;
        const line =
          event.tool === "add_item" && done ? `${detail ?? ""} -> ${done}`.trim() : detail;
        if (existing?.type === "tool") {
          existing.status = event.status;
          existing.title = event.title;
          if (line) existing.detail = line;
          if (event.tool) existing.tool = event.tool;
        } else {
          s.entries.push({
            id: s.entries.length,
            turn,
            at,
            type: "tool",
            callId: event.callId,
            title: event.title,
            kind: event.kind,
            status: event.status,
            ...(event.tool ? { tool: event.tool } : {}),
            ...(line ? { detail: line } : {}),
          });
        }
        break;
      }
      case "notice":
        s.entries.push({
          id: s.entries.length,
          turn,
          at,
          type: "notice",
          level: event.level,
          text: event.text,
          ...(event.fix ? { fix: event.fix } : {}),
        });
        break;
    }
    opts.onEvent?.(event);
    this.touch(live);
  }

  private addNotice(live: Live, turn: number, err: unknown): void {
    const s = live.state;
    const detail = err instanceof CitegeistError ? err.detail : undefined;
    s.entries.push({
      id: s.entries.length,
      turn,
      at: this.now().toISOString(),
      type: "notice",
      level: "error",
      text: detail?.message ?? (err instanceof Error ? err.message : String(err)),
      ...(detail?.fix ? { fix: detail.fix } : {}),
    });
  }

  // Undo and transcripts ------------------------------------------------------------------------

  async revertTurn(id: string, turn: number) {
    const live = this.require(id);
    const record = live.state.turns.find((t) => t.turn === turn);
    if (!record) {
      throw chatError(
        "CHAT_TURN_NOT_FOUND",
        `Session ${id} has no turn ${turn}.`,
        "Call chat.get to see the turns of the session.",
        "fix-and-retry",
        { session: id, turn },
      );
    }
    if (record.status === "running") {
      throw chatError(
        "CHAT_BUSY",
        `Turn ${turn} of session ${id} is still running.`,
        "Stop it with chat.cancel or wait until it ends, then undo it.",
        "retry",
        { session: id, turn },
      );
    }
    if (record.reverted && record.reverted.conflicts === 0) {
      throw chatError(
        "CHAT_TURN_REVERTED",
        `Turn ${turn} of session ${id} was already undone.`,
        "Nothing to do. Changes made after the undo are not part of the turn.",
        "ask-human",
        { session: id, turn },
      );
    }
    const edits = this.store.readJournal(id, turn);
    if (!edits || edits.length === 0) {
      throw chatError(
        "CHAT_TURN_NO_EDITS",
        `Turn ${turn} of session ${id} changed no files, so there is nothing to undo.`,
        "Check record.edits in chat.get before offering an undo.",
        "ask-human",
        { session: id, turn },
      );
    }
    const result = await revertEdits(this.host.libraryRoot, edits, {
      changed: (p) => this.host.notify(p),
      remove: (abs) => rmSync(abs, { force: true }),
    });
    // Re-sync the snapshot cache so the next turn does not see the undo as an agent edit.
    await this.cache.take();
    record.reverted = {
      at: this.now().toISOString(),
      restored: result.restored.length,
      conflicts: result.conflicts.length,
    };
    live.state.updatedAt = record.reverted.at;
    this.persist(live);
    this.touch(live, true);
    return result;
  }

  save(id: string): { path: string } {
    const live = this.require(id);
    const s = live.state;
    if (s.saved) return { path: s.saved };
    const date = this.now().toISOString().slice(0, 10);
    const base = `${date}-${slugify(s.title)}`;
    let rel = `chats/${base}.md`;
    for (let n = 2; this.exists(rel); n++) rel = `chats/${base}-${n}.md`;
    const view = this.get(id);
    writeAtomic(
      join(this.host.libraryRoot, ...rel.split("/")),
      transcriptMarkdown({ ...view, date }),
    );
    s.saved = rel;
    this.persist(live);
    this.host.notify(rel);
    this.touch(live, true);
    return { path: rel };
  }

  private exists(rel: string): boolean {
    return existsSync(join(this.host.libraryRoot, ...rel.split("/")));
  }

  // Persistence and change events ----------------------------------------------------------------

  private persist(live: Live): void {
    if (live.persistTimer) clearTimeout(live.persistTimer);
    live.persistTimer = undefined;
    this.store.save(live.state);
    live.dirty = false;
  }

  /** Emits the change event, at most once per interval while text streams. */
  private touch(live: Live, immediate = false): void {
    const path = chatChangePath(live.state.id);
    if (immediate) {
      if (live.timer) clearTimeout(live.timer);
      live.timer = undefined;
      this.host.notify(path);
      return;
    }
    live.dirty = true;
    if (!live.persistTimer) {
      live.persistTimer = setTimeout(() => this.persist(live), 1500);
      live.persistTimer.unref();
    }
    if (live.timer) return;
    live.timer = setTimeout(() => {
      live.timer = undefined;
      this.host.notify(path);
    }, this.interval);
    live.timer.unref();
  }

  async close(): Promise<void> {
    for (const live of this.sessions.values()) {
      live.abort?.abort();
    }
    await Promise.all([...this.sessions.values()].map((l) => l.running?.catch(() => {})));
    for (const live of this.sessions.values()) {
      if (live.timer) clearTimeout(live.timer);
      if (live.dirty) this.persist(live);
      await this.dropDriver(live);
    }
    await this.drivers.close();
  }
}

/** A short recap for an agent that replaces a lost process, so it knows what was said before. */
function recap(s: SessionState, turn: number): string {
  const before = s.entries.filter(
    (e) => e.turn < turn && (e.type === "user" || e.type === "assistant"),
  );
  if (before.length === 0) return "";
  const lines = before
    .slice(-8)
    .map((e: ChatEntry) =>
      e.type === "user" || e.type === "assistant"
        ? `${e.type === "user" ? "User" : "You"}: ${oneLine(e.text, 600)}`
        : "",
    );
  return `[Earlier in this conversation]\n${lines.filter(Boolean).join("\n")}`;
}
