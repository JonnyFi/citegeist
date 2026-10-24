import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// The chat through the real server: a fake ACP agent (a spawned script that speaks the agent side
// of ACP) talks to the citegeist MCP server of the core and writes a note, and the oRPC endpoint
// and the WebSocket show the result.
import { fakeBackend } from "@citegeist/chat/testing";
import { chatChangePath } from "@citegeist/ops";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { seedLibrary } from "../testing/seed.js";
import { chatBackendFromRouting } from "./chat.js";
import { type CoreServer, startCoreServer } from "./server.js";

let tmp: string;
let server: CoreServer | undefined;

type Client = Record<string, Record<string, (input: unknown) => Promise<any>>>;

const call = (client: Client, op: string, input: unknown = {}): Promise<any> => {
  const [ns = "", name = ""] = op.split(".");
  const fn = client[ns]?.[name];
  if (!fn) throw new Error(`no operation ${op}`);
  return fn(input);
};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "citegeist-server-chat-"));
  seedLibrary(join(tmp, "library"));
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  rmSync(tmp, { recursive: true, force: true });
});

async function start() {
  server = await startCoreServer({
    library: join(tmp, "library"),
    localBase: join(tmp, "local"),
    watch: false,
    connector: false,
    chat: { backends: [fakeBackend()], find: () => undefined, handshakeTimeoutMs: 30_000 },
  });
  const link = new RPCLink({
    url: `http://127.0.0.1:${server.port}/rpc`,
    headers: { authorization: `Bearer ${server.token}` },
  });
  return { server, client: createORPCClient<Client>(link) };
}

async function until<T>(read: () => Promise<T>, done: (v: T) => boolean): Promise<T> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("chat in the core server", () => {
  it("binds the chat operations and lists the backends", async () => {
    const { client } = await start();
    const res = await call(client, "chat.backends");
    expect(res.backends.map((b: { id: string }) => b.id)).toEqual(["fake"]);
  });

  it("runs a turn with a fake ACP agent, writes through MCP as the agent and streams over the WebSocket", async () => {
    const { server, client } = await start();
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/events?token=${server.token}`);
    const paths: string[] = [];
    ws.on("message", (data) => paths.push(JSON.parse(String(data)).path));
    await new Promise((r) => ws.once("open", r));

    const started = await call(client, "chat.start", { backend: "fake" });
    const session: string = started.session.id;
    await call(client, "chat.send", {
      session,
      message: `Halte das fest.\n@fake mcp create_note ${JSON.stringify({ title: "Idee aus dem Chat", type: "permanent", body: "A und B." })}`,
    });
    const view = await until(
      () => call(client, "chat.get", { session }),
      (v) => v.turns[0]?.endedAt !== undefined,
    );
    expect(view.turns[0].status).toBe("done");
    expect(view.entries.find((e: { type: string }) => e.type === "tool")).toMatchObject({
      tool: "create_note",
      status: "done",
    });

    const edit = view.turns[0].edits[0];
    expect(edit).toMatchObject({ change: "created" });
    expect(readFileSync(join(server.library.root, edit.path), "utf8")).toContain(
      "agent:fake-acp-agent",
    );
    // The streaming announcement and the note both reach the UI as change events.
    await until(
      async () => paths,
      (p) => p.includes(chatChangePath(session)),
    );
    expect(paths).toContain(chatChangePath(session));
    ws.close();
  });

  it("gives every session an own write token and refuses unknown ones", async () => {
    const { server } = await start();
    const mcp = server.chat?.mcp;
    expect(mcp).toBeDefined();
    const call = (token: string) =>
      fetch(mcp?.url ?? "", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: "{}",
      });
    expect((await call(server.token)).status).toBe(401);
    expect((await call("not-a-session-token")).status).toBe(401);
  });

  it("revokes the token of a session when its agent ends (M7)", async () => {
    const { server } = await start();
    const chat = server.chat;
    if (!chat) throw new Error("no chat");
    const bearer = async (session: string, mode: "chat" | "research") => {
      const [mcpServer] = await chat.service.host.mcpServers({ session, mode });
      const header = mcpServer && "headers" in mcpServer ? mcpServer.headers[0]?.value : undefined;
      return header?.replace("Bearer ", "") ?? "";
    };
    const status = (token: string) =>
      fetch(chat.mcp.url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: "{}",
      }).then((r) => r.status);

    const first = await bearer("s1", "chat");
    expect(await bearer("s1", "chat")).toBe(first);
    expect(await status(first)).not.toBe(401);
    chat.service.host.release?.("s1");
    expect(await status(first)).toBe(401);
    // The next agent of the session gets a new token; other sessions are untouched.
    const other = await bearer("s2", "chat");
    const second = await bearer("s1", "chat");
    expect(second).not.toBe(first);
    expect(await status(second)).not.toBe(401);
    expect(await status(other)).not.toBe(401);
    chat.service.host.release?.("unknown");
    expect(await status(other)).not.toBe(401);
  });

  it("revokes the token when a research session ends and refuses local files to it (M4, M7)", async () => {
    const { server } = await start();
    const chat = server.chat;
    if (!chat) throw new Error("no chat");
    const session = chat.service.create({ backend: "fake", kind: "research", title: "R" });
    const [mcpServer] = await chat.service.host.mcpServers({
      session: session.id,
      mode: "research",
    });
    const token = (mcpServer && "headers" in mcpServer ? mcpServer.headers[0]?.value : "")?.replace(
      "Bearer ",
      "",
    );
    const secret = join(tmp, "secret.html");
    writeFileSync(secret, "<html><head><title>Secret</title></head><body>Text</body></html>");
    const ask = `Hole das.\n@fake mcp add_item ${JSON.stringify({ identifier: secret })}`;
    const itemFiles = () => readdirSync(join(server.library.root, "items"));
    const seeded = itemFiles().length;
    const turn = await chat.service.run(session.id, ask);
    expect(turn.status).toBe("done");
    const tool = chat.service.get(session.id).entries.find((e) => e.type === "tool");
    expect(tool).toMatchObject({ tool: "add_item", status: "failed" });
    expect(itemFiles()).toHaveLength(seeded);

    // The same call from a chat session, which may read local files, adds the file.
    const normal = chat.service.create({ backend: "fake", kind: "chat", title: "C" });
    await chat.service.run(normal.id, ask);
    expect(itemFiles()).toHaveLength(seeded + 1);

    const status = () =>
      fetch(chat.mcp.url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: "{}",
      }).then((r) => r.status);
    expect(await status()).not.toBe(401);
    await chat.service.end(session.id);
    expect(await status()).toBe(401);
  });

  it("starts without a chat when asked to", async () => {
    server = await startCoreServer({
      library: join(tmp, "library"),
      localBase: join(tmp, "local"),
      watch: false,
      connector: false,
      chat: false,
    });
    expect(server.chat).toBeUndefined();
    expect(server.registry.list().some((c) => c.name === "chat.start")).toBe(false);
  });
});

describe("chatBackendFromRouting", () => {
  const ids = ["claude-code", "codex", "cursor"];
  it("maps the inference routing onto a chat backend", () => {
    expect(chatBackendFromRouting({ "*": "claude-code-cli" }, ids)).toBe("claude-code");
    expect(chatBackendFromRouting({ "*": "codex" }, ids)).toBe("codex");
    expect(chatBackendFromRouting({ "*": "ollama-local" }, ids)).toBeUndefined();
    expect(chatBackendFromRouting({}, ids)).toBeUndefined();
  });
});
