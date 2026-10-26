import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixtureRegistry, FIXTURE_CITEKEY } from "./fixture.js";
import {
  createMcpRequestHandler,
  MCP_SESSION_IDLE_MS,
  MCP_SSE_KEEP_ALIVE_MS,
} from "./transports.js";

const ACCESS = { scope: "write", localFiles: false, actor: "agent:grok" } as const;
const HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

interface Running {
  url: string;
  logs: string[];
  stop(): Promise<void>;
}

const running: Running[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(running.splice(0).map((r) => r.stop()));
});

/** The request handler behind a bare HTTP server, as the core's tunnel listener uses it. */
async function start(
  options: Parameters<typeof createMcpRequestHandler>[1] = {},
): Promise<Running> {
  const logs: string[] = [];
  const handler = createMcpRequestHandler(createFixtureRegistry(), {
    log: (m) => logs.push(m),
    onerror: (e) => logs.push(`ERR ${e.stack}`),
    ...options,
  });
  const server: Server = createServer((req, res) => {
    void handler.handle(req, res, ACCESS);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const handle: Running = {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`,
    logs,
    async stop() {
      await handler.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
  running.push(handle);
  return handle;
}

/** Reads the first JSON-RPC message of a JSON or SSE response body. */
function parse(text: string): { result?: Record<string, unknown>; error?: unknown } {
  const data = text
    .split("\n")
    .find((line) => line.startsWith("data:"))
    ?.slice(5);
  return JSON.parse(data ?? text) as { result?: Record<string, unknown>; error?: unknown };
}

async function rpc(
  url: string,
  method: string,
  params: unknown,
  sessionId?: string,
  id = 1,
): Promise<{ status: number; sessionId: string | null; body: ReturnType<typeof parse> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { ...HEADERS, ...(sessionId ? { "mcp-session-id": sessionId } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  return {
    status: res.status,
    sessionId: res.headers.get("mcp-session-id"),
    body: parse(await res.text()),
  };
}

async function initialize(url: string): Promise<string> {
  const res = await rpc(url, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "grok-bot", version: "1.0.0" },
  });
  expect(res.status).toBe(200);
  expect(res.sessionId).toBeTruthy();
  return res.sessionId as string;
}

const CALL = { name: "get_item", arguments: { citekey: FIXTURE_CITEKEY } };

describe("MCP sessions after a restart of the core", () => {
  it("serves a tool call on a session id the new process does not know, with a new id", async () => {
    const before = await start();
    const staleId = await initialize(before.url);
    expect((await rpc(before.url, "tools/call", CALL, staleId)).status).toBe(200);
    await before.stop();

    // A new process: no sessions, same connector.
    const after = await start();
    const list = await rpc(after.url, "tools/list", {}, staleId);
    expect(list.status).toBe(200);
    expect(list.sessionId).toBeTruthy();
    expect(list.sessionId).not.toBe(staleId);
    expect(((list.body.result?.tools ?? []) as unknown[]).length).toBeGreaterThan(0);

    const call = await rpc(after.url, "tools/call", CALL, staleId, 2);
    expect(call.status).toBe(200);
    expect(call.body.error).toBeUndefined();
    expect(JSON.stringify(call.body.result)).toContain(FIXTURE_CITEKEY);
    // A client that keeps the old id lands on the same replacement, not on a new one each time.
    expect(call.sessionId).toBe(list.sessionId);
    expect(after.logs.filter((l) => l.includes("replaced"))).toHaveLength(1);
  });

  it("puts parallel requests with the same stale id on one new session", async () => {
    const server = await start();
    const answers = await Promise.all([
      rpc(server.url, "tools/list", {}, "00000000-0000-4000-8000-000000000000", 1),
      rpc(server.url, "tools/call", CALL, "00000000-0000-4000-8000-000000000000", 2),
      rpc(server.url, "tools/list", {}, "00000000-0000-4000-8000-000000000000", 3),
    ]);

    expect(answers.map((a) => a.status)).toEqual([200, 200, 200]);
    expect(new Set(answers.map((a) => a.sessionId)).size).toBe(1);
  });

  it("logs the replacement without the full session id", async () => {
    const server = await start();
    const stale = "11111111-2222-4333-8444-555555555555";
    await rpc(server.url, "tools/list", {}, stale);
    const line = server.logs.find((l) => l.includes("replaced"));
    expect(line).toContain("11111111");
    expect(line).toContain("agent:grok");
    expect(line).not.toContain(stale);
  });

  it("opens a fresh session for an initialize that still carries the old id", async () => {
    const server = await start();
    const res = await fetch(server.url, {
      method: "POST",
      headers: { ...HEADERS, "mcp-session-id": "22222222-2222-4333-8444-555555555555" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "grok-bot", version: "1.0.0" },
        },
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBeTruthy();
    await res.text();
  });

  it("answers DELETE for an unknown session with 204", async () => {
    const server = await start();
    const res = await fetch(server.url, {
      method: "DELETE",
      headers: { "mcp-session-id": "33333333-2222-4333-8444-555555555555" },
    });
    expect(res.status).toBe(204);
  });

  it("answers 404 for an unknown session when staleSessions is reject", async () => {
    const server = await start({ staleSessions: "reject" });
    const res = await rpc(server.url, "tools/list", {}, "55555555-2222-4333-8444-555555555555");
    expect(res.status).toBe(404);
    expect(server.logs.some((l) => l.includes("replaced"))).toBe(false);
  });

  it("still asks for initialize when there is no session id at all", async () => {
    const server = await start();
    expect((await rpc(server.url, "tools/list", {})).status).toBe(400);
  });
});

describe("MCP session lifetime", () => {
  it("keeps a session for 24 hours and closes it after that without a request", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const server = await start();
    const id = await initialize(server.url);

    vi.advanceTimersByTime(MCP_SESSION_IDLE_MS - 60_000);
    expect(server.logs.some((l) => l.includes("idle"))).toBe(false);
    // A request resets the idle time.
    expect((await rpc(server.url, "tools/list", {}, id)).sessionId).toBe(id);

    vi.advanceTimersByTime(MCP_SESSION_IDLE_MS - 60_000);
    expect(server.logs.some((l) => l.includes("idle"))).toBe(false);
    vi.advanceTimersByTime(20 * 60_000);
    expect(server.logs.some((l) => l.includes("closed 1 session(s) idle"))).toBe(true);

    // The client that comes back is not turned away.
    const again = await rpc(server.url, "tools/list", {}, id, 2);
    expect(again.status).toBe(200);
    expect(again.sessionId).not.toBe(id);
  });

  it("sends keep-alive comments on an open GET stream", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const server = await start();
    const id = await initialize(server.url);
    const controller = new AbortController();
    const res = await fetch(server.url, {
      headers: { accept: "text/event-stream", "mcp-session-id": id },
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    for (let i = 0; i < 2; i++) {
      vi.advanceTimersByTime(MCP_SSE_KEEP_ALIVE_MS);
      const chunk = await reader.read();
      expect(decoder.decode(chunk.value)).toContain(": keepalive");
    }
    controller.abort();
  });
});
