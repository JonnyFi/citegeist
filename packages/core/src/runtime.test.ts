import { type InferenceBackend, MockBackend } from "@citegeist/ai";
import type { Actor } from "@citegeist/schema";
import { afterEach, describe, expect, it } from "vitest";
import { createStubWorker } from "./ingest/worker.js";
import { Library } from "./library.js";
import { createRuntime, type Runtime } from "./runtime.js";
import { type BackendProvider, InMemoryKeychain } from "./settings/index.js";
import { cleanTmpDirs, itemData, itemFile, tmpDir, writeRaw } from "./test-helpers.js";

const human = { actor: "human" as Actor };
const CITEKEY = "luhmann1984soziale";
const QUOTE = "Soziale Systeme bestehen aus Kommunikationen.";

const open: Array<{ lib: Library; rt: Runtime }> = [];
afterEach(async () => {
  for (const { lib, rt } of open.splice(0)) {
    await rt.close();
    await lib.close();
  }
  cleanTmpDirs();
});

const answer = (paraphrase: string) => ({
  "card.paraphrase": { paraphrase, kind: "finding" },
});

async function setup() {
  const lib = await Library.init(tmpDir("cg-rt-"), {
    watch: false,
    localBase: tmpDir("cg-local-"),
  });
  writeRaw(lib.root, `items/${CITEKEY}/${CITEKEY}.md`, itemFile(itemData(CITEKEY)));
  lib.sync();
  const keychain = new InMemoryKeychain();
  const cli = new MockBackend(answer("from the cli"), "claude-code-cli");
  const openai = new MockBackend(answer("from openai"), "openai");
  // like BackendRegistry: the API backend exists once its key is stored
  const backends: BackendProvider = {
    async get(id) {
      const found = (await this.build()).find((b) => b.id === id);
      if (!found) throw new Error(`no backend ${id}`);
      return found;
    },
    async status() {
      return [
        { id: "claude-code-cli", kind: "subscription-cli", label: "Claude", available: true },
        { id: "openai", kind: "api-key", label: "OpenAI", available: await keychain.has("openai") },
      ];
    },
    async build() {
      const list: InferenceBackend[] = [cli];
      if (await keychain.has("openai")) list.push(openai);
      return list;
    },
  };
  const rt = createRuntime(lib, {
    worker: createStubWorker(),
    // no process starts in tests: every command reports that it is missing
    settings: {
      backends,
      keychain,
      runner: async () => ({
        stdout: "",
        stderr: "",
        exitCode: null,
        timedOut: false,
        spawnError: "ENOENT",
      }),
    },
  });
  open.push({ lib, rt });
  const call = <T>(name: string, input: unknown) =>
    rt.registry.call(name, human, input) as Promise<T>;
  return { lib, rt, call, cli, openai };
}

async function paraphraseOf(
  s: Awaited<ReturnType<typeof setup>>,
  citekey = CITEKEY,
): Promise<string | undefined> {
  const created = await s.call<{ card: { frontmatter: { id: string } }; job: string }>(
    "cards.create",
    { citekey, anchor: { text: { exact: QUOTE } }, quote: QUOTE },
  );
  const job = await s.rt.ingest.queue.waitFor(created.job);
  expect(job.status).toBe("succeeded");
  const listed = await s.call<{
    cards: Array<{ frontmatter: { id: string }; body: { paraphrase?: string } }>;
  }>("cards.list", { citekey, limit: 50 });
  return listed.cards.find((c) => c.frontmatter.id === created.card.frontmatter.id)?.body
    .paraphrase;
}

describe("createRuntime operations", () => {
  it("binds every contract the app screens call", async () => {
    const s = await setup();
    for (const name of [
      "links.create",
      "links.propose",
      "links.decide",
      "graph.neighbors",
      "cite.format",
      "items.attach",
      "notes.list",
      "notes.backlinks",
      "search.query",
    ]) {
      expect(s.rt.registry.get(name), name).toBeDefined();
    }
  });
});

describe("createRuntime notes", () => {
  it("binds notes.list and notes.backlinks next to the other operations", async () => {
    const s = await setup();
    const note = await s.call<{ frontmatter: { id: string } }>("notes.create", {
      title: "Autopoiesis",
      type: "permanent",
    });
    const listed = await s.call<{ notes: Array<{ title: string; slug: string }> }>(
      "notes.list",
      {},
    );
    expect(listed.notes).toMatchObject([{ title: "Autopoiesis", slug: "autopoiesis" }]);
    const back = await s.call<{ backlinks: unknown[] }>("notes.backlinks", {
      id: note.frontmatter.id,
    });
    expect(back.backlinks).toEqual([]);

    const renamed = await s.call<{ path: string }>("notes.update", {
      id: note.frontmatter.id,
      title: "Selbstherstellung",
      type: "claim",
    });
    expect(renamed.path).toMatch(/selbstherstellung\.md$/);
  });
});

describe("createRuntime settings", () => {
  it("routes AI tasks by the stored settings and follows settings.update", async () => {
    const s = await setup();
    expect(await paraphraseOf(s)).toBe("from the cli");

    await s.call("settings.update", {
      patch: {},
      apiKey: { provider: "openai", key: "sk-test-key-0123456789" },
    });
    await s.call("settings.update", {
      patch: { ai: { routing: { "*": "openai" } } },
    });
    expect(await paraphraseOf(s)).toBe("from openai");
    expect(s.openai.calls).toHaveLength(1);
  });

  it("reports the backends and the worker through settings.get", async () => {
    const s = await setup();
    const got = await s.call<{
      settings: { ai: { routing: Record<string, string> }; uiLanguage: string };
      backends: Array<{ id: string; available: boolean }>;
      worker: { ready: boolean };
    }>("settings.get", {});
    expect(got.settings.ai.routing).toEqual({ "*": "claude-code-cli" });
    expect(got.backends.map((b) => [b.id, b.available])).toEqual([
      ["claude-code-cli", true],
      ["openai", false],
    ]);
    expect(got.worker.ready).toBe(false);
  });

  it("keeps the AI job of a card visible to jobs.get", async () => {
    const s = await setup();
    const created = await s.call<{ job: string }>("cards.create", {
      citekey: CITEKEY,
      anchor: { text: { exact: QUOTE } },
      quote: QUOTE,
    });
    const got = await s.call<{ id: string; kind: string }>("jobs.get", { job: created.job });
    expect(got).toMatchObject({ id: created.job, kind: "ai-task" });
    await s.rt.ingest.queue.waitFor(created.job);
  });

  it("binds the matrix operations and runs a fill as an ai-task job with progress", async () => {
    const s = await setup();
    await s.call("projects.create", { slug: "phd", title: "PhD" });
    for (const name of [
      "matrix.create",
      "matrix.list",
      "matrix.get",
      "matrix.update",
      "matrix.fillCell",
      "matrix.fill",
      "matrix.export",
    ]) {
      expect(s.rt.registry.get(name), name).toBeDefined();
    }
    const created = await s.call<{ matrix: { id: string } }>("matrix.create", {
      project: "phd",
      title: "Methods",
      columns: [{ name: "Method", instruction: "Which method does the source use?" }],
      items: [CITEKEY],
    });
    const started = await s.call<{ job: string }>("matrix.fill", {
      project: "phd",
      matrix: created.matrix.id,
    });
    const queued = await s.call<{ id: string; kind: string }>("jobs.get", { job: started.job });
    expect(queued).toMatchObject({ id: started.job, kind: "ai-task" });
    const done = await s.rt.ingest.queue.waitFor(started.job);
    expect(done.status).toBe("succeeded");
    expect(done.progress).toBe(1);
    expect(done.result).toMatchObject({ filled: expect.any(Number), failed: expect.any(Number) });
  });

  it("starts the worker setup as a worker-setup job", async () => {
    const s = await setup();
    const started = await s.call<{ job: string }>("worker.setup", { force: false });
    const job = s.rt.ingest.queue.get(started.job);
    expect(job?.kind).toBe("worker-setup");
    const done = await s.rt.ingest.queue.waitFor(started.job);
    expect(done.status).toBe("failed");
    expect(done.error?.code).toBe("WORKER_UV_MISSING");
  });
});
