// biome-ignore-all lint/suspicious/noExplicitAny: parsed JSON of requests and replies
// The dedicated hooks listener (fixed port, /hooks and /mcp only), the public address setting,
// the outbound auth header and the MCP endpoint for connectors, through the real core server.
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server as HttpServer, type IncomingMessage, request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStubWorker, InMemoryKeychain } from "@citegeist/core";
import { createReplayFetch, createResolver } from "@citegeist/metadata";
import { signRequest } from "@citegeist/webhooks";
import { Client as McpClient, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedLibrary } from "../testing/seed.js";
import { ACTOR_HEADER, type CoreServer, startCoreServer } from "./server.js";

const METADATA_HTTP_DIR = fileURLToPath(
  new URL("../../../../fixtures/metadata/http", import.meta.url),
);
const DOI = "10.1038/s41586-020-2649-2";

type Client = Record<string, Record<string, (input: unknown) => Promise<any>>>;
type WebhookOptions = NonNullable<Parameters<typeof startCoreServer>[0]["webhooks"]>;

let tmp: string;
let server: CoreServer | undefined;
const cleanups: Array<() => Promise<void> | void> = [];

async function start(webhooks: Exclude<WebhookOptions, false> = {}) {
  const resolver = createResolver({
    fetch: createReplayFetch(METADATA_HTTP_DIR),
    now: () => Date.parse("2026-10-23T12:00:00Z"),
    sleep: async () => {},
  });
  server = await startCoreServer({
    library: join(tmp, "library"),
    localBase: join(tmp, "local"),
    watch: false,
    connector: false,
    chat: false,
    runtime: {
      worker: createStubWorker(),
      resolver,
      ai: { backends: [] },
      sync: { quietMs: 60_000 },
    },
    webhooks: { secrets: new InMemoryKeychain(), retryDelaysMs: [], ...webhooks },
  });
  const client = createORPCClient<Client>(
    new RPCLink({
      url: `http://127.0.0.1:${server.port}/rpc`,
      headers: { authorization: `Bearer ${server.token}`, [ACTOR_HEADER]: "human" },
    }),
  );
  return { server, client };
}

const call = (client: Client, op: string, input: unknown = {}): Promise<any> => {
  const [ns = "", name = ""] = op.split(".");
  const fn = client[ns]?.[name];
  if (!fn) throw new Error(`no operation ${op}`);
  return fn(input);
};

/** A port nobody listens on right now. */
async function freePort(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const port = (srv.address() as AddressInfo).port;
  await new Promise<void>((resolve) => srv.close(() => resolve()));
  return port;
}

async function occupy(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve) => srv.close(() => resolve())));
  return (srv.address() as AddressInfo).port;
}

async function signedPing(port: number, name: string, secret: string) {
  const body = JSON.stringify({ event: "ping" });
  const res = await fetch(`http://127.0.0.1:${port}/hooks/${name}`, {
    method: "POST",
    headers: { ...signRequest(secret, body), "content-type": "application/json" },
    body,
  });
  return res.status;
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "citegeist-hooks-listener-"));
  seedLibrary(join(tmp, "library"));
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  for (const fn of cleanups.splice(0)) await fn();
  delete process.env.CITEGEIST_PUBLIC_URL;
  rmSync(tmp, { recursive: true, force: true });
});

describe("dedicated hooks listener", () => {
  it("runs only while a connector exists, and serves /hooks and nothing else of the core", async () => {
    const { server: s, client } = await start({ hooksPort: 0 });
    expect(s.hooksPort()).toBeUndefined();
    expect((await call(client, "webhooks.list")).listener).toEqual({ state: "off" });

    const { secret } = await call(client, "webhooks.create", { name: "grok", kind: "inbound" });
    const port = s.hooksPort();
    expect(port).toBeTypeOf("number");
    expect(port).not.toBe(s.port);
    expect((await call(client, "webhooks.list")).listener).toEqual({ state: "listening", port });
    expect(await signedPing(port as number, "grok", secret)).toBe(200);

    // The core's own routes do not exist here, with or without the core token.
    const base = `http://127.0.0.1:${port}`;
    for (const path of ["/rpc/items/list", "/health", "/files/items/x.pdf", "/events", "/"]) {
      for (const headers of [{}, { authorization: `Bearer ${s.token}`, [ACTOR_HEADER]: "human" }]) {
        const res = await fetch(`${base}${path}`, { method: "POST", headers, body: "{}" });
        expect(res.status, path).toBe(404);
      }
    }

    await call(client, "webhooks.delete", { name: "grok" });
    expect(s.hooksPort()).toBeUndefined();
    await expect(fetch(`${base}/hooks/grok`, { method: "POST" })).rejects.toThrow();
    expect((await call(client, "webhooks.list")).listener).toEqual({ state: "off" });
  });

  it("points the inbound address at the hooks port while no public address is set", async () => {
    const { server: s, client } = await start({ hooksPort: 0 });
    const created = await call(client, "webhooks.create", { name: "grok", kind: "inbound" });
    const listed = await call(client, "webhooks.list");
    expect(listed.webhooks[0].inboundUrl).toBe(`http://127.0.0.1:${s.hooksPort()}/hooks/grok`);
    expect(created.webhook.name).toBe("grok");
  });

  it("takes the port from the settings and moves live when the setting changes", async () => {
    const first = await freePort();
    const { server: s, client } = await start();
    await call(client, "settings.update", { patch: { webhooks: { port: first } } });
    const { secret } = await call(client, "webhooks.create", { name: "grok", kind: "inbound" });
    expect(s.hooksPort()).toBe(first);
    expect(await signedPing(first, "grok", secret)).toBe(200);

    const second = await freePort();
    await call(client, "settings.update", { patch: { webhooks: { port: second } } });
    expect(s.hooksPort()).toBe(second);
    expect(await signedPing(second, "grok", secret)).toBe(200);
    await expect(signedPing(first, "grok", secret)).rejects.toThrow();
    const listed = await call(client, "webhooks.list");
    expect(listed.listener).toEqual({ state: "listening", port: second });
    expect(listed.webhooks[0].inboundUrl).toBe(`http://127.0.0.1:${second}/hooks/grok`);
  });

  it("reports a port that is taken, with a fix, and recovers when another port is chosen", async () => {
    const busy = await occupy();
    const { server: s, client } = await start();
    await call(client, "settings.update", { patch: { webhooks: { port: busy } } });
    await call(client, "webhooks.create", { name: "grok", kind: "inbound" });
    const listed = await call(client, "webhooks.list");
    expect(s.hooksPort()).toBeUndefined();
    expect(listed.listener).toMatchObject({
      state: "error",
      port: busy,
      code: "HOOKS_PORT_IN_USE",
    });
    expect(listed.listener.detail).toContain(String(busy));
    expect(listed.listener.fix).toContain("another port");
    // Not fatal: the address falls back to the core's own port.
    expect(listed.webhooks[0].inboundUrl).toBe(`http://127.0.0.1:${s.port}/hooks/grok`);

    const free = await freePort();
    await call(client, "settings.update", { patch: { webhooks: { port: free } } });
    expect((await call(client, "webhooks.list")).listener).toEqual({
      state: "listening",
      port: free,
    });
  });

  it("starts at the next start when a connector already exists", async () => {
    const port = await freePort();
    const keychain = new InMemoryKeychain();
    const first = await start({ secrets: keychain });
    await call(first.client, "settings.update", { patch: { webhooks: { port } } });
    await call(first.client, "webhooks.create", { name: "grok", kind: "inbound" });
    await first.server.close();
    server = undefined;
    const again = await start({ secrets: keychain });
    expect(again.server.hooksPort()).toBe(port);
  });
});

describe("public address", () => {
  it("comes from the settings, shows its source and is overridden by the variable", async () => {
    const { client } = await start({ hooksPort: 0 });
    await call(client, "webhooks.create", { name: "grok", kind: "inbound" });
    expect((await call(client, "webhooks.list")).publicBaseUrl).toBeUndefined();

    await call(client, "settings.update", {
      patch: { webhooks: { publicUrl: "https://mac.tailnet.ts.net/" } },
    });
    let listed = await call(client, "webhooks.list");
    expect(listed.publicBaseUrl).toBe("https://mac.tailnet.ts.net");
    expect(listed.publicBaseUrlSource).toBe("settings");
    expect(listed.webhooks[0].inboundUrl).toBe("https://mac.tailnet.ts.net/hooks/grok");

    process.env.CITEGEIST_PUBLIC_URL = "https://env.example.com";
    listed = await call(client, "webhooks.list");
    expect(listed.publicBaseUrl).toBe("https://env.example.com");
    expect(listed.publicBaseUrlSource).toBe("env");
    delete process.env.CITEGEIST_PUBLIC_URL;

    await call(client, "settings.update", { patch: { webhooks: { publicUrl: "" } } });
    expect((await call(client, "webhooks.list")).publicBaseUrl).toBeUndefined();
  });

  it("builds the callback URL of a task from the setting", async () => {
    const received: Array<{ headers: IncomingMessage["headers"]; body: string }> = [];
    const agent: HttpServer = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        received.push({ headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
        res.writeHead(200, { "content-type": "application/json" }).end('{"success":true}');
      });
    });
    await new Promise<void>((resolve) => agent.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => {
      agent.closeAllConnections();
      return new Promise<void>((resolve) => agent.close(() => resolve()));
    });
    const url = `http://127.0.0.1:${(agent.address() as AddressInfo).port}/automations/webhook/r1`;

    const { client } = await start({ hooksPort: 0 });
    await call(client, "settings.update", {
      patch: { webhooks: { publicUrl: "https://mac.tailnet.ts.net" } },
    });
    const created = await call(client, "webhooks.create", {
      name: "grok",
      kind: "both",
      url,
      authHeader: "Authorization",
      authValue: "Bearer crsr_test_key",
    });
    expect(JSON.stringify(created.webhook)).not.toContain("crsr_test_key");
    const sent = await call(client, "webhooks.send", {
      name: "grok",
      prompt: "Finde etwas",
      briefChars: 0,
    });
    expect(received).toHaveLength(1);
    expect(received[0]?.headers.authorization).toBe("Bearer crsr_test_key");
    expect(received[0]?.headers["x-citegeist-signature"]).toMatch(/^v1=/);
    expect(JSON.parse(received[0]?.body ?? "{}").callback.url).toBe(
      "https://mac.tailnet.ts.net/hooks/grok",
    );
    // Answer the task, so the job does not wait for its callback when the core closes.
    const answer = JSON.stringify({ event: "task.result", task: sent.job, status: "failed" });
    const answered = await fetch(`http://127.0.0.1:${server?.hooksPort()}/hooks/grok`, {
      method: "POST",
      headers: { ...signRequest(created.secret, answer), "content-type": "application/json" },
      body: answer,
    });
    expect(answered.status).toBe(200);
    const listed = await call(client, "webhooks.list");
    expect(JSON.stringify(listed)).not.toContain("crsr_test_key");
    expect(listed.webhooks[0]).toMatchObject({ authHeader: "Authorization", hasAuthValue: true });
  });
});

describe("bearer token for inbound requests, over HTTP on the hooks port", () => {
  it("accepts papers.add with the token and an id, refuses it without one", async () => {
    const { server: s, client } = await start({ hooksPort: 0 });
    const made = await call(client, "webhooks.create", {
      name: "grok",
      kind: "inbound",
      inboundToken: true,
    });
    const send = (headers: Record<string, string>, body: unknown) =>
      fetch(`http://127.0.0.1:${s.hooksPort()}/hooks/grok`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    const auth = { authorization: `Bearer ${made.inboundToken}` };
    expect((await send(auth, { event: "papers.add", papers: [DOI] })).status).toBe(400);
    const ok = await send(auth, { event: "papers.add", papers: [DOI], id: "run-1" });
    expect(ok.status).toBe(200);
    expect((await send(auth, { event: "ping", id: "run-1" })).status).toBe(409);
    expect((await send({ authorization: "Bearer nope" }, { event: "ping", id: "r2" })).status).toBe(
      401,
    );
    const inbox = await call(client, "items.list", { inbox: true, limit: 10 });
    expect(
      inbox.items.filter((i: { inboxBy?: string }) => i.inboxBy === "agent:grok"),
    ).toHaveLength(1);
  });
});

describe("MCP endpoint for connectors", () => {
  const rawStatus = (port: number, headers: Record<string, string>) =>
    new Promise<number>((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port, path: "/mcp", method: "POST", headers },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end("{}");
    });

  async function mcpClient(port: number, token: string): Promise<McpClient> {
    const mcp = new McpClient({ name: "grok-bot", version: "1.0.0" });
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );
    cleanups.push(() => mcp.close());
    return mcp;
  }

  it("answers 404 while no connector has MCP access, and the core's port never serves it", async () => {
    const { server: s, client } = await start({ hooksPort: 0 });
    await call(client, "webhooks.create", { name: "grok", kind: "inbound" });
    expect(await rawStatus(s.hooksPort() as number, {})).toBe(404);
    expect(await rawStatus(s.hooksPort() as number, { authorization: "Bearer anything" })).toBe(
      404,
    );
    const made = await call(client, "webhooks.create", {
      name: "mcp-agent",
      kind: "inbound",
      mcp: "write",
    });
    // On the core's own port /mcp is no route.
    const onCore = await fetch(`http://127.0.0.1:${s.port}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${s.token}`, [ACTOR_HEADER]: "human" },
      body: "{}",
    });
    expect(onCore.status).toBe(404);
    // Taking the access away makes the endpoint disappear again.
    await call(client, "webhooks.setMcpAccess", { name: "mcp-agent", enabled: false });
    expect(
      await rawStatus(s.hooksPort() as number, { authorization: `Bearer ${made.mcpToken}` }),
    ).toBe(404);
  });

  it("refuses a missing or wrong token, and slows a source down after repeated failures", async () => {
    const { server: s, client } = await start({ hooksPort: 0 });
    const made = await call(client, "webhooks.create", {
      name: "grok",
      kind: "inbound",
      mcp: "write",
    });
    const port = s.hooksPort() as number;
    expect(await rawStatus(port, {})).toBe(401);
    expect(await rawStatus(port, { authorization: "Bearer whmcp_wrong" })).toBe(401);
    // The webhook secret and an inbound token are no MCP tokens.
    expect(await rawStatus(port, { authorization: `Bearer ${made.secret}` })).toBe(401);
    for (let i = 0; i < 7; i += 1) await rawStatus(port, { authorization: "Bearer whmcp_wrong" });
    expect(await rawStatus(port, { authorization: "Bearer whmcp_wrong" })).toBe(429);
    // Blocked is blocked, even for the right token, until the window has passed.
    expect(await rawStatus(port, { authorization: `Bearer ${made.mcpToken}` })).toBe(429);
    // Another source (by forwarded address) is not affected.
    const other = new McpClient({ name: "grok-bot", version: "1.0.0" });
    await other.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
        requestInit: {
          headers: { authorization: `Bearer ${made.mcpToken}`, "x-forwarded-for": "203.0.113.9" },
        },
      }),
    );
    cleanups.push(() => other.close());
    expect((await other.listTools()).tools.length).toBeGreaterThan(0);
  });

  it("lists the tools of a local MCP agent over HTTP, without admin tools", async () => {
    const { server: s, client } = await start({ hooksPort: 0 });
    const made = await call(client, "webhooks.create", {
      name: "grok",
      kind: "inbound",
      mcp: "write",
    });
    const mcp = await mcpClient(s.hooksPort() as number, made.mcpToken);
    const { tools } = await mcp.listTools();
    const names = tools.map((t) => t.name);
    const expected = s.registry
      .list()
      .filter((c) => c.mcp && c.access !== "admin")
      .map((c) => c.mcp?.tool)
      .sort();
    expect(names.sort()).toEqual(expected);
    expect(names).toContain("add_item");
    expect(names).toContain("search");
    for (const admin of s.registry.list().filter((c) => c.access === "admin")) {
      expect(names).not.toContain(admin.mcp?.tool ?? "\u0000");
    }
    expect(names.some((n) => n.startsWith("webhooks") || n.includes("settings"))).toBe(false);
  });

  it("writes as agent:<connector> into the inbox, whatever name the client gives itself", async () => {
    const { server: s, client } = await start({ hooksPort: 0 });
    const made = await call(client, "webhooks.create", {
      name: "grok",
      kind: "inbound",
      mcp: "write",
    });
    const mcp = await mcpClient(s.hooksPort() as number, made.mcpToken);
    const added = await mcp.callTool({
      name: "add_item",
      arguments: { identifier: DOI, why: "via MCP" },
    });
    expect(added.isError).toBeFalsy();
    const inbox = await call(client, "items.list", { inbox: true, limit: 10 });
    const mine = inbox.items.filter((i: { inboxBy?: string }) => i.inboxBy === "agent:grok");
    expect(mine).toHaveLength(1);
    expect(inbox.items.some((i: { inboxBy?: string }) => i.inboxBy === "agent:grok-bot")).toBe(
      false,
    );
  });

  it("never reads a local file for a remote agent", async () => {
    const { server: s, client } = await start({ hooksPort: 0 });
    const made = await call(client, "webhooks.create", {
      name: "grok",
      kind: "inbound",
      mcp: "write",
    });
    const mcp = await mcpClient(s.hooksPort() as number, made.mcpToken);
    const result = await mcp.callTool({
      name: "add_item",
      arguments: { identifier: "/etc/hosts" },
    });
    expect(result.isError).toBe(true);
  });

  it("gives a read-scoped connector only the read-only tools", async () => {
    const { server: s, client } = await start({ hooksPort: 0 });
    const made = await call(client, "webhooks.create", {
      name: "reader",
      kind: "inbound",
      mcp: "read",
    });
    const mcp = await mcpClient(s.hooksPort() as number, made.mcpToken);
    const { tools } = await mcp.listTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
    expect(tools.map((t) => t.name)).not.toContain("add_item");
  });
});
