// Integration 5: the runtime wiring of sync, graph and import, seen through the core server.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStubWorker } from "@citegeist/core";
import type { ImportResult } from "@citegeist/ops";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED, seedLibrary } from "../testing/seed.js";
import { ACTOR_HEADER, type CoreServer, startCoreServer } from "./server.js";

type Client = Record<string, Record<string, (input: unknown) => Promise<unknown>>>;

let tmp: string;
let library: string;
let localBase: string;
const open: CoreServer[] = [];

const unavailable = async () => {
  throw new Error("no network in tests");
};

async function start(): Promise<CoreServer> {
  const server = await startCoreServer({
    library,
    localBase,
    watch: false,
    chat: false,
    connector: false,
    runtime: {
      worker: createStubWorker(),
      resolver: { resolve: unavailable, resolveByTitle: unavailable },
      ai: { backends: [] },
      // long quiet period: the commit in the test comes from sync.now
      sync: { quietMs: 60_000 },
    },
  });
  open.push(server);
  return server;
}

function clientFor(server: CoreServer, actor?: string): Client {
  return createORPCClient<Client>(
    new RPCLink({
      url: `http://127.0.0.1:${server.port}/rpc`,
      headers: {
        authorization: `Bearer ${server.token}`,
        ...(actor ? { [ACTOR_HEADER]: actor } : {}),
      },
    }),
  );
}

const call = async <T>(client: Client, ns: string, op: string, input: unknown): Promise<T> => {
  const fn = client[ns]?.[op];
  if (!fn) throw new Error(`no operation ${ns}.${op}`);
  return (await fn(input)) as T;
};

async function waitForJob(
  client: Client,
  job: string,
): Promise<{ status: string; result?: unknown }> {
  for (let i = 0; i < 200; i++) {
    const j = await call<{ status: string; result?: unknown }>(client, "jobs", "get", { job });
    if (j.status === "succeeded" || j.status === "failed") return j;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`job ${job} did not finish`);
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "citegeist-wiring-"));
  library = join(tmp, "library");
  localBase = join(tmp, "local");
  seedLibrary(library);
});

afterEach(async () => {
  for (const s of open.splice(0)) await s.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("sync in the runtime", () => {
  it("commits an agent write under the name of the agent", async () => {
    const server = await start();
    expect(server.runtime.sync).toBeDefined();
    const agent = clientFor(server, "agent:claude-code");
    const human = clientFor(server);

    // versioning is off until the user turns it on; configure creates the repository
    await call(human, "sync", "configure", { versioning: true });

    const note = await call<{ path: string }>(agent, "notes", "create", {
      title: "Anschlusskommunikation",
      body: "Ein Agent hat diese Notiz geschrieben.",
      type: "permanent",
    });
    expect(readFileSync(note.path, "utf8")).toContain("Ein Agent hat");

    const now = await call<{ commits: { message: string; actor: string; files: number }[] }>(
      human,
      "sync",
      "now",
      {},
    );
    const commit = now.commits.find((c) => c.actor === "agent:claude-code");
    expect(commit, JSON.stringify(now.commits)).toBeDefined();
    expect(commit?.message).toMatch(/^agent:claude-code: notes\.create/);
    expect(commit?.files).toBeGreaterThanOrEqual(1);

    const author = await server.runtime.sync.versioner.git()?.out(["log", "-1", "--format=%an"]);
    expect(author?.trim()).toBe("agent:claude-code");

    const status = await call<{
      git: { initialised: boolean; uncommitted: number; lastCommit?: { message: string } };
    }>(human, "sync", "status", {});
    expect(status.git.initialised).toBe(true);
    expect(status.git.uncommitted).toBe(0);
  });
});

describe("graph in the runtime", () => {
  it("serves related_works through graph.related and reports the missing DOI of an item", async () => {
    const server = await start();
    const names = server.registry.list().map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "graph.related",
        "graph.references",
        "graph.citing",
        "graph.addCandidates",
        "items.checkRetractions",
        "projects.context",
      ]),
    );
    const client = clientFor(server, "agent:claude-code");
    // the seed item has no refs.jsonl, DOI or OpenAlex id, so the citing lookup says what to do
    const err = await call(client, "graph", "related", {
      citekey: SEED.items.luhmann,
      direction: "citing",
    }).catch((e: unknown) => e);
    expect(String((err as Error).message)).toMatch(/DOI/);
  });
});

describe("import through the server", () => {
  it("previews and imports a BibTeX file as the system", async () => {
    const server = await start();
    const human = clientFor(server);
    const dir = join(tmp, "bib");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "refs.bib");
    writeFileSync(
      path,
      `@article{smith2020deep,
  author = {Smith, Jane},
  title = {Deep Learning for Everything},
  journal = {Journal of Machine Things},
  year = {2020},
  doi = {10.5555/deep.2020.7},
}

@book{mueller2015grundlagen,
  author = {M{\\"u}ller, Anna},
  title = {Grundlagen der Wissenschaft},
  publisher = {Beispielverlag},
  year = {2015},
}
`,
    );
    const source = { kind: "bibtex", path };

    const preview = await call<{ counts: { items: number; create: number } }>(
      human,
      "import",
      "preview",
      { source },
    );
    expect(preview.counts).toMatchObject({ items: 2, create: 2 });
    const before = await call<{ items: unknown[] }>(human, "items", "list", { limit: 50 });

    const started = await call<{ job: string }>(human, "import", "run", {
      source,
      tags: ["from-bib"],
    });
    const done = await waitForJob(human, started.job);
    expect(done.status).toBe("succeeded");
    const result = done.result as ImportResult;
    expect(result.provenance).toMatch(/^bibtex@/);

    const after = await call<{ items: { citekey: string }[] }>(human, "items", "list", {
      limit: 50,
    });
    expect(after.items.length).toBe(before.items.length + 2);
    const smith = await call<{ frontmatter: { tags: string[]; created: { by: string } } }>(
      human,
      "items",
      "get",
      { citekey: "smith2020deep" },
    );
    expect(smith.frontmatter.tags).toContain("from-bib");
    expect(smith.frontmatter.created.by).toBe("system");

    // a second run finds both entries and adds nothing
    const again = await call<{ job: string }>(human, "import", "run", { source });
    expect((await waitForJob(human, again.job)).status).toBe("succeeded");
    const last = await call<{ items: unknown[] }>(human, "items", "list", { limit: 50 });
    expect(last.items.length).toBe(after.items.length);
  });
});
