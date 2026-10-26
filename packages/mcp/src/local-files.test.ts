import { CONTRACTS, itemsAdd, Registry } from "@citegeist/ops";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, describe, expect, it } from "vitest";
import { mcpContracts } from "./server.js";
import { type McpHttpHandle, startMcpHttpServer } from "./transports.js";

// M4: the token decides whether a call may make the core read local files. The flag travels in
// the operation context, so the core can refuse in items.add and items.attach.

const MODERN = { versionNegotiation: { mode: { pin: "2026-07-28" } } } as const;
const seen: Array<boolean | undefined> = [];

function registry(): Registry {
  return new Registry().bind(itemsAdd, async (ctx) => {
    seen.push(ctx.localFiles);
    return { citekey: "fixture1", job: "j_01JB8Z3QK7ABCDEFGH" };
  });
}

const cleanups: Array<() => Promise<void>> = [];
afterAll(async () => {
  await Promise.all(cleanups.map((c) => c()));
});

let handle: McpHttpHandle | undefined;
async function server(): Promise<McpHttpHandle> {
  handle ??= await startMcpHttpServer(registry(), {
    tokens: [
      { token: "chat-token", scope: "write" },
      { token: "research-token", scope: "write", localFiles: false },
    ],
  });
  const started = handle;
  cleanups.push(() => started.close());
  return started;
}

async function connect(token: string, modern: boolean): Promise<Client> {
  const { url } = await server();
  const client = new Client(
    { name: "local-files-test", version: "1.0.0" },
    modern ? MODERN : undefined,
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  cleanups.push(() => client.close());
  return client;
}

describe("research scope", () => {
  it("sees the read tools and add_item, nothing else that changes the library", () => {
    const all = new Registry();
    for (const c of CONTRACTS) all.bind(c, async () => ({}));
    const tools = mcpContracts(all, "research").map((c) => c.mcp?.tool);
    const changing = CONTRACTS.filter((c) => c.mcp && !c.mcp.readOnly).map((c) => c.mcp?.tool);
    expect(tools).toContain("add_item");
    expect(tools).toContain("search");
    for (const tool of changing)
      expect(tools.includes(tool), String(tool)).toBe(tool === "add_item");
    // No operation of the admin class (webhooks, settings, jobs) is ever a tool.
    expect(mcpContracts(all, "research").every((c) => c.access !== "admin")).toBe(true);
    expect(tools.length).toBeLessThan(mcpContracts(all, "write").length);
  });

  it("passes the egress limit to the operation and forbids local files", async () => {
    const egressSeen: Array<string | undefined> = [];
    const reg = new Registry().bind(itemsAdd, async (ctx) => {
      egressSeen.push(ctx.egress);
      seen.push(ctx.localFiles);
      return { citekey: "fixture1", job: "j_01JB8Z3QK7ABCDEFGH" };
    });
    const h = await startMcpHttpServer(reg, {
      tokens: [{ token: "r", scope: "research" }],
    });
    cleanups.push(() => h.close());
    seen.length = 0;
    for (const modern of [false, true]) {
      const client = new Client({ name: "t", version: "1" }, modern ? MODERN : undefined);
      await client.connect(
        new StreamableHTTPClientTransport(new URL(h.url), {
          requestInit: { headers: { authorization: "Bearer r" } },
        }),
      );
      cleanups.push(() => client.close());
      await client.callTool({ name: "add_item", arguments: { identifier: "10.1000/x" } });
    }
    expect(egressSeen).toEqual(["scholarly", "scholarly"]);
    expect(seen).toEqual([false, false]);
  });
});

describe.each([
  ["2025 sessions", false],
  ["2026-07-28 requests", true],
])("local files over MCP HTTP (%s)", (_label, modern) => {
  it("tells the operation when the token may not read local files", async () => {
    seen.length = 0;
    const research = await connect("research-token", modern);
    await research.callTool({ name: "add_item", arguments: { identifier: "/etc/hosts.pdf" } });
    expect(seen).toEqual([false]);
  });

  it("leaves the flag unset for a token without the restriction", async () => {
    seen.length = 0;
    const chat = await connect("chat-token", modern);
    await chat.callTool({ name: "add_item", arguments: { identifier: "10.1000/x" } });
    expect(seen).toEqual([undefined]);
  });
});
