import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@agentclientprotocol/sdk";
import { startMcpHttpServer } from "@citegeist/mcp";
import { type ChatContext, itemsAdd, itemsList, type OpContext, Registry } from "@citegeist/ops";
import type { BackendDefinition } from "../backends.js";
import { createDrivers } from "../drivers.js";
import type { JobQueuePort, ResearchJobContext } from "../research.js";
import { type ChatHost, ChatService } from "../service.js";

const FAKE_AGENT = fileURLToPath(new URL("./fake-acp-agent.ts", import.meta.url));
const TSX = import.meta.resolve("tsx");

/** A backend that starts the scripted fake agent instead of a real adapter. */
export function fakeBackend(
  env: Record<string, string> = {},
  overrides: Partial<BackendDefinition> = {},
): BackendDefinition {
  return {
    id: "fake",
    label: "Fake agent",
    actor: "fake-acp-agent",
    cli: { command: "node", installHint: "Node is installed." },
    launch: () => ({
      command: process.execPath,
      args: ["--import", TSX, FAKE_AGENT],
      env,
    }),
    sessionMeta: (isolated) => ({ fake: { isolated } }),
    ...overrides,
  };
}

/** The part of the core that the chat tests need: items.add into the inbox, items.list. */
export function miniRegistry() {
  const inbox: Array<{ citekey: string; by: string; why?: string; identifier: string }> = [];
  const registry = new Registry()
    .bind(itemsAdd, async (ctx: OpContext, input) => {
      const citekey = `paper${inbox.length + 1}`;
      inbox.push({
        citekey,
        by: ctx.actor,
        identifier: input.identifier,
        ...(input.why ? { why: input.why } : {}),
      });
      return { citekey, job: "j_01JB8Z3QK7ABCDEFGH" };
    })
    .bind(itemsList, async () => ({
      items: inbox.map((i) => ({
        citekey: i.citekey,
        title: `Paper ${i.identifier}`,
        type: "article-journal",
        status: "unread",
        inbox: true,
        inboxBy: i.by,
        ...(i.why ? { inboxWhy: i.why } : {}),
      })),
    }));
  return { registry, inbox };
}

export interface Harness {
  root: string;
  localDir: string;
  service: ChatService;
  registry: Registry;
  inbox: ReturnType<typeof miniRegistry>["inbox"];
  /** Paths announced through `host.notify`, in order. */
  events: string[];
  mcpUrl: string;
  /** Starts a session, sends a message and waits for the turn. Returns the session id. */
  chat(message: string, context?: ChatContext): Promise<{ session: string; turn: number }>;
  say(session: string, message: string): Promise<number>;
  view(session: string): ReturnType<ChatService["get"]>;
  close(): Promise<void>;
}

export async function createHarness(
  opts: {
    backend?: BackendDefinition;
    registry?: Registry;
    root?: string;
    localDir?: string;
    host?: Partial<ChatHost>;
  } = {},
): Promise<Harness> {
  const base = mkdtempSync(join(tmpdir(), "citegeist-chat-"));
  const root = opts.root ?? join(base, "library");
  const localDir = opts.localDir ?? join(base, "local");
  mkdirSync(root, { recursive: true });
  for (const d of ["items", "notes", "projects", "chats"])
    mkdirSync(join(root, d), { recursive: true });

  const mini = miniRegistry();
  const registry = opts.registry ?? mini.registry;
  const mcp = await startMcpHttpServer(registry, { tokens: [{ token: "t0k3n", scope: "write" }] });
  const events: string[] = [];
  const server: McpServer = {
    type: "http",
    name: "citegeist",
    url: mcp.url,
    headers: [{ name: "Authorization", value: "Bearer t0k3n" }],
  };
  const service = new ChatService(
    {
      libraryRoot: root,
      localDir,
      mcpServers: () => [server],
      notify: (p) => events.push(p),
      ...opts.host,
    },
    {
      drivers: createDrivers({
        workspaceRoot: join(localDir, "agent-workspace"),
        backends: [opts.backend ?? fakeBackend()],
        find: () => undefined,
        handshakeTimeoutMs: 20_000,
      }),
      notifyIntervalMs: 5,
    },
  );
  return {
    root,
    localDir,
    service,
    registry,
    inbox: mini.inbox,
    events,
    mcpUrl: mcp.url,
    async chat(message, context) {
      const session = service.create({ backend: "fake", ...context });
      const { turn } = service.send(session.id, message);
      await service.idle(session.id);
      return { session: session.id, turn };
    },
    async say(session, message) {
      const { turn } = service.send(session, message);
      await service.idle(session);
      return turn;
    },
    view: (session) => service.get(session),
    async close() {
      await service.close();
      await mcp.close();
      rmSync(base, { recursive: true, force: true });
    },
  };
}

/** A job queue that runs a research job right away and records its progress. */
export function inlineQueue() {
  let handler: ((ctx: ResearchJobContext) => Promise<unknown>) | undefined;
  const progress: Array<{ value: number; message?: string | undefined }> = [];
  let last: Promise<unknown> = Promise.resolve();
  let counter = 0;
  const queue: JobQueuePort = {
    register(_kind, h) {
      handler = h;
    },
    enqueue(job) {
      const id = `j_01JB8Z3QK7${String(++counter).padStart(6, "0")}ABC`;
      const ctx: ResearchJobContext = {
        job: { id, input: job.input },
        signal: new AbortController().signal,
        progress: (value, message) => progress.push({ value, message }),
      };
      last = handler
        ? handler(ctx).then(
            (r) => ({ ok: r }),
            (e: unknown) => ({ error: e }),
          )
        : Promise.resolve();
      return { id };
    },
  };
  return { queue, progress, done: () => last };
}
