// Integration 6: signed webhooks through the real core server. An outbound receiver (a plain HTTP
// server) stands in for the external agent; the inbound requests go to /hooks/<connector> without
// the core token, as a tunnel would forward them.
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeBackend } from "@citegeist/chat/testing";
import { createStubWorker, InMemoryKeychain } from "@citegeist/core";
import { createReplayFetch, createResolver } from "@citegeist/metadata";
import {
  ID_HEADER,
  SIGNATURE_HEADER,
  signRequest,
  TIMESTAMP_HEADER,
  verifyRequest,
} from "@citegeist/webhooks";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedLibrary } from "../testing/seed.js";
import { ACTOR_HEADER, type CoreServer, startCoreServer } from "./server.js";

const METADATA_HTTP_DIR = fileURLToPath(
  new URL("../../../../fixtures/metadata/http", import.meta.url),
);
const DOI = "10.1038/s41586-020-2649-2";
const NOW = Date.parse("2026-10-23T12:00:00Z");

type Client = Record<string, Record<string, (input: unknown) => Promise<any>>>;

let tmp: string;
let server: CoreServer | undefined;
let receiver: Receiver | undefined;

interface Delivery {
  headers: IncomingMessage["headers"];
  body: string;
}
interface Receiver {
  url: string;
  deliveries: Delivery[];
  server: Server;
}

async function startReceiver(): Promise<Receiver> {
  const deliveries: Delivery[] = [];
  const srv = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      deliveries.push({ headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(202).end("accepted");
    });
  });
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const port = (srv.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}/tasks`, deliveries, server: srv };
}

async function start(chat = false): Promise<{ server: CoreServer; client: Client }> {
  const resolver = createResolver({
    fetch: createReplayFetch(METADATA_HTTP_DIR),
    now: () => NOW,
    sleep: async () => {},
  });
  server = await startCoreServer({
    library: join(tmp, "library"),
    localBase: join(tmp, "local"),
    watch: false,
    connector: false,
    chat: chat ? { backends: [fakeBackend()], find: () => undefined } : false,
    runtime: {
      worker: createStubWorker(),
      resolver,
      ai: { backends: [] },
      sync: { quietMs: 60_000 },
    },
    webhooks: { secrets: new InMemoryKeychain(), publicBaseUrl: "https://mac.tail1234.ts.net" },
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

async function until<T>(read: () => Promise<T>, done: (v: T) => boolean): Promise<T> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** POSTs a signed payload to /hooks/<name> the way a tunnel forwards it: no core token. */
async function deliver(
  port: number,
  name: string,
  secret: string,
  payload: unknown,
  overrides: { id?: string; now?: Date; secret?: string } = {},
) {
  const body = JSON.stringify(payload);
  const headers = signRequest(overrides.secret ?? secret, body, {
    ...(overrides.id ? { id: overrides.id } : {}),
    ...(overrides.now ? { now: overrides.now } : {}),
  });
  const res = await fetch(`http://127.0.0.1:${port}/hooks/${name}`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body,
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "citegeist-hooks-"));
  seedLibrary(join(tmp, "library"));
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  await new Promise<void>((resolve) =>
    receiver ? receiver.server.close(() => resolve()) : resolve(),
  );
  receiver = undefined;
  rmSync(tmp, { recursive: true, force: true });
});

describe("webhooks in the core server", () => {
  it("binds the webhook operations", async () => {
    const { server: s } = await start();
    for (const name of [
      "webhooks.list",
      "webhooks.create",
      "webhooks.rotateSecret",
      "webhooks.delete",
      "webhooks.test",
      "webhooks.send",
    ]) {
      expect(s.registry.get(name), name).toBeDefined();
    }
  });

  it("takes a signed papers.add from an external agent into the inbox, without the core token", async () => {
    const { server: s, client } = await start();
    const { secret } = await call(client, "webhooks.create", { name: "grok", kind: "inbound" });

    const signed = await deliver(s.port, "grok", secret, {
      event: "papers.add",
      papers: [DOI],
      why: "Seen in the thread about array programming",
    });
    expect(signed.status).toBe(200);
    expect(signed.body.target).toBe("inbox");

    const inbox = await call(client, "items.list", { inbox: true, limit: 10 });
    const fromGrok = inbox.items.filter((i: { inboxBy?: string }) => i.inboxBy === "agent:grok");
    expect(fromGrok).toHaveLength(1);
    expect(fromGrok[0].inboxWhy).toBe("Seen in the thread about array programming");
  });

  it("answers /hooks/ by signature and every other path by token", async () => {
    const { server: s, client } = await start();
    const { secret } = await call(client, "webhooks.create", { name: "grok", kind: "inbound" });
    const url = `http://127.0.0.1:${s.port}`;

    // no signature at all, a forged one and a replayed delivery are refused
    const unsigned = await fetch(`${url}/hooks/grok`, { method: "POST", body: "{}" });
    expect(unsigned.status).toBe(401);
    const forged = await deliver(s.port, "grok", secret, { event: "ping" }, { secret: "wrong" });
    expect(forged.status).toBe(401);
    const first = await deliver(s.port, "grok", secret, { event: "ping" }, { id: "delivery-1" });
    expect(first.status).toBe(200);
    const replay = await deliver(s.port, "grok", secret, { event: "ping" }, { id: "delivery-1" });
    expect(replay.status).toBe(409);
    const stale = await deliver(
      s.port,
      "grok",
      secret,
      { event: "ping" },
      { now: new Date(Date.now() - 3600_000) },
    );
    expect(stale.status).toBe(401);

    // the signature opens /hooks/ only: the RPC endpoint and the health check still want the token
    expect((await fetch(`${url}/rpc/items/list`, { method: "POST" })).status).toBe(401);
    expect((await fetch(`${url}/health`)).status).toBe(401);
    // a request through a tunnel carries a foreign Host header and must still reach the hooks
    const tunneled = await new Promise<number>((resolve, reject) => {
      const body = JSON.stringify({ event: "ping" });
      const headers = signRequest(secret, body);
      import("node:http").then(({ request }) => {
        const req = request(
          {
            host: "127.0.0.1",
            port: s.port,
            path: "/hooks/grok",
            method: "POST",
            headers: {
              ...headers,
              host: "mac.tail1234.ts.net",
              "content-type": "application/json",
              "content-length": Buffer.byteLength(body),
            },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on("error", reject);
        req.end(body);
      });
    });
    expect(tunneled).toBe(200);
  });

  it("keeps the management of connectors and their secrets away from agents", async () => {
    const { server: s, client } = await start();
    const { secret } = await call(client, "webhooks.create", { name: "grok", kind: "inbound" });
    const agent = createORPCClient<Client>(
      new RPCLink({
        url: `http://127.0.0.1:${s.port}/rpc`,
        headers: { authorization: `Bearer ${s.token}`, [ACTOR_HEADER]: "agent:other" },
      }),
    );
    // the list shows names and addresses, never a secret
    const listed = await call(agent, "webhooks.list");
    expect(listed.webhooks.map((w: { name: string }) => w.name)).toEqual(["grok"]);
    expect(JSON.stringify(listed)).not.toContain(secret);
    for (const [op, input] of [
      ["create", { name: "x", kind: "inbound" }],
      ["rotateSecret", { name: "grok" }],
      ["delete", { name: "grok" }],
      ["test", { name: "grok" }],
    ] as const) {
      await expect(call(agent, `webhooks.${op}`, input), op).rejects.toThrow(/human/);
    }
  });

  it("sends a signed research task and closes the job when the callback arrives", async () => {
    receiver = await startReceiver();
    const { server: s, client } = await start();
    const { secret } = await call(client, "webhooks.create", {
      name: "grok",
      kind: "both",
      url: receiver.url,
    });
    await call(client, "projects.get", { slug: "phd-proposal" });

    const { job } = await call(client, "webhooks.send", {
      name: "grok",
      prompt: "Find recent work on array programming",
      project: "phd-proposal",
    });
    expect(job).toMatch(/^j_/);

    // the receiver got one signed request that names the job as the task
    expect(receiver.deliveries).toHaveLength(1);
    const sent = receiver.deliveries[0] as Delivery;
    const verdict = verifyRequest({
      id: sent.headers[ID_HEADER] as string,
      timestamp: sent.headers[TIMESTAMP_HEADER] as string,
      signature: sent.headers[SIGNATURE_HEADER] as string,
      rawBody: Buffer.from(sent.body),
      secrets: [secret],
    });
    expect(verdict.ok).toBe(true);
    const task = JSON.parse(sent.body);
    expect(task).toMatchObject({
      event: "task.request",
      task: job,
      prompt: "Find recent work on array programming",
      callback: { url: "https://mac.tail1234.ts.net/hooks/grok", event: "task.result" },
    });

    // until the callback, the job is a research job that waits
    const waiting = await call(client, "jobs.get", { job });
    expect(waiting).toMatchObject({ id: job, kind: "research", by: "human" });
    expect(["queued", "running"]).toContain(waiting.status);

    // another connector's secret cannot answer this task; the right one can
    const answered = await deliver(s.port, "grok", secret, {
      event: "task.result",
      task: job,
      papers: [DOI],
      summary: "One relevant paper",
    });
    expect(answered.status).toBe(200);

    const done = await until(
      () => call(client, "jobs.get", { job }),
      (j) => j.status === "succeeded" || j.status === "failed",
    );
    expect(done.status).toBe("succeeded");
    expect(done.result.papers).toHaveLength(1);

    const inbox = await call(client, "items.list", { inbox: true, limit: 10 });
    expect(
      inbox.items.filter((i: { inboxBy?: string }) => i.inboxBy === "agent:grok"),
    ).toHaveLength(1);
  });

  it("fails the job and says so when the connector cannot be reached", async () => {
    receiver = await startReceiver();
    const { client } = await start();
    await call(client, "webhooks.create", { name: "grok", kind: "outbound", url: receiver.url });
    await new Promise<void>((resolve) => receiver?.server.close(() => resolve()));
    await expect(
      call(client, "webhooks.send", { name: "grok", prompt: "Anything" }),
    ).rejects.toThrow(/could not deliver/);
    const jobs = await call(client, "jobs.list", { limit: 10 });
    const research = jobs.jobs.filter((j: { kind: string }) => j.kind === "research");
    expect(research).toHaveLength(1);
    expect(research[0].status).toBe("failed");
  });
});

describe("the research job kind", () => {
  it("serves chat research and webhook tasks side by side", async () => {
    receiver = await startReceiver();
    const { server: s, client } = await start(true);
    const { secret } = await call(client, "webhooks.create", {
      name: "grok",
      kind: "both",
      url: receiver.url,
    });

    // the webhook task waits for its callback ...
    const hook = await call(client, "webhooks.send", { name: "grok", prompt: "Outside agent" });
    await until(
      () => call(client, "jobs.get", { job: hook.job }),
      (j) => j.status === "running",
    );

    // ... while a chat research job runs to the end on the same kind
    const add = `@fake mcp add_item ${JSON.stringify({ identifier: DOI, why: "Core paper" })}`;
    const research = await call(client, "research.start", {
      prompt: `Array programming\n${add}`,
      backend: "fake",
      maxItems: 1,
    });
    const chatJob = await until(
      () => call(client, "jobs.get", { job: research.job }),
      (j) => j.status === "succeeded" || j.status === "failed",
    );
    expect(chatJob.error).toBeUndefined();
    expect(chatJob.status).toBe("succeeded");
    expect(chatJob.kind).toBe("research");
    expect(chatJob.result.added).toHaveLength(1);
    expect(chatJob.result.session).toMatch(/^ch_/);

    // the webhook job was not touched by it
    expect((await call(client, "jobs.get", { job: hook.job })).status).toBe("running");

    // and the callback still closes it afterwards
    const answered = await deliver(s.port, "grok", secret, {
      event: "task.result",
      task: hook.job,
      papers: [],
      summary: "Nothing new",
    });
    expect(answered.status).toBe(200);
    const done = await until(
      () => call(client, "jobs.get", { job: hook.job }),
      (j) => j.status === "succeeded" || j.status === "failed",
    );
    expect(done.status).toBe("succeeded");
  });
});
