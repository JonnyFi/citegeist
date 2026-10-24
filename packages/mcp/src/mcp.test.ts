import { request } from "node:http";
import { fileURLToPath } from "node:url";
import { CONTRACTS } from "@citegeist/ops";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, describe, expect, it } from "vitest";
import { actorFromClientName } from "./actor.js";
import { createFixtureRegistry, FIXTURE_CITEKEY } from "./fixture.js";
import { MAX_INSTRUCTIONS_LENGTH } from "./instructions.js";
import { type McpHttpHandle, startMcpHttpServer } from "./transports.js";

const CLIENT_NAME = "mcp-test-client";
const exposed = CONTRACTS.filter((c) => c.mcp);
const readOnly = exposed.filter((c) => c.mcp?.readOnly);

/** Arguments for each read-only tool. A new read-only contract fails the coverage test below. */
const READ_ARGS: Record<string, Record<string, unknown>> = {
  search: { q: "systeme" },
  get_item: { citekey: FIXTURE_CITEKEY },
  read_document: { citekey: FIXTURE_CITEKEY, pages: "31-32" },
  list_cards: { citekey: FIXTURE_CITEKEY },
  get_project: { slug: "systems" },
  list_projects: {},
  related_works: { citekey: FIXTURE_CITEKEY, direction: "references" },
  cite: { items: [{ citekey: FIXTURE_CITEKEY, locator: "31" }] },
  jobs_get: { job: "j_01JB8Z3QK7ABCDEFGH" },
  find_insights: { project: "systems", query: "Mechanismus" },
};

const stdioScript = fileURLToPath(new URL("./testing/fixture-stdio.ts", import.meta.url));
const packageDir = fileURLToPath(new URL("..", import.meta.url));

const cleanups: Array<() => Promise<void>> = [];
afterAll(async () => {
  await Promise.all(cleanups.map((c) => c()));
});

const MODERN = { versionNegotiation: { mode: { pin: "2026-07-28" } } } as const;

async function connectStdio(scope: "read" | "write" = "write", modern = false): Promise<Client> {
  const client = new Client({ name: CLIENT_NAME, version: "1.0.0" }, modern ? MODERN : undefined);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", stdioScript],
    cwd: packageDir,
    env: { ...(process.env as Record<string, string>), CITEGEIST_MCP_SCOPE: scope },
    stderr: "inherit",
  });
  await client.connect(transport);
  cleanups.push(() => client.close());
  return client;
}

let http: McpHttpHandle | undefined;
async function httpServer(): Promise<McpHttpHandle> {
  if (!http) {
    const handle = await startMcpHttpServer(createFixtureRegistry(), {
      tokens: [
        { token: "write-token", scope: "write" },
        { token: "read-token", scope: "read" },
      ],
    });
    cleanups.push(() => handle.close());
    http = handle;
  }
  return http;
}

async function connectHttp(token: string, modern = false): Promise<Client> {
  const handle = await httpServer();
  const client = new Client({ name: CLIENT_NAME, version: "1.0.0" }, modern ? MODERN : undefined);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(handle.url), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  cleanups.push(() => client.close());
  return client;
}

function textOf(result: { content?: unknown }): string {
  const block = (result.content as Array<{ type: string; text?: string }>)[0];
  return block?.text ?? "";
}

const transports: Array<[string, () => Promise<Client>]> = [
  ["stdio", () => connectStdio()],
  ["http", () => connectHttp("write-token")],
  ["stdio (2026-07-28)", () => connectStdio("write", true)],
  ["http (2026-07-28)", () => connectHttp("write-token", true)],
];

describe.each(transports)("MCP over %s", (_label, connect) => {
  it("lists one tool per contract with mcp set, with schemas and hints", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(exposed.map((c) => c.mcp?.tool).sort());
    for (const contract of exposed) {
      const tool = tools.find((t) => t.name === contract.mcp?.tool);
      expect(tool?.description).toBe(contract.summary);
      expect(tool?.inputSchema.type).toBe("object");
      expect(tool?.outputSchema?.type).toBe("object");
      expect(tool?.annotations?.readOnlyHint).toBe(contract.mcp?.readOnly);
      expect(tool?.annotations?.idempotentHint).toBe(contract.mcp?.idempotent);
    }
  });

  it("sends instructions under 4,096 characters that explain the inbox default", async () => {
    const client = await connect();
    const text = client.getInstructions() ?? "";
    expect(text.length).toBeGreaterThan(200);
    expect(text.length).toBeLessThan(MAX_INSTRUCTIONS_LENGTH);
    expect(text).toContain("inbox");
    expect(text).toContain('"library"');
    expect(text).toContain("citekey");
    expect(text).toContain("scope");
  });

  it("has an argument table for every read-only tool", () => {
    expect(Object.keys(READ_ARGS).sort()).toEqual(readOnly.map((c) => c.mcp?.tool).sort());
  });

  it("calls every read-only tool and returns text plus structuredContent", async () => {
    const client = await connect();
    for (const contract of readOnly) {
      const tool = contract.mcp?.tool ?? "";
      const result = await client.callTool({ name: tool, arguments: READ_ARGS[tool] ?? {} });
      expect(result.isError, `${tool}: ${textOf(result)}`).toBeFalsy();
      expect(textOf(result)).toContain(`${tool}: ok`);
      expect(result.structuredContent, tool).toBeTypeOf("object");
      const expected = contract.output.safeParse(result.structuredContent);
      expect(expected.success, tool).toBe(true);
    }
  });

  it("maps a CitegeistError to isError with code, message and fix", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "get_item",
      arguments: { citekey: "nobody0000" },
    });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("ITEM_NOT_FOUND");
    expect(text).toContain("nobody0000");
    expect(text.split("\n").at(-1)).toMatch(/^Fix: /);
  });

  it("names tools, not operations, in the fix of an error", async () => {
    const client = await connect();
    const result = await client.callTool({ name: "get_project", arguments: { slug: "nope" } });
    expect(result.isError).toBe(true);
    const fix = textOf(result).split("\n").at(-1) ?? "";
    expect(fix).toContain("list_projects");
    expect(fix).not.toMatch(/projects\.list/);
  });

  it("defaults add_item to the inbox and stamps the client name as actor", async () => {
    const client = await connect();
    const added = await client.callTool({
      name: "add_item",
      arguments: { identifier: "10.1000/x", why: "relevant for chapter 2" },
    });
    expect(added.isError).toBeFalsy();
    const citekey = (added.structuredContent as { citekey: string }).citekey;
    const got = await client.callTool({ name: "get_item", arguments: { citekey } });
    const inbox = (got.structuredContent as { frontmatter: { inbox?: { by: string } } }).frontmatter
      .inbox;
    expect(inbox?.by).toBe(`agent:${CLIENT_NAME}`);
  });

  it("accepts target library and rejects invalid input as an error result", async () => {
    const client = await connect();
    const added = await client.callTool({
      name: "add_item",
      arguments: { identifier: "10.1000/y", target: "library" },
    });
    expect(added.isError).toBeFalsy();
    const bad = await client
      .callTool({ name: "add_item", arguments: { identifier: "10.1000/y", target: "elsewhere" } })
      .catch((e: Error) => e);
    const failed = bad instanceof Error || (bad as { isError?: boolean }).isError === true;
    expect(failed).toBe(true);
  });
});

describe("MCP over stdio with read scope", () => {
  it("lists only the read-only tools", async () => {
    const client = await connectStdio("read");
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(readOnly.map((c) => c.mcp?.tool).sort());
  });
});

describe("MCP over HTTP security", () => {
  it("lists only read-only tools for a read-scoped token", async () => {
    const client = await connectHttp("read-token");
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(readOnly.map((c) => c.mcp?.tool).sort());
  });

  function post(
    handle: McpHttpHandle,
    headers: Record<string, string>,
    path = "/mcp",
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port: handle.port, path, method: "POST", headers },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }));
    });
  }
  const json = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };

  it("rejects a request without a token", async () => {
    const handle = await httpServer();
    expect(await post(handle, json)).toBe(401);
  });

  it("rejects a wrong token", async () => {
    const handle = await httpServer();
    expect(await post(handle, { ...json, authorization: "Bearer nope" })).toBe(401);
  });

  it("rejects a wrong Origin even with a valid token", async () => {
    const handle = await httpServer();
    const auth = { ...json, authorization: "Bearer write-token" };
    expect(await post(handle, { ...auth, origin: "https://evil.example" })).toBe(403);
    expect(await post(handle, { ...auth, origin: "http://localhost:3000" })).not.toBe(403);
  });

  it("rejects a foreign Host header (DNS rebinding)", async () => {
    const handle = await httpServer();
    expect(
      await post(handle, { ...json, authorization: "Bearer write-token", host: "evil.example" }),
    ).toBe(403);
  });

  it("answers other paths with 404 after authentication", async () => {
    const handle = await httpServer();
    expect(await post(handle, { ...json, authorization: "Bearer write-token" }, "/other")).toBe(
      404,
    );
  });

  it("refuses to bind a non-loopback host", async () => {
    await expect(
      startMcpHttpServer(createFixtureRegistry(), {
        tokens: [{ token: "t", scope: "read" }],
        host: "0.0.0.0",
      }),
    ).rejects.toThrow(/loopback/);
  });
});

describe("actorFromClientName", () => {
  it("normalizes client names into agent actors", () => {
    expect(actorFromClientName("Claude Code")).toBe("agent:claude-code");
    expect(actorFromClientName("codex_cli.v2")).toBe("agent:codex_cli.v2");
    expect(actorFromClientName(undefined)).toBe("agent:mcp");
    expect(actorFromClientName("***")).toBe("agent:mcp");
  });
});
