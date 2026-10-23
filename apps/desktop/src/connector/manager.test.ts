// biome-ignore-all lint/suspicious/noExplicitAny: parsed results of many operations
import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStubWorker } from "@citegeist/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CoreServer, startCoreServer } from "../core/server.js";
import { seedLibrary } from "../testing/seed.js";

let tmp: string;
let core: CoreServer | undefined;
let library: string;
let localBase: string;
const blockers: Array<ReturnType<typeof createHttpServer>> = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "citegeist-connector-manager-"));
  library = join(tmp, "library");
  localBase = join(tmp, "local");
  seedLibrary(library);
});

afterEach(async () => {
  await core?.close();
  core = undefined;
  for (const b of blockers.splice(0)) {
    b.closeAllConnections();
    await new Promise((r) => b.close(r));
  }
  rmSync(tmp, { recursive: true, force: true });
});

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  const port = (probe.address() as { port: number }).port;
  await new Promise((r) => probe.close(r));
  return port;
}

async function start() {
  core = await startCoreServer({
    library,
    localBase,
    watch: false,
    runtime: { worker: createStubWorker() },
  });
  return core;
}

const call = (c: CoreServer, name: string, input: unknown) =>
  c.registry.call(name, { actor: "human" }, input) as Promise<any>;

async function ping(port: number): Promise<number | "refused"> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/connector/ping`);
    return res.status;
  } catch {
    return "refused";
  }
}

describe("connector switch in the settings", () => {
  it("is off by default and listens nowhere", async () => {
    const c = await start();
    const info = await call(c, "settings.get", {});
    expect(info.settings.connector).toEqual({ enabled: false, port: 23119 });
    expect(info.connector).toEqual({ state: "off" });
  });

  it("starts on the stored port, moves with the port and stops when switched off", async () => {
    const c = await start();
    const first = await freePort();
    await call(c, "settings.update", { patch: { connector: { enabled: true, port: first } } });
    expect((await call(c, "settings.get", {})).connector).toEqual({
      state: "listening",
      port: first,
    });
    expect(await ping(first)).toBe(200);

    const second = await freePort();
    await call(c, "settings.update", { patch: { connector: { port: second } } });
    expect(await ping(first)).toBe("refused");
    expect(await ping(second)).toBe(200);

    await call(c, "settings.update", { patch: { connector: { enabled: false } } });
    expect(await ping(second)).toBe("refused");
    expect((await call(c, "settings.get", {})).connector).toEqual({ state: "off" });
  });

  it("starts at launch when the stored settings say so, and stops with the core", async () => {
    const port = await freePort();
    const first = await start();
    await call(first, "settings.update", { patch: { connector: { enabled: true, port } } });
    await first.close();
    core = undefined;
    expect(await ping(port)).toBe("refused");

    const again = await start();
    expect((await call(again, "settings.get", {})).connector).toEqual({
      state: "listening",
      port,
    });
    expect(await ping(port)).toBe(200);
  });

  it("reports a taken port and keeps the app working", async () => {
    const c = await start();
    const taken = createHttpServer((_req, res) => res.end("hello"));
    await new Promise<void>((r) => taken.listen(0, "127.0.0.1", r));
    blockers.push(taken);
    const port = (taken.address() as { port: number }).port;

    await call(c, "settings.update", { patch: { connector: { enabled: true, port } } });
    const info = await call(c, "settings.get", {});
    expect(info.connector.state).toBe("error");
    expect(info.connector.detail).toContain(String(port));
    expect((await call(c, "items.list", { limit: 5 })).items.length).toBeGreaterThan(0);
  });

  it("saves into the library as the connector once it is on", async () => {
    const c = await start();
    const port = await freePort();
    await call(c, "settings.update", { patch: { connector: { enabled: true, port } } });
    const res = await fetch(`http://127.0.0.1:${port}/connector/saveSnapshot`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-zotero-connector-api-version": "3" },
      body: JSON.stringify({ url: "not a url" }),
    });
    expect(res.status).toBe(400);
  });
});
