import { itemsAdd, Registry } from "@citegeist/ops";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, describe, expect, it } from "vitest";
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
