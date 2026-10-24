// Integration 6: the planning operations, items.resolve and the matrix, seen through the server.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createStubWorker } from "@citegeist/core";
import { createReplayFetch, createResolver } from "@citegeist/metadata";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED, seedLibrary } from "../testing/seed.js";
import { type CoreServer, startCoreServer } from "./server.js";

const METADATA_HTTP_DIR = fileURLToPath(
  new URL("../../../../fixtures/metadata/http", import.meta.url),
);
const DOI = "10.1038/s41586-020-2649-2";

type Client = Record<string, Record<string, (input: unknown) => Promise<any>>>;

let tmp: string;
let server: CoreServer | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "citegeist-planning-ops-"));
  seedLibrary(join(tmp, "library"));
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  rmSync(tmp, { recursive: true, force: true });
});

async function start(): Promise<Client> {
  server = await startCoreServer({
    library: join(tmp, "library"),
    localBase: join(tmp, "local"),
    watch: false,
    connector: false,
    chat: false,
    runtime: {
      worker: createStubWorker(),
      resolver: createResolver({
        fetch: createReplayFetch(METADATA_HTTP_DIR),
        now: () => Date.parse("2026-10-23T12:00:00Z"),
        sleep: async () => {},
      }),
      ai: { backends: [] },
      sync: { quietMs: 60_000 },
    },
  });
  return createORPCClient<Client>(
    new RPCLink({
      url: `http://127.0.0.1:${server.port}/rpc`,
      headers: { authorization: `Bearer ${server.token}` },
    }),
  );
}

const call = (client: Client, op: string, input: unknown = {}): Promise<any> => {
  const [ns = "", ...rest] = op.split(".");
  const name = rest.join(".");
  // oRPC nests by segment: plan.docs.get is plan -> docs -> get
  let node: any = client[ns];
  for (const part of rest) node = node?.[part];
  if (typeof node !== "function") throw new Error(`no operation ${ns}.${name}`);
  return node(input);
};

describe("operations of the planning screens", () => {
  it("serves plan.docs.get, insights.list, items.resolve and the matrix operations", async () => {
    await start();
    const names = server?.registry.list().map((c) => c.name) ?? [];
    for (const name of [
      "plan.docs.get",
      "insights.list",
      "items.resolve",
      "matrix.create",
      "matrix.fill",
      "matrix.export",
    ]) {
      expect(names, name).toContain(name);
    }
  });

  it("reads a planning document and lists the insights written into it", async () => {
    const client = await start();
    await call(client, "plans.create", {
      project: "phd-proposal",
      slug: "expose",
      title: "Exposé",
      template: "expose",
    });
    const plan = await call(client, "plan.docs.get", { project: "phd-proposal", doc: "plan" });
    expect(plan).toMatchObject({
      path: "projects/phd-proposal/plans/expose/plan.md",
      exists: true,
    });

    await call(client, "insights.note", {
      project: "phd-proposal",
      target: "plan",
      text: `Die Ordnung folgt aus [[${SEED.items.luhmann}]].`,
    });
    const written = await call(client, "plan.docs.get", { project: "phd-proposal", doc: "plan" });
    expect(written.hash).not.toBe(plan.hash);
    expect(written.body).toContain(SEED.items.luhmann);

    const list = await call(client, "insights.list", { project: "phd-proposal" });
    expect(list.hits).toHaveLength(1);
    expect(list.hits[0].text).toContain(`[[${SEED.items.luhmann}]]`);
    expect(list.hits[0].block).toMatch(/^i-/);
  });

  it("re-resolves an item through the core and keeps the title the user chose", async () => {
    const client = await start();
    const added = await call(client, "items.add", { identifier: DOI });
    await until(async () => call(client, "jobs.get", { job: added.job }));
    await call(client, "items.update", {
      citekey: added.citekey,
      patch: { title: "Mein Titel" },
    });

    const out = await call(client, "items.resolve", { citekey: added.citekey });
    expect(out.citekey).toBe(added.citekey);
    expect(out.changed).not.toContain("title");
    const got = await call(client, "items.get", { citekey: added.citekey });
    expect(got.frontmatter.title).toBe("Mein Titel");
  });
});

async function until(read: () => Promise<{ status: string }>): Promise<void> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const job = await read();
    if (job.status === "succeeded" || job.status === "failed" || Date.now() > deadline) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}
