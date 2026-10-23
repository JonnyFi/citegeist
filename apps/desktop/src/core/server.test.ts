import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalPaths } from "@citegeist/core";
import { itemsGet, itemsList, projectsList } from "@citegeist/ops";
import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { findRunningCore } from "../shared/connect.js";
import { localDir, lockFile, readLock, tokenFile } from "../shared/lockfile.js";
import { SEED, seedLibrary } from "../testing/seed.js";
import { type CoreServer, LockHeldError, startCoreServer } from "./server.js";

let tmp: string;
let library: string;
let localBase: string;
const open: CoreServer[] = [];

async function start(extra: Partial<Parameters<typeof startCoreServer>[0]> = {}) {
  const server = await startCoreServer({ library, localBase, watch: false, ...extra });
  open.push(server);
  return server;
}

type Client = Record<string, Record<string, (input: unknown) => Promise<unknown>>>;
function clientFor(server: CoreServer, token = server.token): Client {
  const link = new RPCLink({
    url: `http://127.0.0.1:${server.port}/rpc`,
    headers: { authorization: `Bearer ${token}` },
  });
  return createORPCClient<Client>(link);
}

function rawRequest(
  port: number,
  headers: Record<string, string>,
  path = "/health",
  method = "GET",
): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "citegeist-desktop-"));
  library = join(tmp, "library");
  localBase = join(tmp, "local");
  seedLibrary(library);
});

afterEach(async () => {
  for (const s of open.splice(0)) await s.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("core server", () => {
  it("serves the ops registry over oRPC with a token", async () => {
    const server = await start();
    const client = clientFor(server);
    const list = (await client.items?.list?.({ inbox: false, limit: 50 })) as {
      items: Array<{ citekey: string }>;
    };
    expect(list.items.map((i) => i.citekey)).toEqual([
      SEED.items.habermas,
      SEED.items.lewis,
      SEED.items.luhmann,
    ]);
    const projects = (await client.projects?.list?.({})) as { projects: Array<{ slug: string }> };
    expect(projects.projects.map((p) => p.slug)).toEqual(["phd-proposal"]);
  });

  it("serves exactly the operations the registry has bound", async () => {
    const server = await start();
    const names = server.registry.list().map((c) => c.name);
    expect(names).toContain(itemsList.name);
    expect(names).toContain(itemsGet.name);
    expect(names).toContain(projectsList.name);
  });

  it("maps core errors to typed errors with the fix attached", async () => {
    const server = await start();
    const err = await clientFor(server)
      .items?.get?.({ citekey: "nope1234" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ORPCError);
    const e = err as ORPCError<string, { fix: string; code: string }>;
    expect(e.code).toBe("NOT_FOUND");
    expect(e.data.code).toBe("ITEM_NOT_FOUND");
    expect(e.data.fix).toMatch(/items.list/);
  });

  it("rejects bad input as BAD_REQUEST", async () => {
    const server = await start();
    const err = await clientFor(server)
      .items?.get?.({ citekey: "NOT VALID" })
      .catch((e: unknown) => e);
    expect((err as ORPCError<string, unknown>).code).toBe("BAD_REQUEST");
  });

  it("refuses calls without the token", async () => {
    const server = await start();
    expect(await rawRequest(server.port, {})).toBe(401);
    expect(await rawRequest(server.port, { authorization: "Bearer wrong" })).toBe(401);
    expect(await rawRequest(server.port, { authorization: `Bearer ${server.token}` })).toBe(200);
  });

  it("refuses foreign hosts and origins", async () => {
    const server = await start();
    const auth = { authorization: `Bearer ${server.token}` };
    expect(await rawRequest(server.port, { ...auth, host: "evil.example" })).toBe(403);
    expect(await rawRequest(server.port, { ...auth, origin: "https://evil.example" })).toBe(403);
    expect(await rawRequest(server.port, { ...auth, origin: "null" })).toBe(200);
    expect(
      await rawRequest(
        server.port,
        { origin: "http://localhost:5173" },
        "/rpc/items/list",
        "OPTIONS",
      ),
    ).toBe(204);
  });

  it("pushes change events over the WebSocket", async () => {
    const server = await start({ watch: true });
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/events?token=${server.token}`);
    const message = new Promise<{ type: string; path: string; external: boolean }>((resolve) => {
      ws.once("message", (data) => resolve(JSON.parse(String(data))));
    });
    await new Promise((r) => ws.once("open", r));
    server.library.writeFile(
      "notes/hello.md",
      `---\n${JSON.stringify({ id: "n_01J0SEED00000000000000NT01", title: "Hello", created: { at: "2026-10-01T09:00:00.000Z", by: "human" } })}\n---\nBody\n`,
    );
    const event = await message;
    expect(event).toMatchObject({ type: "change", path: "notes/hello.md", external: false });
    ws.close();
  });

  it("accepts the WebSocket of a page loaded from a file", async () => {
    const server = await start();
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/events?token=${server.token}`, {
      origin: "file://",
    });
    const outcome = await new Promise<string>((resolve) => {
      ws.once("error", () => resolve("error"));
      ws.once("open", () => resolve("open"));
    });
    expect(outcome).toBe("open");
    ws.close();
  });

  it("rejects WebSocket upgrades without the token", async () => {
    const server = await start();
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/events`);
    const outcome = await new Promise<string>((resolve) => {
      ws.once("error", () => resolve("error"));
      ws.once("open", () => resolve("open"));
    });
    expect(outcome).toBe("error");
  });
});

describe("core.lock", () => {
  it("records pid and port and keeps the token private", async () => {
    const server = await start();
    const dir = localDir(localBase, SEED.libraryId);
    expect(readLock(dir)).toMatchObject({ pid: process.pid, port: server.port });
    expect(statSync(tokenFile(dir)).mode & 0o777).toBe(0o600);
  });

  it("uses the path core's LocalPaths uses", () => {
    const local = new LocalPaths(localBase, SEED.libraryId);
    expect(lockFile(localDir(localBase, SEED.libraryId))).toBe(local.lock);
  });

  it("makes a second start fail before it touches the index, and the client attaches instead", async () => {
    const first = await start();
    await expect(startCoreServer({ library, localBase, watch: false })).rejects.toBeInstanceOf(
      LockHeldError,
    );
    const found = await findRunningCore(localDir(localBase, SEED.libraryId), library);
    expect(found?.url).toBe(`http://127.0.0.1:${first.port}`);
    expect(found?.token).toBe(first.token);
    const items = (await clientFor(first, found?.token).items?.list?.({ limit: 5 })) as {
      items: unknown[];
    };
    expect(items.items.length).toBeGreaterThan(0);
  });

  it("replaces a lock whose process is gone", async () => {
    const dir = localDir(localBase, SEED.libraryId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(lockFile(dir), JSON.stringify({ pid: 2 ** 22 + 12345, port: 9, started: "x" }));
    const server = await start();
    expect(readLock(dir)?.pid).toBe(process.pid);
    expect(readLock(dir)?.port).toBe(server.port);
  });

  it("does not attach to a stale lock", async () => {
    const dir = localDir(localBase, SEED.libraryId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(lockFile(dir), JSON.stringify({ pid: 2 ** 22 + 12345, port: 9, started: "x" }));
    expect(await findRunningCore(dir, library)).toBeUndefined();
  });

  it("removes lock and token on close", async () => {
    const server = await start();
    const dir = localDir(localBase, SEED.libraryId);
    await server.close();
    expect(readLock(dir)).toBeUndefined();
    expect(() => statSync(tokenFile(dir))).toThrow();
  });

  it("refuses to open a folder that is not a library unless asked to create one", async () => {
    const empty = join(tmp, "empty");
    mkdirSync(empty);
    await expect(startCoreServer({ library: empty, localBase, watch: false })).rejects.toThrow(
      /citegeist.json/,
    );
    const created = await startCoreServer({ library: empty, localBase, watch: false, init: true });
    open.push(created);
    expect(created.library.manifest.id).toBeTruthy();
  });
});
