import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterEach, describe, expect, it } from "vitest";
import { EXIT } from "../exit.js";
import { runCli } from "../program.js";
import { createRegistry } from "../registry.js";
import { libraryFlagFromArgv, resolveLibraryPath } from "./library-path.js";
import { readCoreLock } from "./lock.js";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

interface Sandbox {
  root: string;
  localBase: string;
  env: Record<string, string>;
}

async function cg(env: NodeJS.ProcessEnv, args: string[]) {
  let out = "";
  let err = "";
  const code = await runCli(args, {
    registry: createRegistry(env),
    io: {
      stdout: (s) => {
        out += s;
      },
      stderr: (s) => {
        err += s;
      },
      readStdin: async () => "",
      env,
    },
  });
  return { code, out, err };
}

/** A library created with `cg init`, plus one project to read back. */
async function sandbox(): Promise<Sandbox> {
  const root = join(tmp("cg-agent-"), "lib");
  const localBase = tmp("cg-local-");
  const env = { CITEGEIST_LIBRARY: root, CITEGEIST_LOCAL_BASE: localBase };
  const init = await cg(env, ["init", root, "--name", "Sandbox", "--json"]);
  expect(init.err).toBe("");
  expect(init.code).toBe(EXIT.ok);
  const made = await cg(env, [
    "projects",
    "create",
    "systems",
    "--title",
    "Systems theory",
    "--brief",
    "Luhmann and autopoiesis",
  ]);
  expect(made.err).toBe("");
  return { root, localBase, env };
}

function writeLock(sb: Sandbox, content: string): void {
  const id = (JSON.parse(readFileSync(join(sb.root, "citegeist.json"), "utf8")) as { id: string })
    .id;
  mkdirSync(join(sb.localBase, id), { recursive: true });
  writeFileSync(join(sb.localBase, id, "core.lock"), content);
}

function liveProcess(): ChildProcess {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
    stdio: "ignore",
  });
  cleanups.push(() => void child.kill());
  return child;
}

async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const pid = child.pid as number;
  await new Promise((resolve) => child.once("exit", resolve));
  return pid;
}

describe("library path", () => {
  it("prefers the flag, then the environment, then ~/Citegeist", () => {
    expect(resolveLibraryPath({ CITEGEIST_LIBRARY: "/b" }, "/a")).toEqual({
      path: "/a",
      source: "flag",
    });
    expect(resolveLibraryPath({ CITEGEIST_LIBRARY: "/b" })).toEqual({ path: "/b", source: "env" });
    const fallback = resolveLibraryPath({});
    expect(fallback.source).toBe("default");
    expect(fallback.path.endsWith("Citegeist")).toBe(true);
  });

  it("reads --library from an argument list", () => {
    expect(libraryFlagFromArgv(["--library", "/x", "items", "list"])).toBe("/x");
    expect(libraryFlagFromArgv(["items", "--library=/y"])).toBe("/y");
    expect(libraryFlagFromArgv(["items", "list"])).toBeUndefined();
  });

  it("parses lock files in JSON and plain form", () => {
    const dir = tmp("cg-lock-");
    writeFileSync(join(dir, "a"), '{"pid": 12, "port": 7001}');
    writeFileSync(join(dir, "b"), "34\n7002\n");
    expect(readCoreLock(join(dir, "a"))).toEqual({ pid: 12, port: 7001 });
    expect(readCoreLock(join(dir, "b"))).toEqual({ pid: 34, port: 7002 });
    expect(readCoreLock(join(dir, "missing"))).toBeUndefined();
  });
});

describe("cg on the real core", () => {
  it("runs reads and writes against a library created with cg init", async () => {
    const sb = await sandbox();
    const status = await cg(sb.env, ["library", "status", "--json"]);
    expect(status.code).toBe(EXIT.ok);
    expect(JSON.parse(status.out).path).toContain("lib");
    const note = await cg(sb.env, [
      "--actor",
      "agent:test",
      "notes",
      "create",
      "--title",
      "Autopoiesis explains stability",
      "--type",
      "permanent",
      "--json",
    ]);
    expect(note.err).toBe("");
    expect(JSON.parse(note.out).frontmatter.created.by).toBe("agent:test");
    const found = await cg(sb.env, ["search", "query", "autopoiesis", "--json"]);
    expect(JSON.parse(found.out).hits.length).toBeGreaterThan(0);
  });

  it("creates AGENTS.md and CLAUDE.md in the new library", async () => {
    const sb = await sandbox();
    expect(readFileSync(join(sb.root, "AGENTS.md"), "utf8")).toContain("derived/");
    expect(readFileSync(join(sb.root, "CLAUDE.md"), "utf8")).toContain("AGENTS.md");
  });

  it("refuses init for agents and for an existing library", async () => {
    const sb = await sandbox();
    const byAgent = await cg(sb.env, ["--actor", "agent:x", "init", join(sb.root, "other")]);
    expect(byAgent.code).toBe(EXIT.forbidden);
    const again = await cg(sb.env, ["init", sb.root, "--json"]);
    expect(again.code).not.toBe(EXIT.ok);
    expect(JSON.parse(again.err).error.code).toBe("LIBRARY_EXISTS");
  });

  it("refuses write operations while a live core.lock exists, but still reads", async () => {
    const sb = await sandbox();
    const child = liveProcess();
    writeLock(sb, JSON.stringify({ pid: child.pid, port: 4711 }));

    const write = await cg(sb.env, [
      "--actor",
      "agent:test",
      "notes",
      "create",
      "--title",
      "Blocked",
      "--type",
      "permanent",
      "--json",
    ]);
    expect(write.code).toBe(EXIT.askHuman);
    expect(write.out).toBe("");
    const { error } = JSON.parse(write.err) as {
      error: { code: string; fix: string; recovery: string; sideEffects: string };
    };
    expect(error.code).toBe("LIBRARY_OWNED_BY_APP");
    expect(error.recovery).toBe("ask-human");
    expect(error.sideEffects).toBe("none");
    expect(error.fix).toContain("app");

    const read = await cg(sb.env, ["projects", "get", "systems", "--json"]);
    expect(read.code).toBe(EXIT.ok);
  });

  it("ignores a stale core.lock", async () => {
    const sb = await sandbox();
    writeLock(sb, JSON.stringify({ pid: await deadPid(), port: 4711 }));
    const write = await cg(sb.env, [
      "notes",
      "create",
      "--title",
      "Allowed",
      "--type",
      "permanent",
    ]);
    expect(write.err).toBe("");
    expect(write.code).toBe(EXIT.ok);
  });
});

describe("cg mcp on the real core", () => {
  async function connect(sb: Sandbox): Promise<Client> {
    const script = fileURLToPath(new URL("../bin.ts", import.meta.url));
    const client = new Client({ name: "cg-agent-test", version: "1.0.0" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["--import", "tsx", script, "mcp"],
        cwd: fileURLToPath(new URL("../..", import.meta.url)),
        env: { ...(process.env as Record<string, string>), ...sb.env },
        stderr: "inherit",
      }),
    );
    cleanups.push(() => client.close());
    return client;
  }

  it("answers search and get_project from a library created with cg init", async () => {
    const sb = await sandbox();
    await cg(sb.env, ["notes", "create", "--title", "Autopoiesis note", "--type", "permanent"]);
    const client = await connect(sb);

    const project = await client.callTool({ name: "get_project", arguments: { slug: "systems" } });
    expect(project.isError).toBeFalsy();
    expect(JSON.stringify(project.structuredContent)).toContain("Systems theory");

    const search = await client.callTool({ name: "search", arguments: { q: "autopoiesis" } });
    expect(search.isError).toBeFalsy();
    const hits = (search.structuredContent as { hits: Array<{ title: string }> }).hits;
    expect(hits.map((h) => h.title)).toContain("Autopoiesis note");
  });

  it("refuses write tools with an agent-ready error while the app owns the library", async () => {
    const sb = await sandbox();
    writeLock(sb, JSON.stringify({ pid: liveProcess().pid, port: 4711 }));
    const client = await connect(sb);
    const res = await client.callTool({
      name: "create_note",
      arguments: { title: "Blocked", type: "permanent" },
    });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("LIBRARY_OWNED_BY_APP");
  });
});
