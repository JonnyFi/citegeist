import type { Registry } from "@citegeist/ops";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, describe, expect, it } from "vitest";
import { createFixtureRegistry } from "./fixture.js";
import { mcpContracts, TOOLS_LIST_TTL_MS } from "./server.js";
import { type McpHttpHandle, startMcpHttpServer } from "./transports.js";

/** The fixture registry with its operations listed in reverse registration order. */
function reversed(): Registry {
  const registry = createFixtureRegistry();
  const list = registry.list();
  return Object.assign(Object.create(registry) as Registry, {
    list: () => [...list].reverse(),
  });
}

const names = (contracts: ReturnType<typeof mcpContracts>) => contracts.map((c) => c.mcp?.tool);

describe("tools/list order", () => {
  it("is sorted by tool name whatever the registration order", () => {
    for (const scope of ["read", "write"] as const) {
      const forward = names(mcpContracts(createFixtureRegistry(), scope));
      expect(forward).toEqual([...forward].sort());
      expect(names(mcpContracts(reversed(), scope))).toEqual(forward);
    }
  });
});

const handles: McpHttpHandle[] = [];
afterAll(async () => {
  await Promise.all(handles.map((h) => h.close()));
});

async function listOver(modern: boolean) {
  const handle = await startMcpHttpServer(reversed(), { tokens: [{ token: "t", scope: "write" }] });
  handles.push(handle);
  const client = new Client(
    { name: "tools-list-test", version: "1.0.0" },
    modern ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : undefined,
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL(handle.url), {
      requestInit: { headers: { authorization: "Bearer t" } },
    }),
  );
  const first = await client.listTools();
  const second = await client.listTools();
  await client.close();
  return { first, second };
}

describe.each([
  ["2025 session", false],
  ["2026-07-28", true],
])("tools/list over HTTP (%s)", (_label, modern) => {
  it("returns the same sorted tools on every call", async () => {
    const { first, second } = await listOver(modern);
    const wire = first.tools.map((t) => t.name);
    expect(wire).toEqual([...wire].sort());
    expect(second.tools.map((t) => t.name)).toEqual(wire);
  });

  it.runIf(modern)("sets ttlMs and a private cache scope", async () => {
    const { first } = await listOver(modern);
    expect(first).toMatchObject({ ttlMs: TOOLS_LIST_TTL_MS, cacheScope: "private" });
  });
});
