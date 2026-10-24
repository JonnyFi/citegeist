import { createFakeEmbedder, type DownloadProgress, FakeReranker } from "@citegeist/embed";
import { afterEach, describe, expect, it } from "vitest";
import { cannedAiBackend } from "../canned-ai.js";
import { newNoteId } from "../ids.js";
import { createStubWorker } from "../ingest/worker.js";
import { Library } from "../library.js";
import { createRuntime, type Runtime } from "../runtime.js";
import { cleanTmpDirs, noteData, noteFile, tmpDir, until, writeRaw } from "../test-helpers.js";
import type { ModelEmbedder } from "./controller.js";

const SYNONYMS = { automobil: "wagen", fahrzeug: "wagen" };
const human = { actor: "human" as const };

const open: Array<{ lib: Library; rt: Runtime }> = [];
afterEach(async () => {
  for (const { lib, rt } of open.splice(0)) {
    await rt.close();
    await lib.close();
  }
  cleanTmpDirs();
});

type Options = Partial<Parameters<typeof createRuntime>[1]>;

async function setup(options: Options = {}) {
  const lib = await Library.init(tmpDir("cg-semrt-"), {
    watch: false,
    localBase: tmpDir("cg-local-"),
  });
  writeRaw(
    lib.root,
    "notes/garage.md",
    noteFile(
      noteData("Garage", { id: newNoteId() }),
      "Der Wagen steht in der Garage und wartet.\n",
    ),
  );
  writeRaw(
    lib.root,
    "notes/obst.md",
    noteFile(noteData("Obst", { id: newNoteId() }), "Äpfel und Birnen liegen im Korb der Küche.\n"),
  );
  lib.sync();
  const rt = createRuntime(lib, {
    worker: createStubWorker(),
    ai: { backends: [cannedAiBackend()] },
    settings: { localBase: tmpDir("cg-settings-") },
    semantic: { debounceMs: 5 },
    ...options,
  });
  open.push({ lib, rt });
  const call = <T>(name: string, input: unknown) =>
    rt.registry.call(name, human, input) as Promise<T>;
  const titles = async (q: string) =>
    (
      await call<{ hits: Array<{ title: string }> }>("search.query", { q, kinds: ["note"] })
    ).hits.map((h) => h.title);
  return { lib, rt, call, titles };
}

/** A model whose download the test controls. */
function gatedModel() {
  let release!: () => void;
  let fail!: (err: Error) => void;
  const gate = new Promise<void>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  let report: (p: DownloadProgress) => void = () => {};
  const created: ModelEmbedder[] = [];
  const models: string[] = [];
  const base = createFakeEmbedder({ synonyms: SYNONYMS });
  return {
    created,
    models,
    release: () => release(),
    fail: (message: string) => fail(new Error(message)),
    progress: (loaded: number, total: number) =>
      report({
        file: "model.onnx",
        progress: loaded / total,
        loadedBytes: loaded,
        totalBytes: total,
      }),
    createEmbedder: (
      onDownload: (p: DownloadProgress) => void,
      spec?: { key: string },
    ): ModelEmbedder => {
      report = onDownload;
      if (spec) models.push(spec.key);
      const embedder: ModelEmbedder = {
        id: base.id,
        dimensions: base.dimensions,
        embedDocuments: (t, o) => base.embedDocuments(t, o),
        embedQuery: (t, o) => base.embedQuery(t, o),
        warmup: () => gate,
        close: async () => {},
      };
      created.push(embedder);
      return embedder;
    },
  };
}

describe("semantic search in the runtime", () => {
  it("stays off by default: full-text results, no model, no embed job", async () => {
    const s = await setup();
    const info = await s.call<{ semantic?: { state: string; model: string } }>("settings.get", {});
    expect(info.semantic).toMatchObject({ state: "off", model: "embeddinggemma-300m" });
    expect(await s.titles("Automobil")).toEqual([]);
    expect(s.rt.ingest.queue.list({ limit: 50 }).jobs.filter((j) => j.kind === "embed")).toEqual(
      [],
    );
  });

  it("uses an embedder from the options as is: hybrid search through search.query", async () => {
    const embedder = createFakeEmbedder({ synonyms: SYNONYMS });
    const s = await setup({ embedder });
    await until(async () => (await s.titles("Automobil")).length > 0, 5000, 20);
    expect(await s.titles("Automobil")).toEqual(["Garage"]);
    const info = await s.call<{ semantic?: { state: string } }>("settings.get", {});
    expect(info.semantic?.state).toBe("ready");
  });

  it("downloads on the switch, shows progress, then searches by meaning", async () => {
    const model = gatedModel();
    const s = await setup({ semantic: { debounceMs: 5, createEmbedder: model.createEmbedder } });

    await s.call("settings.update", { patch: { semantic: { enabled: true } } });
    model.progress(30, 120);
    const during = await s.call<{
      semantic?: { state: string; progress?: number };
      settings: { semantic: { enabled: boolean } };
    }>("settings.get", {});
    expect(during.settings.semantic.enabled).toBe(true);
    expect(during.semantic).toMatchObject({ state: "downloading", progress: 0.25 });
    // Until the files are there, search is what it was.
    expect(await s.titles("Automobil")).toEqual([]);

    model.release();
    await until(
      async () =>
        (await s.call<{ semantic?: { state: string } }>("settings.get", {})).semantic?.state ===
        "ready",
    );
    await until(async () => (await s.titles("Automobil")).length > 0, 5000, 20);
    expect(await s.titles("Automobil")).toEqual(["Garage"]);
    expect(s.rt.ingest.queue.list({ limit: 50 }).jobs.some((j) => j.kind === "embed")).toBe(true);

    await s.call("settings.update", { patch: { semantic: { enabled: false } } });
    const after = await s.call<{ semantic?: { state: string } }>("settings.get", {});
    expect(after.semantic?.state).toBe("off");
    expect(await s.titles("Automobil")).toEqual([]);
  });

  it("reports a failed download and keeps full-text search", async () => {
    const model = gatedModel();
    const s = await setup({ semantic: { debounceMs: 5, createEmbedder: model.createEmbedder } });
    await s.call("settings.update", { patch: { semantic: { enabled: true } } });
    model.fail("no network");
    await until(
      async () =>
        (await s.call<{ semantic?: { state: string } }>("settings.get", {})).semantic?.state ===
        "error",
    );
    const info = await s.call<{ semantic?: { state: string; detail?: string } }>(
      "settings.get",
      {},
    );
    expect(info.semantic?.detail).toBe("no network");
    expect(await s.titles("Garage")).toEqual(["Garage"]);
  });

  it("starts on when the stored settings say so", async () => {
    const model = gatedModel();
    const localBase = tmpDir("cg-settings-on-");
    const first = await setup({
      settings: { localBase },
      semantic: { debounceMs: 5, createEmbedder: model.createEmbedder },
    });
    await first.call("settings.update", { patch: { semantic: { enabled: true } } });
    model.release();
    await until(async () => first.rt.semantic?.status().state === "ready");

    const again = await setup({
      settings: { localBase },
      semantic: { debounceMs: 5, createEmbedder: model.createEmbedder },
    });
    await until(async () => again.rt.semantic?.status().state === "ready");
  });

  it("lets the settings choose the embedding model and starts over when it changes", async () => {
    const model = gatedModel();
    const s = await setup({ semantic: { debounceMs: 5, createEmbedder: model.createEmbedder } });
    model.release();

    // EmbeddingGemma is the default.
    await s.call("settings.update", { patch: { semantic: { enabled: true } } });
    await until(async () => s.rt.semantic?.status().state === "ready");
    expect(model.models).toEqual(["embeddinggemma-300m"]);

    // Qwen3-Embedding replaces it; the switch stays on.
    const res = await s.call<{ settings: { semantic: { enabled: boolean; model?: string } } }>(
      "settings.update",
      { patch: { semantic: { model: "qwen3-embedding-0.6b" } } },
    );
    expect(res.settings.semantic).toEqual({
      enabled: true,
      model: "qwen3-embedding-0.6b",
      rerank: false,
    });
    await until(async () => model.models.length === 2 && s.rt.semantic?.status().state === "ready");
    expect(model.models).toEqual(["embeddinggemma-300m", "qwen3-embedding-0.6b"]);

    // An unknown model is refused by the contract.
    await expect(
      s.call("settings.update", { patch: { semantic: { model: "word2vec" } } }),
    ).rejects.toThrow();
  });

  it("re-sorts hits with the reranker only after it has loaded, and not at all when it is off", async () => {
    let release!: () => void;
    const loaded = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = new FakeReranker();
    const reranker = {
      id: fake.id,
      rerank: (q: string, p: string[]) => fake.rerank(q, p),
      warmup: () => loaded,
    };
    const embedder = createFakeEmbedder({ synonyms: SYNONYMS });
    const s = await setup({
      embedder,
      semantic: { debounceMs: 5, minSimilarity: -1, createReranker: () => reranker },
    });
    await until(async () => (await s.titles("Automobil")).length > 1, 5000, 20);
    expect(fake.calls).toBe(0);

    await s.call("settings.update", { patch: { semantic: { rerank: true } } });
    await until(async () => s.rt.semantic?.status().rerank === "loading");
    await s.titles("Automobil");
    expect(fake.calls).toBe(0);

    release();
    await until(async () => s.rt.semantic?.status().rerank === "ready");
    expect((await s.titles("Automobil"))[0]).toBe("Garage");
    expect(fake.calls).toBeGreaterThan(0);

    await s.call("settings.update", { patch: { semantic: { rerank: false } } });
    expect(s.rt.semantic?.status().rerank).toBeUndefined();
    const calls = fake.calls;
    await s.titles("Automobil");
    expect(fake.calls).toBe(calls);
  });

  it("reports a reranker that fails to load and keeps the fused order", async () => {
    const embedder = createFakeEmbedder({ synonyms: SYNONYMS });
    const s = await setup({
      embedder,
      semantic: {
        debounceMs: 5,
        createReranker: () => ({
          id: "broken",
          rerank: async () => [],
          warmup: async () => {
            throw new Error("no disk space");
          },
        }),
      },
    });
    await s.call("settings.update", { patch: { semantic: { rerank: true } } });
    await until(async () => s.rt.semantic?.status().rerank === "error");
    expect(s.rt.semantic?.status().rerankDetail).toBe("no disk space");
    await until(async () => (await s.titles("Automobil")).length > 0, 5000, 20);
  });

  it("leaves semantic search out of a one-shot process", async () => {
    const s = await setup({ autoStart: false });
    expect(s.rt.semantic).toBeUndefined();
    expect(await s.titles("Garage")).toEqual(["Garage"]);
  });
});
