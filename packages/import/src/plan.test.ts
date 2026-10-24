import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ImportOptions,
  ImportReport,
  importPreview,
  importRun,
  Registry,
} from "@citegeist/ops";
import { afterEach, describe, expect, it } from "vitest";
import { bindImportOperations, type ImportQueuePort, loadBundle, previewImport } from "./ops.js";
import { buildPlan, toReport } from "./plan.js";
import { MemoryHost } from "./testing/memory-host.js";
import { buildSampleLibrary } from "./testing/zotero-fixture.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const NOW = new Date("2026-10-24T09:00:00Z");

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function sampleDir(): string {
  const d = mkdtempSync(join(tmpdir(), "cg-plan-"));
  dirs.push(d);
  buildSampleLibrary(d).close();
  return d;
}

const defaults = (over: Partial<ImportOptions> = {}): ImportOptions => ({
  collections: "tags",
  onDuplicate: "skip",
  attachments: true,
  notes: true,
  annotations: true,
  automaticTags: true,
  tags: [],
  ...over,
});

async function planOf(
  dir: string,
  host: MemoryHost,
  over: Partial<ImportOptions> = {},
  projects: string[] = [],
) {
  const options = defaults(over);
  const bundle = await loadBundle({ kind: "zotero-sqlite", path: dir }, options, {});
  const plan = buildPlan({ bundle, options, host, existingProjects: new Set(projects), now: NOW });
  await bundle.dispose?.();
  return plan;
}

describe("dry run of a Zotero import", () => {
  it("counts everything an import would do and writes nothing", async () => {
    const host = new MemoryHost();
    const plan = await planOf(sampleDir(), host);
    expect(plan.provenance).toBe("zotero@2026-10-24");
    expect(plan.counts).toEqual({
      items: 8,
      create: 7,
      merge: 0,
      skip: 1,
      attachments: 2,
      attachmentsMissing: 1,
      notes: 2,
      annotations: 2,
      annotationsSkipped: 2,
      collections: 2,
      tags: 4,
      projects: 0,
    });
    expect(host.writes).toEqual([]);
    expect(host.items.size).toBe(0);
  });

  it("reports duplicates inside the source with the reason", async () => {
    const plan = await planOf(sampleDir(), new MemoryHost());
    const dup = plan.items.find((p) => p.item.ref === "ITEM0009");
    expect(dup).toMatchObject({ action: "skip", duplicateOf: "luhmann1984", reason: "doi" });
    expect(plan.problems.find((p) => p.code === "DUPLICATES_FOUND")?.message).toContain("1 of 8");
  });

  it("finds duplicates against the library and merges or skips them as asked", async () => {
    const lib = () =>
      new MemoryHost([
        { citekey: "luhmann1984social", title: "Social Systems", doi: "10.1000/xyz123", ids: {} },
        {
          citekey: "oldbook",
          title: "Die Gesellschaft der Gesellschaft",
          year: "1997",
          firstAuthor: "Luhmann",
          ids: {},
        },
      ]);
    const skip = await planOf(sampleDir(), lib());
    expect(
      skip.items
        .filter((p) => p.duplicateOf)
        .map((p) => [p.item.ref, p.duplicateOf, p.reason, p.action]),
    ).toEqual([
      ["ITEM0001", "luhmann1984social", "doi", "skip"],
      ["ITEM0002", "oldbook", "title-year-author", "skip"],
      ["ITEM0009", "luhmann1984social", "doi", "skip"],
    ]);
    expect(skip.counts).toMatchObject({
      create: 5,
      skip: 3,
      merge: 0,
      attachments: 1,
      notes: 1,
      annotations: 0,
    });

    const merge = await planOf(sampleDir(), lib(), { onDuplicate: "merge" });
    expect(merge.counts).toMatchObject({
      create: 5,
      skip: 0,
      merge: 3,
      attachments: 2,
      notes: 2,
      annotations: 2,
    });
    expect(merge.items.find((p) => p.item.ref === "ITEM0001")?.citekey).toBe("luhmann1984social");
  });

  it("recognizes items it imported before by their Zotero key", async () => {
    const host = new MemoryHost([
      { citekey: "luhmann1984", title: "Renamed by hand", ids: { zotero: "ITEM0001" } },
    ]);
    const plan = await planOf(sampleDir(), host);
    expect(plan.items.find((p) => p.item.ref === "ITEM0001")).toMatchObject({
      action: "skip",
      reason: "zotero-key",
    });
  });

  it("keeps valid citation keys when free and generates the others without clashes", async () => {
    const host = new MemoryHost([{ citekey: "luhmann1984", title: "Taken", ids: {} }]);
    const plan = await planOf(sampleDir(), host);
    const keys = new Map(plan.items.map((p) => [p.item.ref, p.citekey]));
    // The Better BibTeX key "Luhmann1984" is taken, so the item gets a generated, free key.
    expect(keys.get("ITEM0001")).not.toBe("luhmann1984");
    expect(keys.get("ITEM0001")).toMatch(/^luhmann1984[a-z]+$/);
    const created = plan.items.filter((p) => p.action === "create").map((p) => p.citekey);
    expect(new Set(created).size).toBe(created.length);
    for (const k of created) expect(k).toMatch(/^[a-z0-9][a-z0-9_-]{1,79}$/);
  });

  it("turns collections into tags, projects or nothing", async () => {
    const dir = sampleDir();
    const tags = await planOf(dir, new MemoryHost());
    const article = tags.items.find((p) => p.item.ref === "ITEM0001");
    expect(article?.tags.sort()).toEqual(["Thesis", "Thesis/Chapter 2"]);
    expect(article?.projects).toEqual([]);

    const projects = await planOf(dir, new MemoryHost(), { collections: "projects" });
    expect(projects.projectsToCreate).toEqual([
      { slug: "thesis", title: "Thesis" },
      { slug: "thesis-chapter-2", title: "Thesis / Chapter 2" },
    ]);
    expect(projects.items.find((p) => p.item.ref === "ITEM0001")?.projects.sort()).toEqual([
      "thesis",
      "thesis-chapter-2",
    ]);
    expect(projects.counts.projects).toBe(2);

    const known = await planOf(dir, new MemoryHost(), { collections: "projects" }, ["thesis"]);
    expect(known.projectsToCreate.map((p) => p.slug)).toEqual(["thesis-chapter-2"]);

    const none = await planOf(dir, new MemoryHost(), {
      collections: "none",
      tags: ["imported"],
      project: "zotero",
    });
    const first = none.items.find((p) => p.item.ref === "ITEM0001");
    expect(first?.tags).toEqual(["imported"]);
    expect(first?.projects).toEqual(["zotero"]);
    expect(none.projectsToCreate).toEqual([{ slug: "zotero", title: "zotero" }]);
  });

  it("leaves out what the options switch off", async () => {
    const plan = await planOf(sampleDir(), new MemoryHost(), { attachments: false });
    expect(plan.counts).toMatchObject({ attachments: 0, attachmentsMissing: 0, annotations: 0 });
    expect(plan.problems.some((p) => p.code === "ANNOTATIONS_NEED_ATTACHMENTS")).toBe(true);
    const noNotes = await planOf(sampleDir(), new MemoryHost(), {
      notes: false,
      annotations: false,
    });
    expect(noNotes.counts).toMatchObject({ notes: 0, annotations: 0, annotationsSkipped: 0 });
  });

  it("names missing files and aggregates skipped annotations in the problems", async () => {
    const plan = await planOf(sampleDir(), new MemoryHost());
    expect(plan.problems.find((p) => p.code === "ATTACHMENT_MISSING")).toMatchObject({
      ref: "ITEM0005",
      severity: "warning",
    });
    const codes = plan.problems.map((p) => p.code);
    expect(codes).toContain("ANNOTATION_TYPE_UNSUPPORTED");
    expect(plan.problems.find((p) => p.code === "ANNOTATION_TYPE_UNSUPPORTED")?.message).toMatch(
      /^2 annotations skipped/,
    );
  });
});

describe("dry run of file imports", () => {
  it("plans a BibTeX file with duplicates against the library and inside the file", async () => {
    const host = new MemoryHost([
      {
        citekey: "luhmann1984social",
        title: "Social Systems and Their Environment",
        doi: "10.1000/xyz123",
        ids: {},
      },
    ]);
    const options = defaults();
    const bundle = await loadBundle(
      { kind: "bibtex", path: join(FIXTURES, "sample.bib") },
      options,
      {},
    );
    const plan = buildPlan({ bundle, options, host, existingProjects: new Set(), now: NOW });
    expect(plan.provenance).toBe("bibtex@2026-10-24");
    const view = plan.items.map((p) => [p.item.ref, p.action, p.citekey, p.reason]);
    expect(view).toEqual([
      ["luhmann1984social", "skip", "luhmann1984social", "doi"],
      ["Smith2020Deep", "create", "smith2020deep", undefined],
      ["mueller2015grundlagen", "create", "mueller2015grundlagen", undefined],
      ["Doe_2019", "create", "doe_2019", undefined],
      // Same title (case aside), year and first author as the entry before it.
      ["doe2019study", "skip", "doe_2019", "title-year-author"],
    ]);
    expect(plan.counts).toMatchObject({ items: 5, create: 3, skip: 2 });
  });

  it("plans RIS and CSL-JSON", async () => {
    const host = new MemoryHost();
    const options = defaults();
    const ris = await loadBundle({ kind: "ris", path: join(FIXTURES, "sample.ris") }, options, {});
    const risPlan = buildPlan({
      bundle: ris,
      options,
      host,
      existingProjects: new Set(),
      now: NOW,
    });
    expect(risPlan.items.map((p) => [p.item.ref, p.citekey])).toEqual([
      ["Kuhn1962", "kuhn1962"],
      ["#2", "popper2002logic"],
      ["#3", "luhmann1984social"],
    ]);
    const csl = await loadBundle(
      { kind: "csl-json", path: join(FIXTURES, "sample.json") },
      options,
      {},
    );
    const cslPlan = buildPlan({
      bundle: csl,
      options,
      host,
      existingProjects: new Set(),
      now: NOW,
    });
    expect(cslPlan.items.map((p) => p.citekey)).toEqual([
      "latour2005reassembling",
      "bourdieu1984",
      "weber1922",
    ]);
  });
});

describe("report and operations", () => {
  it("cuts long lists in the report but keeps the counts", async () => {
    const bundle = await loadBundle(
      { kind: "csl-json", path: join(FIXTURES, "sample.json") },
      defaults(),
      {},
    );
    const many = Array.from({ length: 700 }, (_, i) => ({
      ...(bundle.items[0] as NonNullable<(typeof bundle.items)[number]>),
      ref: `r${i}`,
      draft: {
        type: "book",
        title: `Book number ${i}`,
        issued: 2000 + (i % 20),
        author: [{ family: `Author${i}` }],
      },
    })) as typeof bundle.items;
    const plan = buildPlan({
      bundle: { ...bundle, items: many },
      options: defaults(),
      host: new MemoryHost(),
      existingProjects: new Set(),
      now: NOW,
    });
    const report = toReport(plan);
    expect(report.items).toHaveLength(500);
    expect(report.truncated).toBe(true);
    expect(report.counts.items).toBe(700);
    expect(ImportReport.safeParse(report).success).toBe(true);
  });

  function setup() {
    const host = new MemoryHost();
    const enqueued: unknown[] = [];
    const queue: ImportQueuePort = {
      register: () => undefined,
      enqueue: (o) => {
        enqueued.push(o);
        return { id: "j_01JB8Z3QK7ABCDEFGH" };
      },
    };
    const registry = bindImportOperations(new Registry(), { host, queue, now: () => NOW });
    return { host, enqueued, registry };
  }

  it("import.preview applies the option defaults and returns a valid report", async () => {
    const { registry, host } = setup();
    const out = ImportReport.parse(
      await registry.call(
        "import.preview",
        { actor: "human" },
        { source: { kind: "zotero-sqlite", path: sampleDir() } },
      ),
    );
    expect(out.source).toContain("zotero.sqlite");
    expect(out.counts.items).toBe(8);
    expect(host.writes).toEqual([]);
    expect(importPreview.access).toBe("read");
  });

  it("import.run queues a job with the parsed options, and only a human may start it", async () => {
    const { registry, enqueued } = setup();
    const input = {
      source: { kind: "ris", path: join(FIXTURES, "sample.ris") },
      onDuplicate: "merge",
    };
    const out = (await registry.call("import.run", { actor: "human" }, input)) as { job: string };
    expect(out.job).toMatch(/^j_/);
    expect(enqueued[0]).toMatchObject({
      kind: "import",
      by: "human",
      input: {
        source: { kind: "ris" },
        options: { onDuplicate: "merge", collections: "tags", attachments: true, tags: [] },
      },
    });
    await expect(registry.call("import.run", { actor: "agent:x" }, input)).rejects.toMatchObject({
      detail: { code: "FORBIDDEN_ADMIN" },
    });
    expect(importRun.access).toBe("admin");
  });

  it("rejects sources that do not fit their kind", async () => {
    const { registry } = setup();
    await expect(
      registry.call("import.preview", { actor: "human" }, { source: { kind: "bibtex" } }),
    ).rejects.toThrow();
    await expect(
      registry.call("import.preview", { actor: "human" }, { source: { kind: "excel", path: "x" } }),
    ).rejects.toThrow();
  });

  it("previewImport accepts the Zotero API port with its default", async () => {
    const { registry } = setup();
    // Nothing listens on this port: the error says how to turn the API on.
    await expect(
      previewImport(
        registry,
        {
          host: new MemoryHost(),
          queue: { register: () => undefined, enqueue: () => ({ id: "j" }) },
        },
        { kind: "zotero-api", port: 1999 },
        defaults(),
      ),
    ).rejects.toMatchObject({ detail: { code: "ZOTERO_API_UNREACHABLE" } });
  });
});
