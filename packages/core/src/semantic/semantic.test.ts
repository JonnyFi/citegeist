import { join } from "node:path";
import { createFakeEmbedder, type FakeEmbedder } from "@citegeist/embed";
import { afterEach, describe, expect, it } from "vitest";
import { newNoteId } from "../ids.js";
import { JobQueue } from "../jobs/index.js";
import { Library } from "../library.js";
import {
  cardData,
  cleanTmpDirs,
  itemData,
  noteData,
  noteFile,
  tmpDir,
  until,
  writeRaw,
} from "../test-helpers.js";
import { attachSemantic, reciprocalRankFusion, SemanticSearch, splitBody } from "./index.js";

const SYNONYMS = { automobil: "wagen", fahrzeug: "wagen", pkw: "wagen", car: "wagen" };

const libs: Library[] = [];
const queues: JobQueue[] = [];
afterEach(async () => {
  for (const q of queues.splice(0)) await q.close();
  for (const l of libs.splice(0)) await l.close();
  cleanTmpDirs();
});

async function newLibrary(): Promise<Library> {
  const lib = await Library.init(tmpDir("cg-sem-"), { watch: false, localBase: tmpDir("cg-loc-") });
  libs.push(lib);
  return lib;
}

const noteIds = new Map<string, string>();

/** Writes a note file; the same slug keeps its id, like an edit in an external editor. */
function note(lib: Library, slug: string, title: string, body: string, extra = {}): void {
  const key = `${lib.root}/${slug}`;
  if (!noteIds.has(key)) noteIds.set(key, newNoteId());
  writeRaw(
    lib.root,
    `notes/${slug}.md`,
    noteFile(noteData(title, { id: noteIds.get(key), ...extra }), body),
  );
}

function setup(embedder: FakeEmbedder, lib: Library, minSimilarity = 0.05): SemanticSearch {
  return new SemanticSearch(lib.index, embedder, { minSimilarity });
}

describe("reciprocalRankFusion", () => {
  it("rewards items found by both lists and keeps the first version", () => {
    const fused = reciprocalRankFusion(
      [
        {
          items: [
            { k: "a", from: "lex" },
            { k: "b", from: "lex" },
          ],
        },
        {
          items: [
            { k: "c", from: "vec" },
            { k: "b", from: "vec" },
          ],
        },
      ],
      (x) => x.k,
    );
    expect(fused.map((f) => f.item.k)).toEqual(["b", "a", "c"]);
    expect(fused[0]?.item.from).toBe("lex");
    expect(fused[0]?.score).toBeCloseTo(1 / 62 + 1 / 62);
    expect(fused[1]?.score).toBeCloseTo(1 / 61);
  });

  it("weights lists", () => {
    const fused = reciprocalRankFusion(
      [
        { items: ["a"], weight: 1 },
        { items: ["b"], weight: 3 },
      ],
      (x) => x,
    );
    expect(fused.map((f) => f.item)).toEqual(["b", "a"]);
  });

  it("returns nothing for no lists", () => {
    expect(reciprocalRankFusion([], (x: string) => x)).toEqual([]);
  });
});

describe("splitBody", () => {
  it("keeps short text whole and merges short paragraphs", () => {
    expect(splitBody("Eins.\n\nZwei.\n\nDrei.")).toEqual(["Eins.\n\nZwei.\n\nDrei."]);
  });

  it("splits long text at sentence borders below the limit", () => {
    const sentence = "Dies ist ein Satz mit einigen Worten darin. ";
    const parts = splitBody(sentence.repeat(100), 500);
    expect(parts.length).toBeGreaterThan(5);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(500);
      expect(p.endsWith(".")).toBe(true);
    }
  });

  it("returns nothing for blank text", () => {
    expect(splitBody("  \n\n ")).toEqual([]);
  });
});

describe("hybrid search", () => {
  it("finds by meaning what full-text search misses", async () => {
    const lib = await newLibrary();
    note(lib, "garage", "Garage", "Der Wagen steht in der Garage und wartet.");
    note(lib, "obst", "Obst", "Äpfel und Birnen liegen im Korb der Küche.");
    lib.sync();
    const embedder = createFakeEmbedder({ synonyms: SYNONYMS });
    const sem = setup(embedder, lib);

    expect(lib.search({ q: "Automobil" })).toEqual([]);
    expect((await sem.sync()).embedded).toBe(2);
    const hits = await sem.search({ q: "Automobil", kinds: ["note"] });
    expect(hits.map((h) => h.title)).toEqual(["Garage"]);
    expect(hits[0]?.snippet).toContain("Wagen");
  });

  it("ranks a document found by both sides above one found by one side", async () => {
    const lib = await newLibrary();
    note(lib, "a", "Auto A", "Das Fahrzeug fährt schnell über die Autobahn nach Wien.");
    note(lib, "b", "Wagen B", "Der Wagen wurde gestern in der Werkstatt repariert.");
    note(lib, "c", "Unrelated", "Gemüse wächst im Frühling im Garten hinter dem Haus.");
    lib.sync();
    const sem = setup(createFakeEmbedder({ synonyms: SYNONYMS }), lib);
    await sem.sync();

    const lexical = lib.search({ q: "Wagen", kinds: ["note"] }).map((h) => h.title);
    expect(lexical).toEqual(["Wagen B"]);
    const hybrid = await sem.search({ q: "Wagen", kinds: ["note"] });
    // B matches by words and by meaning, A only by meaning (via the synonym), C not at all.
    expect(hybrid.map((h) => h.title).slice(0, 2)).toEqual(["Wagen B", "Auto A"]);
    expect(hybrid[0]?.score).toBeGreaterThan(hybrid[1]?.score ?? 1);
  });

  it("returns exactly the full-text result while no embeddings exist", async () => {
    const lib = await newLibrary();
    note(lib, "a", "Systemtheorie", "Soziale Systeme bestehen aus Kommunikation.");
    note(lib, "b", "Methode", "Eine Methode ist ein Weg zu einem Ziel.");
    lib.sync();
    const embedder = createFakeEmbedder();
    const sem = setup(embedder, lib);

    expect(sem.active).toBe(false);
    const input = { q: "Systeme Kommunikation", limit: 5 };
    expect(await sem.search(input)).toEqual(lib.search(input));
    expect(embedder.calls).toBe(0);
  });

  it("falls back to full-text when the vectors belong to another model", async () => {
    const lib = await newLibrary();
    note(lib, "a", "Systemtheorie", "Soziale Systeme bestehen aus Kommunikation.");
    lib.sync();
    await setup(createFakeEmbedder({ version: "1" }), lib).sync();
    const other = createFakeEmbedder({ version: "2" });
    const sem = setup(other, lib);
    expect(sem.active).toBe(false);
    expect(await sem.search({ q: "Systeme" })).toEqual(lib.search({ q: "Systeme" }));
    expect(other.calls).toBe(0);
  });

  it("falls back to full-text when the query cannot be embedded", async () => {
    const lib = await newLibrary();
    note(lib, "a", "Systemtheorie", "Soziale Systeme bestehen aus Kommunikation.");
    lib.sync();
    const embedder = createFakeEmbedder();
    const sem = setup(embedder, lib);
    await sem.sync();
    embedder.embedQuery = async () => {
      throw new Error("model gone");
    };
    expect(await sem.search({ q: "Systeme" })).toEqual(lib.search({ q: "Systeme" }));
  });

  it("applies kind and scope filters to the vector side", async () => {
    const lib = await newLibrary();
    lib.writeItem(
      itemData("aaaa", {
        title: "Fahrzeugbau",
        tags: ["technik"],
        projects: ["p1"],
        status: "read",
      }),
      "Der Wagen ist ein Fahrzeug mit vier Rädern für den Straßenverkehr.",
    );
    lib.writeItem(
      itemData("bbbb", { title: "Fahrzeughandel", tags: ["markt"], projects: ["p2"] }),
      "Der Wagen wird auf dem Markt als Fahrzeug mit vier Rädern verkauft.",
    );
    const card = cardData("aaaa", "Das Fahrzeug mit vier Rädern heißt Wagen im Alltag.");
    lib.writeCard(card.fm, card.body);
    note(lib, "n1", "Notiz zum Wagen", "Ein Wagen mit vier Rädern, notiert im Projekt.", {
      projects: ["p1"],
    });
    lib.sync();
    const sem = setup(createFakeEmbedder({ synonyms: SYNONYMS }), lib);
    await sem.sync();

    const ids = async (extra: object) =>
      (await sem.search({ q: "Automobil", ...extra })).map((h) => `${h.kind}:${h.citekey ?? h.id}`);
    expect(await ids({ kinds: ["item"] })).toEqual(
      expect.arrayContaining(["item:aaaa", "item:bbbb"]),
    );
    expect(await ids({ kinds: ["item"], project: "p1" })).toEqual(["item:aaaa"]);
    expect(await ids({ kinds: ["item"], tags: ["markt"] })).toEqual(["item:bbbb"]);
    expect(await ids({ kinds: ["item", "card"], status: "read" })).toEqual(
      expect.arrayContaining(["item:aaaa", `card:aaaa`]),
    );
    expect(await ids({ kinds: ["item", "card"], status: "read" })).not.toContain("item:bbbb");
    const notes = await sem.search({ q: "Automobil", kinds: ["note"], project: "p1" });
    expect(notes.map((h) => h.title)).toEqual(["Notiz zum Wagen"]);
    expect(await sem.search({ q: "Automobil", kinds: ["note"], project: "p2" })).toEqual([]);
  });

  it("finds blocks of converted documents with title and page", async () => {
    const lib = await newLibrary();
    lib.writeItem(itemData("cccc", { title: "Das Buch" }), "");
    lib.writeFile(
      "items/cccc/derived/3f9a1c2e7b4d/blocks.jsonl",
      `${JSON.stringify({
        id: "bk2f9a1x",
        type: "paragraph",
        sec: "Verkehr",
        flow: "body",
        text: "Der Wagen steht auf der Straße vor dem Haus.",
        spans: [{ page: 4, label: "5", start: 0, end: 44 }],
        src: { engine: "docling" },
      })}\n${JSON.stringify({
        id: "bfur0001",
        type: "page-furniture",
        flow: "furniture",
        text: "Kopfzeile mit dem Wagen darin gedruckt auf jeder Seite",
        spans: [],
        src: { engine: "docling" },
      })}\n`,
    );
    lib.sync();
    const sem = setup(createFakeEmbedder({ synonyms: SYNONYMS }), lib);
    const report = await sem.sync();
    const hits = await sem.search({ q: "Automobil", kinds: ["block"] });
    expect(report.chunks).toBeGreaterThanOrEqual(1);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      kind: "block",
      id: "bk2f9a1x",
      citekey: "cccc",
      title: "Das Buch",
      page: "5",
    });
  });
});

describe("incremental embedding", () => {
  it("embeds only what changed and drops what vanished", async () => {
    const lib = await newLibrary();
    note(lib, "a", "Erste", "Der Wagen steht in der Garage und wartet auf den Winter.");
    note(lib, "b", "Zweite", "Äpfel und Birnen liegen im Korb in der Küche des Hauses.");
    lib.sync();
    const embedder = createFakeEmbedder({ synonyms: SYNONYMS });
    const sem = setup(embedder, lib);

    expect(await sem.sync()).toMatchObject({ chunks: 2, embedded: 2, removed: 0 });
    expect(await sem.sync()).toMatchObject({ chunks: 2, embedded: 0, removed: 0 });
    const calls = embedder.calls;
    await sem.sync();
    expect(embedder.calls).toBe(calls);

    // change one note
    embedder.texts.length = 0;
    note(lib, "b", "Zweite", "Birnen und Kirschen liegen jetzt im Korb in der Küche des Hauses.");
    lib.sync();
    expect(await sem.sync()).toMatchObject({ chunks: 2, embedded: 1, removed: 0 });
    expect(embedder.texts).toHaveLength(1);
    expect(embedder.texts[0]).toContain("Kirschen");

    // add one
    note(lib, "c", "Dritte", "Ein neuer Gedanke über Wagen und andere Fahrzeuge auf der Straße.");
    lib.sync();
    expect(await sem.sync()).toMatchObject({ chunks: 3, embedded: 1 });
    expect(sem.store.count()).toBe(3);

    // delete one: its vector goes and it never shows up again
    lib.indexer.removePath("notes/a.md");
    const hits = await sem.search({ q: "Automobil", kinds: ["note"] });
    expect(hits.map((h) => h.title)).not.toContain("Erste");
    expect(await sem.sync()).toMatchObject({ chunks: 2, embedded: 0, removed: 1 });
    expect(sem.store.count()).toBe(2);
  });

  it("keeps its vectors across an index rebuild", async () => {
    const lib = await newLibrary();
    note(lib, "a", "Erste", "Der Wagen steht in der Garage und wartet auf den Winter.");
    lib.sync();
    const embedder = createFakeEmbedder();
    const sem = setup(embedder, lib);
    await sem.sync();
    lib.indexer.rebuild();
    expect(await sem.sync()).toMatchObject({ chunks: 1, embedded: 0, removed: 0 });
    expect(embedder.texts).toHaveLength(1);
  });

  it("starts from scratch when the model changes", async () => {
    const lib = await newLibrary();
    note(lib, "a", "Erste", "Der Wagen steht in der Garage und wartet auf den Winter.");
    lib.sync();
    await setup(createFakeEmbedder({ version: "1" }), lib).sync();
    const next = setup(createFakeEmbedder({ version: "2", dimensions: 32 }), lib);
    expect(await next.sync()).toMatchObject({ embedded: 1, rebuilt: true });
    expect(next.active).toBe(true);
    expect((await next.search({ q: "Wagen" })).length).toBe(1);
  });

  it("stops on abort and keeps finished batches", async () => {
    const lib = await newLibrary();
    for (let i = 0; i < 6; i++) {
      note(lib, `n${i}`, `Notiz ${i}`, `Gedanke Nummer ${i} über die Garage und den Wagen im Hof.`);
    }
    lib.sync();
    const sem = setup(createFakeEmbedder(), lib);
    const controller = new AbortController();
    await expect(
      sem.sync({
        batchSize: 2,
        signal: controller.signal,
        onProgress: (done) => {
          if (done >= 2) controller.abort();
        },
      }),
    ).rejects.toThrow();
    expect(sem.store.count()).toBe(2);
    expect(await sem.sync({ batchSize: 2 })).toMatchObject({ chunks: 6, embedded: 4 });
  });

  it("indexes long documents as several chunks", async () => {
    const lib = await newLibrary();
    const paragraph = "Dieser Absatz handelt vom Wagen und seiner langen Geschichte in der Stadt. ";
    note(lib, "long", "Lang", Array.from({ length: 80 }, () => paragraph).join("\n\n"));
    lib.sync();
    const sem = setup(createFakeEmbedder(), lib);
    const report = await sem.sync();
    expect(report.chunks).toBeGreaterThan(2);
    expect(report.chunks).toBeLessThanOrEqual(24);
    const hits = await sem.search({ q: "Wagen Geschichte", kinds: ["note"] });
    expect(hits.filter((h) => h.title === "Lang")).toHaveLength(1);
  });
});

describe("embed job", () => {
  it("queues an embed job after indexing and makes search hybrid", async () => {
    const lib = await newLibrary();
    const queue = new JobQueue({ dbPath: join(tmpDir("cg-q-"), "state.sqlite") });
    queues.push(queue);
    const embedder = createFakeEmbedder({ synonyms: SYNONYMS });
    const { semantic, detach } = attachSemantic(lib, queue, {
      embedder,
      debounceMs: 20,
      minSimilarity: 0.05,
    });
    queue.start();

    // the catch-up job at attach time
    await until(() => queue.list({ status: "succeeded", limit: 5 }).jobs.length === 1);
    expect(semantic.active).toBe(false);

    lib.writeItem(itemData("dddd", { title: "Fahrzeug" }), "Der Wagen steht vor dem Haus in Wien.");
    await until(() => semantic.active, 5000);
    const jobs = queue.list({ limit: 10 }).jobs.filter((j) => j.kind === "embed");
    expect(jobs.length).toBeGreaterThanOrEqual(2);
    expect(jobs.every((j) => j.status === "succeeded" && j.by === "system")).toBe(true);
    expect(
      (await semantic.search({ q: "Automobil", kinds: ["item"] })).map((h) => h.citekey),
    ).toEqual(["dddd"]);

    // a burst of changes becomes one job, not one per file
    const before = queue.list({ limit: 50 }).jobs.length;
    for (let i = 0; i < 5; i++) {
      lib.writeItem(
        itemData(`e${i}xx`, { abstract: `Zusammenfassung Nummer ${i} über Garten und Haus.` }),
        "",
      );
    }
    await until(() => semantic.store.count() >= 6, 5000);
    await queue.idle();
    expect(queue.list({ limit: 50 }).jobs.length - before).toBeLessThanOrEqual(2);
    detach();
  });

  it("reports progress and fails visibly when the model cannot load", async () => {
    const lib = await newLibrary();
    note(lib, "a", "Erste", "Der Wagen steht in der Garage und wartet auf den Winter.");
    lib.sync();
    const queue = new JobQueue({ dbPath: join(tmpDir("cg-q-"), "state.sqlite") });
    queues.push(queue);
    const embedder = createFakeEmbedder();
    embedder.embedDocuments = async () => {
      throw new Error("model files are corrupt");
    };
    const { scheduler, detach } = attachSemantic(lib, queue, { embedder, debounceMs: 10 });
    queue.start();
    const id = scheduler.enqueueNow();
    expect(id).toBeDefined();
    const job = await queue.waitFor(id as string);
    expect(job.status).toBe("failed");
    expect(job.error?.message).toContain("corrupt");
    detach();
  });
});
