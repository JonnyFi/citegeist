import { fileURLToPath } from "node:url";
import { createFixtureRegistry, FIXTURE_CITEKEY } from "@citegeist/mcp";
import { CONTRACTS, type Registry } from "@citegeist/ops";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { describe, expect, it } from "vitest";
import { EXIT } from "./exit.js";
import { commandPath } from "./flags.js";
import { runCli } from "./program.js";
import { createRegistry } from "./registry.js";

interface Result {
  code: number;
  out: string;
  err: string;
}

async function cg(
  args: string[],
  opts: { registry?: Registry; env?: NodeJS.ProcessEnv; stdin?: string } = {},
): Promise<Result> {
  let out = "";
  let err = "";
  const code = await runCli(args, {
    registry: opts.registry ?? createFixtureRegistry(),
    io: {
      stdout: (s) => {
        out += s;
      },
      stderr: (s) => {
        err += s;
      },
      readStdin: async () => opts.stdin ?? "",
      env: opts.env ?? {},
    },
  });
  return { code, out, err };
}

describe("cg errors", () => {
  it("names the cg command in a fix that points to another operation", async () => {
    const r = await cg(["projects", "get", "nope"]);
    expect(r.err.trimEnd().split("\n").at(-1)).toContain("cg projects list");
    expect(r.err).not.toMatch(/projects\.list/);
  });
});

describe("cg", () => {
  it("adds an item with --json", async () => {
    const r = await cg(["items", "add", "10.1000/x", "--json"]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.err).toBe("");
    const out = JSON.parse(r.out) as { citekey: string; job: string };
    expect(out.citekey).toMatch(/^[a-z0-9]/);
    expect(out.job).toMatch(/^j_/);
  });

  it("prints readable text without --json", async () => {
    const r = await cg(["items", "add", "10.1000/x"]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toMatch(/^citekey: \w+\njob: j_\w+\n$/);
  });

  it("passes the actor and the inbox default through", async () => {
    const registry = createFixtureRegistry();
    const added = await cg(
      ["--actor", "agent:codex", "items", "add", "10.1000/x", "--why", "chapter 2", "--json"],
      { registry },
    );
    const { citekey } = JSON.parse(added.out) as { citekey: string };
    const got = await cg(["items", "get", citekey, "--json"], { registry });
    const item = JSON.parse(got.out) as {
      frontmatter: { inbox?: { by: string; why?: string } };
    };
    expect(item.frontmatter.inbox).toEqual({ by: "agent:codex", why: "chapter 2" });

    const direct = await cg(["items", "add", "10.1000/y", "--target", "library", "--json"], {
      registry,
      env: { CITEGEIST_ACTOR: "agent:codex" },
    });
    expect(direct.code).toBe(EXIT.ok);
  });

  it("reports a missing item as an agent-ready error with its own exit code", async () => {
    const r = await cg(["items", "get", "nobody0000", "--json"]);
    expect(r.code).toBe(EXIT.notFound);
    expect(r.out).toBe("");
    const { error } = JSON.parse(r.err) as {
      error: { code: string; message: string; fix: string; recovery: string };
    };
    expect(error.code).toBe("ITEM_NOT_FOUND");
    expect(error.message).toContain("nobody0000");
    expect(error.fix).toContain("search");
    expect(error.recovery).toBe("fix-and-retry");
  });

  it("puts the fix on the last line of a human error", async () => {
    const r = await cg(["items", "get", "nobody0000"]);
    expect(r.code).toBe(EXIT.notFound);
    expect(r.err).toContain("ITEM_NOT_FOUND");
    expect(r.err.trimEnd().split("\n").at(-1)).toMatch(/^Fix: /);
  });

  it("gives each failure class its own exit code", async () => {
    const codes = new Set([
      (await cg(["items", "add", "--json"])).code,
      (await cg(["items", "get", "nobody0000"])).code,
      (await cg(["items", "add", "invalid"])).code,
      (await cg(["--actor", "agent:x", "library", "reindex"])).code,
      (await cg(["library", "reindex"])).code,
      (await cg(["no", "such", "command"])).code,
    ]);
    expect([...codes].sort()).toEqual([
      EXIT.usage,
      EXIT.notFound,
      EXIT.forbidden,
      EXIT.askHuman,
      EXIT.fixAndRetry,
    ]);
  });

  it("explains invalid input with the offending field", async () => {
    const r = await cg(["items", "add", "--json"]);
    expect(r.code).toBe(EXIT.usage);
    const { error } = JSON.parse(r.err) as {
      error: { code: string; message: string; fix: string };
    };
    expect(error.code).toBe("INVALID_INPUT");
    expect(error.message).toContain("identifier");
    expect(error.fix).toContain("cg items add --help");
  });

  it("refuses admin operations for agents", async () => {
    const r = await cg(["--actor", "agent:x", "library", "reindex", "--json"]);
    expect(r.code).toBe(EXIT.forbidden);
    expect(JSON.parse(r.err).error.code).toBe("FORBIDDEN_ADMIN");
  });

  it("rejects a malformed actor", async () => {
    const r = await cg(["--actor", "grok", "library", "status"]);
    expect(r.code).toBe(EXIT.usage);
    expect(r.err).toContain("USAGE_ERROR");
  });

  it("maps flag kinds: number, boolean, repeated list, JSON", async () => {
    const list = JSON.parse((await cg(["items", "list", "--inbox", "--limit", "5", "--json"])).out);
    expect(list.items).toEqual([]);
    const all = JSON.parse((await cg(["items", "list", "--no-inbox", "--json"])).out);
    expect(all.items).toHaveLength(1);
    const search = await cg([
      "search",
      "query",
      "systeme",
      "--kinds",
      "item",
      "--kinds",
      "card",
      "--json",
    ]);
    expect(search.code).toBe(EXIT.ok);
    const cite = await cg([
      "cite",
      "format",
      "--items",
      JSON.stringify([{ citekey: FIXTURE_CITEKEY, locator: "31" }]),
      "--json",
    ]);
    expect(JSON.parse(cite.out).text).toBe("(Luhmann 1984, p. 31)");
    const badJson = await cg(["cite", "format", "--items", "{oops", "--json"]);
    expect(badJson.code).toBe(EXIT.usage);
  });

  it("reads a whole input from --input and --input-file -", async () => {
    const a = await cg(["items", "add", "--input", '{"identifier":"10.1000/a"}', "--json"]);
    expect(a.code).toBe(EXIT.ok);
    const b = await cg(["items", "add", "--input-file", "-", "--target", "library", "--json"], {
      stdin: '{"identifier":"10.1000/b"}',
    });
    expect(b.code).toBe(EXIT.ok);
  });

  it("accepts a variadic positional", async () => {
    const r = await cg(["inbox", "accept", "a1", "b2", "--json"]);
    expect(r.code).toBe(EXIT.ok);
    expect(JSON.parse(r.out)).toEqual({ ok: true });
  });

  it("generates a command with help for every contract", async () => {
    for (const contract of CONTRACTS) {
      const r = await cg([...commandPath(contract), "--help"]);
      expect(r.code, contract.name).toBe(EXIT.ok);
      expect(r.out.replace(/\s+/g, " "), contract.name).toContain(contract.summary);
    }
    const root = await cg(["--help"]);
    for (const group of new Set(CONTRACTS.map((c) => commandPath(c)[0]))) {
      expect(root.out).toContain(group);
    }
    expect(root.out).toContain("mcp");
    expect(root.out).toContain("Exit codes:");
  });

  it("also answers to the camelCase name from the contract", async () => {
    const r = await cg(["documents", "confirmPages", "--help"]);
    expect(r.code).toBe(EXIT.ok);
  });

  it("reports a missing library with the way to create one", async () => {
    const env = { CITEGEIST_LIBRARY: "/nonexistent/citegeist-library" };
    const r = await cg(["library", "status", "--json"], { registry: createRegistry(env) });
    expect(r.code).toBe(EXIT.notFound);
    const { error } = JSON.parse(r.err);
    expect(error.code).toBe("LIBRARY_NOT_FOUND");
    expect(error.fix).toContain("cg init");
  });
});

describe("cg mcp", () => {
  it("serves the MCP tools over stdio", async () => {
    const script = fileURLToPath(new URL("./bin.ts", import.meta.url));
    const client = new Client({ name: "cg-test", version: "1.0.0" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["--import", "tsx", script, "mcp"],
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        env: { ...(process.env as Record<string, string>), CITEGEIST_FIXTURE: "1" },
        stderr: "inherit",
      }),
    );
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(
        CONTRACTS.flatMap((c) => (c.mcp ? [c.mcp.tool] : [])).sort(),
      );
      const res = await client.callTool({
        name: "get_item",
        arguments: { citekey: FIXTURE_CITEKEY },
      });
      expect(res.isError).toBeFalsy();
    } finally {
      await client.close();
    }
  });
});
