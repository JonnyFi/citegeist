// Runs the importers against the real core: a library on disk, the registry with its operations
// and the job queue. Only the conversion worker is the stub.
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime, createStubWorker, Library, type Runtime } from "@citegeist/core";
import type { ImportResult } from "@citegeist/ops";
import type { Actor, CardBody, CardFrontmatter, ItemFrontmatter } from "@citegeist/schema";
import { afterEach, describe, expect, it } from "vitest";
import { createLibraryHost } from "./host.js";
import { bindImportOperations } from "./ops.js";
import { buildSampleLibrary, tinyPdf } from "./testing/zotero-fixture.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const human = { actor: "human" as Actor };

const dirs: string[] = [];
const open: Array<{ lib: Library; rt: Runtime }> = [];
const tmp = (prefix: string): string => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
};

afterEach(async () => {
  for (const { lib, rt } of open.splice(0)) {
    await rt.close();
    await lib.close();
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function setup() {
  const lib = await Library.init(tmp("cg-imp-lib-"), {
    watch: false,
    localBase: tmp("cg-imp-local-"),
  });
  const unavailable = async () => {
    throw new Error("no network in tests");
  };
  const rt = createRuntime(lib, {
    worker: createStubWorker(),
    resolver: { resolve: unavailable, resolveByTitle: unavailable },
    ai: { backends: [] },
    settings: { localBase: tmp("cg-imp-settings-") },
  });
  open.push({ lib, rt });
  bindImportOperations(rt.registry, { host: createLibraryHost(lib), queue: rt.ingest.queue });
  const call = <T>(name: string, input: unknown): Promise<T> =>
    rt.registry.call(name, human, input) as Promise<T>;
  const run = async (input: unknown): Promise<ImportResult> => {
    const { job } = await call<{ job: string }>("import.run", input);
    const done = await rt.ingest.queue.waitFor(job);
    if (done.status !== "succeeded")
      throw new Error(`import job ${done.status}: ${JSON.stringify(done.error)}`);
    return done.result as ImportResult;
  };
  return { lib, rt, call, run };
}

function zoteroDir(): string {
  const dir = tmp("cg-imp-zotero-");
  buildSampleLibrary(dir).close();
  return dir;
}

describe("Zotero import into a real library", () => {
  it("imports items, files, annotations as cards, notes and projects as the system", async () => {
    const { lib, call, run } = await setup();
    const source = { kind: "zotero-sqlite", path: zoteroDir() };
    const preview = await call<{ counts: Record<string, number> }>("import.preview", {
      source,
      collections: "projects",
    });
    expect(preview.counts).toMatchObject({
      create: 7,
      skip: 1,
      attachments: 2,
      annotations: 2,
      projects: 2,
    });
    expect(lib.status().items).toBe(0);

    const result = await run({ source, collections: "projects" });
    expect(result).toMatchObject({
      skipped: 1,
      attachments: 2,
      notes: 2,
      cards: 2,
      projects: ["thesis", "thesis-chapter-2"],
    });
    expect(result.created).toHaveLength(7);
    expect(result.problems.filter((p) => p.severity === "error")).toEqual([]);
    expect(result.provenance).toMatch(/^zotero@\d{4}-\d{2}-\d{2}$/);

    // The item: Better BibTeX key kept (lower-cased), provenance, system actor, collections as projects.
    const got = await call<{ frontmatter: ItemFrontmatter; cards: number }>("items.get", {
      citekey: "luhmann1984",
    });
    const fm = got.frontmatter;
    expect(fm).toMatchObject({
      type: "article-journal",
      zotero_type: "journalArticle",
      title: "Social Systems and Their Environment",
      DOI: "10.1000/xyz123",
      issued: "1984-03",
      ids: { zotero: "ITEM0001", pmid: "12345" },
      projects: ["thesis", "thesis-chapter-2"],
      created: { at: "2023-11-02T10:30:00.000Z", by: "system" },
    });
    expect(fm.tags).toEqual(["auto-tag", "systems theory"]);
    expect(fm.provenance.title).toBe(result.provenance);
    expect(fm.provenance.DOI).toBe(result.provenance);
    expect(got.cards).toBe(2);

    // The PDF is a source of the item, converted by the stub worker.
    expect(fm.sources).toHaveLength(1);
    expect(fm.sources[0]).toMatchObject({ kind: "pdf", filename: "paper.pdf", role: "main" });
    const hash = fm.sources[0]?.hash as string;

    // Annotations became cards: quote verbatim, comment in the note, page label as locator,
    // rectangles in the PDF anchor.
    const { cards } = await call<{
      cards: { frontmatter: CardFrontmatter; body: CardBody }[];
    }>("cards.list", { citekey: "luhmann1984" });
    const first = cards.find((c) => c.body.quote === "Systems differ from their environment.");
    expect(first?.body.note).toBe("This is the core claim.");
    expect(first?.frontmatter).toMatchObject({
      item: "luhmann1984",
      source: hash,
      locator: { label: "page", start: "33", confirmed: true },
      anchor: { pdf: { page: 1, quads: [[100.5, 600.25, 300.75, 612.5]], file: hash } },
      tags: ["core"],
      projects: ["thesis", "thesis-chapter-2"],
      created: { by: "system" },
    });
    const second = cards.find((c) => c.body.quote === "Second passage.");
    expect(second?.frontmatter.anchor.pdf).toMatchObject({ page: 2, file: hash });
    expect(second?.frontmatter.anchor.pdf?.quads).toHaveLength(2);
    expect(second?.body.note).toBeUndefined();

    // Notes: the child note is a literature note that links the item, the loose one stands alone.
    const { notes } = await call<{ notes: { id: string; title: string; type: string }[] }>(
      "notes.list",
      {},
    );
    expect(notes.map((n) => [n.title, n.type]).sort()).toEqual([
      ["A stand-alone note about nothing in particular.", "permanent"],
      ["Reading notes (luhmann1984)", "literature"],
    ]);
    const lit = notes.find((n) => n.type === "literature");
    const note = await call<{ body: string }>("notes.get", { id: lit?.id });
    expect(note.body).toContain("Item: [[luhmann1984]]");
    expect(note.body).toContain(
      "The paper argues that **systems** differ from their *environment*.",
    );

    // Other items: the stand-alone PDF is an item of its own, the book keeps its ISBN.
    const loose = (
      await call<{ items: { citekey: string; title: string }[] }>("items.list", { limit: 50 })
    ).items;
    expect(loose.map((i) => i.title).sort()).toEqual([
      "Attention Is All You Need",
      "Brown v. Board of Education",
      "Die Gesellschaft der Gesellschaft",
      "Education at a Glance",
      "Loose Paper",
      "On Methods",
      "Social Systems and Their Environment",
    ]);
    const projects = await call<{ projects: { slug: string }[] }>("projects.list", {});
    expect(projects.projects.map((p) => p.slug).sort()).toEqual(["thesis", "thesis-chapter-2"]);
    expect(lib.status().problems).toEqual([]);
  });

  it("is repeatable: a second run skips what the first one imported", async () => {
    const { lib, run } = await setup();
    const source = { kind: "zotero-sqlite", path: zoteroDir() };
    await run({ source });
    const items = lib.status().items;
    const again = await run({ source });
    expect(again.created).toEqual([]);
    expect(again.skipped).toBe(8);
    expect(again.cards).toBe(0);
    expect(lib.status().items).toBe(items);
  });

  it("merges into an existing item without duplicating cards or notes", async () => {
    const { lib, call, run } = await setup();
    // The reader already added the paper by hand, without tags, a source or notes.
    const added = await call<{ citekey: string; job: string }>("items.add", {
      identifier:
        "@article{mine, title={Social Systems and Their Environment}, author={Luhmann, Niklas}, year={1984}, doi={10.1000/xyz123}}",
    });
    expect(added.citekey).toBe("mine");
    const source = { kind: "zotero-sqlite", path: zoteroDir() };
    const first = await run({ source, onDuplicate: "merge" });
    expect(first.merged).toEqual(["mine"]);
    expect(first.created).not.toContain("mine");
    const item = lib.getItem("mine").frontmatter;
    expect([...item.tags].sort()).toEqual([
      "Thesis",
      "Thesis/Chapter 2",
      "auto-tag",
      "systems theory",
    ]);
    // Fields the item had stay, empty ones are filled and stamped.
    expect(item.author).toEqual([{ family: "Luhmann", given: "Niklas" }]);
    expect(item["container-title"]).toBe("Journal of Systems");
    expect(item.provenance["container-title"]).toBe(first.provenance);
    expect(item.ids.zotero).toBe("ITEM0001");
    expect(item.sources).toHaveLength(1);
    expect(first.cards).toBe(2);

    const second = await run({ source, onDuplicate: "merge" });
    expect(second.cards).toBe(0);
    expect(second.notes).toBe(0);
    expect(second.attachments).toBe(0);
    expect(lib.getItem("mine").frontmatter.sources).toHaveLength(1);
  });

  it("reports problems per item and keeps going", async () => {
    const { call, run } = await setup();
    const dir = zoteroDir();
    // Remove the PDF of the annotated article after the plan could see it: the item still imports.
    rmSync(join(dir, "storage", "ATTA0001"), { recursive: true });
    const result = await run({ source: { kind: "zotero-sqlite", path: dir } });
    expect(result.attachments).toBe(1);
    expect(result.cards).toBe(0);
    expect(result.created).toHaveLength(7);
    const { items } = await call<{ items: unknown[] }>("items.list", { limit: 50 });
    expect(items).toHaveLength(7);
  });
});

describe("file imports into a real library", () => {
  it("imports a BibTeX file with a PDF folder and skips duplicates of the library", async () => {
    const { lib, call, run } = await setup();
    await call("items.add", {
      identifier:
        "@article{old, title={Social Systems and Their Environment}, author={Luhmann, Niklas}, year={1984}, doi={10.1000/xyz123}}",
    });
    const dir = tmp("cg-imp-bib-");
    copyFileSync(join(FIXTURES, "sample.bib"), join(dir, "sample.bib"));
    mkdirSync(join(dir, "files"));
    writeFileSync(join(dir, "files", "Smith2020.pdf"), tinyPdf("smith"));
    const pdfs = join(dir, "pdfs");
    mkdirSync(pdfs);
    writeFileSync(join(pdfs, "mueller2015grundlagen.pdf"), tinyPdf("mueller"));

    const source = { kind: "bibtex", path: join(dir, "sample.bib"), pdfFolder: pdfs };
    const preview = await call<{ counts: Record<string, number> }>("import.preview", {
      source,
      tags: ["from-bib"],
    });
    expect(preview.counts).toMatchObject({ items: 5, create: 3, skip: 2, attachments: 2 });

    const result = await run({ source, tags: ["from-bib"], project: "bib-import" });
    expect(result.created).toEqual(["smith2020deep", "mueller2015grundlagen", "doe_2019"]);
    expect(result.skipped).toBe(2);
    expect(result.attachments).toBe(2);
    expect(result.projects).toEqual(["bib-import"]);
    expect(result.provenance).toMatch(/^bibtex@/);
    const smith = lib.getItem("smith2020deep").frontmatter;
    expect(smith.sources.map((s) => s.filename)).toEqual(["Smith2020.pdf"]);
    expect(smith.tags).toEqual(["from-bib"]);
    expect(smith.projects).toEqual(["bib-import"]);
    expect(smith.provenance.title).toBe(result.provenance);
    expect(lib.getItem("mueller2015grundlagen").frontmatter.sources[0]?.filename).toBe(
      "mueller2015grundlagen.pdf",
    );
  });

  it("imports RIS and CSL-JSON", async () => {
    const { lib, run } = await setup();
    const ris = await run({ source: { kind: "ris", path: join(FIXTURES, "sample.ris") } });
    expect(ris.created).toEqual(["kuhn1962", "popper2002logic", "luhmann1984social"]);
    expect(lib.getItem("kuhn1962").frontmatter.tags).toEqual(["paradigm", "philosophy of science"]);
    const csl = await run({ source: { kind: "csl-json", path: join(FIXTURES, "sample.json") } });
    expect(csl.created).toEqual(["latour2005reassembling", "bourdieu1984", "weber1922"]);
    expect(lib.status().items).toBe(6);
    expect(lib.status().problems).toEqual([]);
  });

  it("refuses a run from an agent and a source that does not exist", async () => {
    const { rt, call } = await setup();
    await expect(
      rt.registry.call(
        "import.run",
        { actor: "agent:x" },
        { source: { kind: "ris", path: join(FIXTURES, "sample.ris") } },
      ),
    ).rejects.toMatchObject({ detail: { code: "FORBIDDEN_ADMIN" } });
    await expect(
      call("import.preview", { source: { kind: "ris", path: "/nonexistent/x.ris" } }),
    ).rejects.toMatchObject({
      detail: { code: "IMPORT_SOURCE_NOT_FOUND" },
    });
  });
});
