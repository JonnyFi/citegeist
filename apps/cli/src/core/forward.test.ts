import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cannedAiBackend,
  createRuntime,
  createStubWorker,
  Library,
  type Runtime,
} from "@citegeist/core";
import { createReplayFetch, createResolver } from "@citegeist/metadata";
import type { Registry } from "@citegeist/ops";
import { Actor, CitegeistError } from "@citegeist/schema";
import { LockHeldError, startCoreServer } from "@citegeist/server";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { ORPCError, os } from "@orpc/server";
import { RPCHandler } from "@orpc/server/node";
import { afterEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { EXIT } from "../exit.js";
import { runCli } from "../program.js";
import { createRegistry } from "../registry.js";
import { ACTOR_HEADER, findRunningCore, forwardCall } from "./forward.js";
import { readCoreLock } from "./lock.js";

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

interface Sandbox {
  root: string;
  localBase: string;
  libraryId: string;
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

async function sandbox(): Promise<Sandbox> {
  const root = join(tmp("cg-fwd-"), "lib");
  const localBase = tmp("cg-fwd-local-");
  const env = { CITEGEIST_LIBRARY: root, CITEGEIST_LOCAL_BASE: localBase };
  const init = await cg(env, ["init", root, "--name", "Sandbox"]);
  expect(init.err).toBe("");
  const libraryId = (
    JSON.parse(readFileSync(join(root, "citegeist.json"), "utf8")) as { id: string }
  ).id;
  return { root, localBase, libraryId, env };
}

function liveProcess(): ChildProcess {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
    stdio: "ignore",
  });
  cleanups.push(() => void child.kill());
  return child;
}

interface FakeCore {
  calls: Array<{ name: string; actor: string }>;
  lib: Library;
  registry: Registry;
}

const NOT_FOUND = new Set(["ITEM_NOT_FOUND", "PROJECT_NOT_FOUND", "NOTE_NOT_FOUND"]);

function orpcError(err: unknown): ORPCError<string, unknown> {
  if (err instanceof ORPCError) return err;
  if (err instanceof CitegeistError) {
    return new ORPCError(NOT_FOUND.has(err.detail.code) ? "NOT_FOUND" : "BAD_REQUEST", {
      message: err.detail.message,
      data: err.detail,
    });
  }
  if (err instanceof ZodError) {
    const message = `invalid input: ${err.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`;
    return new ORPCError("BAD_REQUEST", { message, data: { message } });
  }
  return new ORPCError("INTERNAL_SERVER_ERROR", { message: String(err), data: { message: "x" } });
}

/**
 * Stands in for the app: a real runtime on the sandbox library behind the same oRPC surface the
 * desktop core serves, with the lock and token files in the machine-local directory. `actors`
 * says whether it takes the caller's name from the actor header.
 */
async function startFakeCore(sb: Sandbox, opts: { actors: boolean }): Promise<FakeCore> {
  const lib = await Library.open(sb.root, { localBase: sb.localBase, watch: false });
  const runtime: Runtime = createRuntime(lib, {
    worker: createStubWorker(),
    resolver: createResolver({
      config: { mailto: "tester@example.invalid" },
      fetch: createReplayFetch(
        fileURLToPath(new URL("../../../../fixtures/metadata/http", import.meta.url)),
      ),
      sleep: async () => {},
    }),
    ai: { backends: [cannedAiBackend()] },
  });
  const registry = runtime.registry;
  const calls: FakeCore["calls"] = [];

  const base = os.$context<{ actor: Actor }>();
  const root: Record<string, unknown> = {};
  for (const contract of registry.list()) {
    const segments = contract.name.split(".");
    const leaf = segments.pop() as string;
    let node = root;
    for (const s of segments) {
      node[s] ??= {};
      node = node[s] as Record<string, unknown>;
    }
    node[leaf] = base.handler(async ({ input, context }) => {
      calls.push({ name: contract.name, actor: context.actor });
      try {
        return await registry.call(contract.name, { actor: context.actor }, input);
      } catch (err) {
        throw orpcError(err);
      }
    });
  }
  const rpc = new RPCHandler(root as never);
  const token = "fake-session-token";
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${token}`) return reply(401, { error: "token" });
    if (req.url === "/health") return reply(200, { ok: true, actors: opts.actors });
    const header = req.headers[ACTOR_HEADER];
    const parsed = Actor.safeParse(Array.isArray(header) ? header[0] : header);
    const actor: Actor = opts.actors && parsed.success ? parsed.data : "human";
    rpc
      .handle(req, res, { prefix: "/rpc", context: { actor } })
      .then(({ matched }) => {
        if (!matched) reply(404, { error: "not found" });
      })
      .catch(() => reply(500, { error: "internal" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  // The lock names a live process other than this one, as a real app's would.
  const holder = liveProcess();
  const dir = join(sb.localBase, sb.libraryId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "core.token"), `${token}\n`, { mode: 0o600 });
  writeFileSync(
    join(dir, "core.lock"),
    `${JSON.stringify({ pid: holder.pid, port, started: new Date().toISOString() })}\n`,
  );
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await runtime.close();
    await lib.close();
  });
  return { calls, lib, registry };
}

async function finished(env: NodeJS.ProcessEnv, job: string): Promise<string> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const got = await cg(env, ["jobs", "get", job, "--json"]);
    const status = (JSON.parse(got.out) as { status: string }).status;
    if (["succeeded", "failed", "canceled"].includes(status)) return status;
    if (Date.now() > deadline) throw new Error("job did not finish");
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe("cg forwards to a running app core", () => {
  it("sends reads and human writes to the core instead of opening the library", async () => {
    const sb = await sandbox();
    const core = await startFakeCore(sb, { actors: true });

    const made = await cg(sb.env, [
      "notes",
      "create",
      "--title",
      "Written through the app",
      "--type",
      "permanent",
      "--json",
    ]);
    expect(made.err).toBe("");
    expect(made.code).toBe(EXIT.ok);
    const note = JSON.parse(made.out) as { frontmatter: { id: string; created: { by: string } } };
    expect(note.frontmatter.created.by).toBe("human");

    const found = await cg(sb.env, ["search", "query", "app", "--json"]);
    expect(found.code).toBe(EXIT.ok);
    expect(JSON.parse(found.out).hits.map((h: { title: string }) => h.title)).toContain(
      "Written through the app",
    );
    expect(core.calls.map((c) => c.name)).toEqual(["notes.create", "search.query"]);
    expect(core.lib.getNote(note.frontmatter.id).frontmatter.title).toBe("Written through the app");
  });

  it("carries the agent name along, so D7 puts the paper in the inbox", async () => {
    const sb = await sandbox();
    const core = await startFakeCore(sb, { actors: true });

    const added = await cg(sb.env, [
      "--actor",
      "agent:grok-bot",
      "items",
      "add",
      "10.1086/225469",
      "--why",
      "weak ties",
      "--json",
    ]);
    expect(added.err).toBe("");
    expect(added.code).toBe(EXIT.ok);
    const { citekey, job } = JSON.parse(added.out) as { citekey: string; job: string };
    expect(core.calls[0]).toEqual({ name: "items.add", actor: "agent:grok-bot" });
    expect(await finished(sb.env, job)).not.toBe("failed");

    const got = await cg(sb.env, ["items", "get", citekey, "--json"]);
    const fm = (JSON.parse(got.out) as { frontmatter: { inbox?: { by: string; why?: string } } })
      .frontmatter;
    expect(fm.inbox).toMatchObject({ by: "agent:grok-bot", why: "weak ties" });

    const direct = await cg(sb.env, [
      "--actor",
      "agent:grok-bot",
      "items",
      "add",
      "10.1016/S0140-6736(97)11096-0",
      "--target",
      "library",
      "--json",
    ]);
    expect(direct.code).toBe(EXIT.ok);
    const second = JSON.parse(direct.out) as { citekey: string; job: string };
    await finished(sb.env, second.job);
    const inLibrary = await cg(sb.env, ["items", "get", second.citekey, "--json"]);
    expect(
      (JSON.parse(inLibrary.out) as { frontmatter: { inbox?: unknown } }).frontmatter.inbox,
    ).toBeUndefined();
  });

  it("hands the core's errors back with their code, fix and exit code", async () => {
    const sb = await sandbox();
    await startFakeCore(sb, { actors: true });
    const missing = await cg(sb.env, ["notes", "get", "n_01JB8Z3QK7ABCDEFGHJKMNPQRS", "--json"]);
    expect(missing.code).toBe(EXIT.notFound);
    const { error } = JSON.parse(missing.err) as { error: { code: string; fix: string } };
    expect(error.code).toBe("NOTE_NOT_FOUND");
    expect(error.fix).toContain("search");
  });

  it("refuses an agent write when the core cannot take the actor, but forwards the human", async () => {
    const sb = await sandbox();
    const core = await startFakeCore(sb, { actors: false });

    const agent = await cg(sb.env, [
      "--actor",
      "agent:grok-bot",
      "notes",
      "create",
      "--title",
      "Would be stamped human",
      "--type",
      "permanent",
      "--json",
    ]);
    expect(agent.code).toBe(EXIT.askHuman);
    expect(agent.out).toBe("");
    expect(JSON.parse(agent.err).error.code).toBe("LIBRARY_OWNED_BY_APP");
    expect(core.calls).toEqual([]);

    const read = await cg(sb.env, ["--actor", "agent:grok-bot", "library", "status", "--json"]);
    expect(read.code).toBe(EXIT.ok);

    const human = await cg(sb.env, [
      "notes",
      "create",
      "--title",
      "By the user",
      "--type",
      "permanent",
    ]);
    expect(human.code).toBe(EXIT.ok);
    expect(core.calls.map((c) => c.name)).toEqual(["library.status", "notes.create"]);
  });

  it("ignores a core that does not answer and keeps refusing writes", async () => {
    const sb = await sandbox();
    const holder = liveProcess();
    const dir = join(sb.localBase, sb.libraryId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "core.token"), "t\n");
    writeFileSync(join(dir, "core.lock"), JSON.stringify({ pid: holder.pid, port: 1 }));
    const write = await cg(sb.env, ["notes", "create", "--title", "x", "--type", "permanent"]);
    expect(write.code).toBe(EXIT.askHuman);
    const read = await cg(sb.env, ["library", "status", "--json"]);
    expect(read.code).toBe(EXIT.ok);
  });
});

describe("cg mcp", () => {
  async function connect(sb: Sandbox, name: string): Promise<Client> {
    const script = fileURLToPath(new URL("../bin.ts", import.meta.url));
    const client = new Client({ name, version: "1.0.0" });
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

  it("forwards write tools to the running app, which stays the only writer", async () => {
    const sb = await sandbox();
    const core = await startFakeCore(sb, { actors: true });
    const client = await connect(sb, "grok-bot");

    const note = await client.callTool({
      name: "create_note",
      arguments: { title: "Through MCP and the app", body: "Text.", type: "permanent" },
    });
    expect(note.isError, JSON.stringify(note.content)).toBeFalsy();
    const id = (note.structuredContent as { frontmatter: { id: string } }).frontmatter.id;
    expect(core.lib.getNote(id).frontmatter.created.by).toBe("agent:grok-bot");

    const added = await client.callTool({
      name: "add_item",
      arguments: { identifier: "10.1086/225469", why: "chapter 2" },
    });
    expect(added.isError, JSON.stringify(added.content)).toBeFalsy();
    const { citekey, job } = added.structuredContent as { citekey: string; job: string };

    const deadline = Date.now() + 20_000;
    for (;;) {
      const got = await client.callTool({ name: "jobs_get", arguments: { job } });
      const status = (got.structuredContent as { status: string }).status;
      if (status === "succeeded") break;
      expect(status).not.toBe("failed");
      if (Date.now() > deadline) throw new Error("job did not finish");
      await new Promise((r) => setTimeout(r, 100));
    }
    const item = core.lib.getItem(citekey);
    expect(item.frontmatter.inbox).toMatchObject({ by: "agent:grok-bot", why: "chapter 2" });

    const linked = await client.callTool({
      name: "link",
      arguments: { from: id, link: { to: `[[${citekey}]]`, rel: "supports", why: "same claim" } },
    });
    expect(linked.isError, JSON.stringify(linked.content)).toBeFalsy();
    expect(core.calls.map((c) => c.name)).toEqual(
      expect.arrayContaining(["notes.create", "items.add", "jobs.get", "links.create"]),
    );
    expect(core.calls.every((c) => c.actor === "agent:grok-bot")).toBe(true);
  });

  it("starts a watcher when it owns the library, so edits made outside are indexed", async () => {
    const sb = await sandbox();
    const client = await connect(sb, "watch-test");
    const none = await client.callTool({ name: "search", arguments: { q: "quokkas" } });
    expect((none.structuredContent as { hits: unknown[] }).hits).toHaveLength(0);

    writeFileSync(
      join(sb.root, "notes", "edited-outside.md"),
      [
        "---",
        "id: n_01JB8Z3QK7ABCDEFGHJKMNPQRS",
        "type: permanent",
        "title: Quokkas edited outside",
        "links: []",
        "tags: []",
        "projects: []",
        "created:",
        "  at: 2026-10-23T10:00:00Z",
        "  by: human",
        "---",
        "A note written by hand in the folder.",
        "",
      ].join("\n"),
    );
    const deadline = Date.now() + 20_000;
    for (;;) {
      const found = await client.callTool({ name: "search", arguments: { q: "quokkas" } });
      const hits = (found.structuredContent as { hits: Array<{ title: string }> }).hits;
      if (hits.some((h) => h.title === "Quokkas edited outside")) break;
      if (Date.now() > deadline) throw new Error("the watcher did not index the file");
      await new Promise((r) => setTimeout(r, 100));
    }
  });
  it("takes core.lock with a port, so the app attaches instead of opening a second writer", async () => {
    const sb = await sandbox();
    const owner = await connect(sb, "owner-bot");
    const made = await owner.callTool({
      name: "create_note",
      arguments: { title: "Owned by cg mcp", type: "permanent" },
    });
    expect(made.isError, JSON.stringify(made.content)).toBeFalsy();

    const dir = join(sb.localBase, sb.libraryId);
    const lock = readCoreLock(join(dir, "core.lock"));
    expect(lock?.pid).toBeGreaterThan(0);
    expect(lock?.pid).not.toBe(process.pid);
    expect(lock?.port).toBeGreaterThan(0);

    // The app side: a second core for the library fails on the lock and finds the holder.
    await expect(
      startCoreServer({ library: sb.root, localBase: sb.localBase, watch: false }),
    ).rejects.toBeInstanceOf(LockHeldError);
    const running = await findRunningCore(dir);
    expect(running?.pid).toBe(lock?.pid);
    expect(running?.actors).toBe(true);

    // What the app and a second agent write goes through the holder, with their own names.
    const fromApp = (await forwardCall(
      running as NonNullable<typeof running>,
      "notes.create",
      "human",
      {
        title: "Written by the app",
        type: "permanent",
      },
    )) as { frontmatter: { created: { by: string } } };
    expect(fromApp.frontmatter.created.by).toBe("human");

    const second = await connect(sb, "second-bot");
    const viaSecond = await second.callTool({
      name: "create_note",
      arguments: { title: "Written by the second agent", type: "permanent" },
    });
    expect(viaSecond.isError, JSON.stringify(viaSecond.content)).toBeFalsy();
    const found = await owner.callTool({ name: "search", arguments: { q: "second agent" } });
    expect(
      (found.structuredContent as { hits: Array<{ title: string }> }).hits.map((h) => h.title),
    ).toContain("Written by the second agent");
    expect(readCoreLock(join(dir, "core.lock"))?.pid).toBe(lock?.pid);
  });
});
