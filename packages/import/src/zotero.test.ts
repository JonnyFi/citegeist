import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildSampleLibrary, ZoteroFixture } from "./testing/zotero-fixture.js";
import type { SourceBundle } from "./types.js";
import { annotationToCard, parsePdfPosition } from "./zotero/annotations.js";
import { bundleFromZotero, parseExtra, zoteroDateParts } from "./zotero/convert.js";
import { readZoteroSqlite } from "./zotero/sqlite.js";

const dirs: string[] = [];
const closers: (() => void | Promise<void>)[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "cg-import-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Switches {
  attachments: boolean;
  notes: boolean;
  annotations: boolean;
  automaticTags: boolean;
}
const ALL: Switches = { attachments: true, notes: true, annotations: true, automaticTags: true };

async function load(
  dir: string,
  options: Partial<Switches> & { linkedFilesBase?: string } = {},
): Promise<SourceBundle> {
  const raw = readZoteroSqlite({ path: dir });
  closers.push(() => raw.dispose?.());
  return bundleFromZotero(raw, { options: { ...ALL, ...options } });
}

function sample(): string {
  const dir = tmp();
  buildSampleLibrary(dir).close();
  return dir;
}

describe("reading zotero.sqlite", () => {
  it("reads items, skips the trash and other libraries, and maps types and fields", async () => {
    const bundle = await load(sample());
    const byRef = new Map(bundle.items.map((i) => [i.ref, i]));
    expect([...byRef.keys()].sort()).toEqual([
      "ATTA0007",
      "ITEM0001",
      "ITEM0002",
      "ITEM0003",
      "ITEM0004",
      "ITEM0005",
      "ITEM0006",
      "ITEM0009",
    ]);

    const article = byRef.get("ITEM0001")?.draft;
    expect(article).toMatchObject({
      type: "article-journal",
      zotero_type: "journalArticle",
      title: "Social Systems and Their Environment",
      "container-title": "Journal of Systems",
      volume: "12",
      issue: "3",
      page: "31-45",
      issued: "1984-03",
      DOI: "10.1000/xyz123",
      abstract: "An abstract about systems.",
      language: "en",
      citekey: "luhmann1984",
      note: "Peer reviewed in 1984",
      accessed: { "date-parts": [[2024, 1, 15]] },
      ids: { zotero: "ITEM0001", pmid: "12345" },
    });
    expect(article?.author).toEqual([
      { family: "Luhmann", given: "Niklas" },
      { family: "Habermas", given: "Jürgen" },
    ]);
    expect(article?.editor).toEqual([{ family: "Editor", given: "Ada" }]);
    expect(byRef.get("ITEM0001")?.dateAdded).toBe("2023-11-02T10:30:00.000Z");
  });

  it("maps base fields, creator roles and single-field names", async () => {
    const bundle = await load(sample());
    const byRef = new Map(bundle.items.map((i) => [i.ref, i.draft]));
    const section = byRef.get("ITEM0003");
    expect(section).toMatchObject({
      type: "chapter",
      "container-title": "Handbook of Research",
      publisher: "Springer",
      issued: 2010,
    });
    expect(section?.author).toEqual([{ family: "Muster", given: "Maria" }]);
    expect(section?.editor).toEqual([{ family: "Herausgeber", given: "Hans" }]);
    expect(section?.["container-author"]).toEqual([{ family: "Buch", given: "Hanna" }]);

    const legal = byRef.get("ITEM0004");
    expect(legal).toMatchObject({
      type: "legal_case",
      title: "Brown v. Board of Education",
      authority: "Supreme Court",
      issued: "1954-05-17",
      "container-title": "U.S.",
    });

    const preprint = byRef.get("ITEM0005");
    expect(preprint).toMatchObject({
      type: "article",
      issued: "2017-06-12",
      URL: "https://arxiv.org/abs/1706.03762",
    });
    expect((preprint?.ids as Record<string, string> | undefined)?.arxiv).toBe("1706.03762");

    const report = byRef.get("ITEM0006");
    expect(report?.author).toEqual([{ literal: "OECD" }]);
    expect(report?.publisher).toBe("OECD");

    const book = byRef.get("ITEM0002");
    expect(book).toMatchObject({
      ISBN: "978-3-518-28960-7",
      language: "de-DE",
      "publisher-place": "Frankfurt am Main",
    });
  });

  it("keeps tags, collections as paths and respects the automatic tags option", async () => {
    const dir = sample();
    const bundle = await load(dir);
    const article = bundle.items.find((i) => i.ref === "ITEM0001");
    expect(article?.draft.tags).toEqual(["auto-tag", "systems theory"]);
    expect([...(article?.collections ?? [])].sort()).toEqual(["Thesis", "Thesis/Chapter 2"]);
    expect([...bundle.collections].sort()).toEqual(["Thesis", "Thesis/Chapter 2"]);
    const manual = await load(dir, { automaticTags: false });
    expect(manual.items.find((i) => i.ref === "ITEM0001")?.draft.tags).toEqual(["systems theory"]);
  });

  it("converts child notes to Markdown and keeps stand-alone notes apart", async () => {
    const bundle = await load(sample());
    const article = bundle.items.find((i) => i.ref === "ITEM0001");
    expect(article?.notes).toHaveLength(1);
    expect(article?.notes[0]?.title).toBe("Reading notes");
    expect(article?.notes[0]?.markdown).toContain(
      "The paper argues that **systems** differ from their *environment*.",
    );
    expect(bundle.standaloneNotes.map((n) => n.markdown)).toEqual([
      "A stand-alone note about nothing in particular.",
    ]);
    const without = await load(sample(), { notes: false });
    expect(without.standaloneNotes).toEqual([]);
    expect(without.items.find((i) => i.ref === "ITEM0001")?.notes).toEqual([]);
  });

  it("finds attachment files in storage and reports missing ones", async () => {
    const dir = sample();
    const bundle = await load(dir);
    const article = bundle.items.find((i) => i.ref === "ITEM0001");
    expect(article?.attachments).toHaveLength(1);
    expect(article?.attachments[0]?.path).toBe(join(dir, "storage", "ATTA0001", "paper.pdf"));
    const preprint = bundle.items.find((i) => i.ref === "ITEM0005");
    expect(preprint?.attachments[0]?.path).toBeUndefined();
    expect(preprint?.attachments[0]?.missing).toMatch(/file not found/);
    // A PDF without a parent item becomes an item of its own, titled after the file.
    const loose = bundle.items.find((i) => i.ref === "ATTA0007");
    expect(loose?.draft.title).toBe("Loose Paper");
    expect(loose?.draft.zotero_type).toBe("attachment");
    expect(loose?.attachments[0]?.path).toBe(join(dir, "storage", "ATTA0007", "Loose Paper.pdf"));
    expect(bundle.filesChecked).toBe(true);
  });

  it("collects the PDF annotations of an attachment in reading order", async () => {
    const bundle = await load(sample());
    const anns = bundle.items.find((i) => i.ref === "ITEM0001")?.attachments[0]?.annotations ?? [];
    expect(anns.map((a) => [a.ref, a.type])).toEqual([
      ["ANNO0001", "highlight"],
      ["ANNO0002", "underline"],
      ["ANNO0003", "image"],
      ["ANNO0004", "note"],
    ]);
    expect(anns[0]).toMatchObject({
      pageLabel: "33",
      tags: ["core"],
      comment: "This is the core claim.",
    });
    const off = await load(sample(), { annotations: false });
    expect(off.items.find((i) => i.ref === "ITEM0001")?.attachments[0]?.annotations).toEqual([]);
  });

  it("reads changes that only live in the write-ahead log, from a copy", async () => {
    const dir = tmp();
    // wal_autocheckpoint=0 and an open connection keep the newest rows in zotero.sqlite-wal.
    const z = buildSampleLibrary(dir, { walAutocheckpoint: false });
    closers.push(() => {
      if (z.db.open) z.close();
    });
    expect(existsSync(`${z.dbPath}-wal`)).toBe(true);
    const before = readdirSync(dir).sort();
    const bundle = await load(dir);
    expect(bundle.items.find((i) => i.ref === "ITEM0001")).toBeDefined();
    // The original files are not touched and nothing is left over besides them.
    expect(readdirSync(dir).sort()).toEqual(before);
  });

  it("accepts the data directory or the file, and rejects other files", () => {
    const dir = sample();
    expect(readZoteroSqlite({ path: join(dir, "zotero.sqlite") }).items.length).toBeGreaterThan(0);
    expect(() => readZoteroSqlite({ path: join(dir, "nothing") })).toThrow(/no zotero\.sqlite/);
    const bogus = join(tmp(), "zotero.sqlite");
    writeFileSync(bogus, "not a database");
    expect(() => readZoteroSqlite({ path: bogus })).toThrow(/could not be read|does not look like/);
    const other = join(tmp(), "other.sqlite");
    new ZoteroFixture(join(tmp(), "x")).close();
    copyFileSync(join(sample(), "zotero.sqlite"), other);
    expect(readZoteroSqlite({ path: other }).items.length).toBeGreaterThan(0);
  });

  it("resolves linked files against the base directory", async () => {
    const dir = tmp();
    const z = new ZoteroFixture(dir);
    z.addItem({ key: "PARENT01", type: "book", fields: { title: "Linked" } });
    z.addAttachment("LINKED01", {
      parent: "PARENT01",
      linkMode: "linked_file",
      path: "attachments:papers/linked.pdf",
    });
    z.close();
    const base = tmp();
    const none = await load(dir);
    expect(none.items[0]?.attachments[0]?.missing).toMatch(/base directory/);
    writeFileSync(join(base, "linked.pdf"), "x");
    const nested = join(base, "papers");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "linked.pdf"), "%PDF-1.4");
    const found = await load(dir, { linkedFilesBase: base });
    expect(found.items[0]?.attachments[0]?.path).toBe(join(nested, "linked.pdf"));
  });
});

describe("date and extra parsing", () => {
  it("reads Zotero's SQL date form, parsed dates and free text", () => {
    expect(zoteroDateParts("1984-03-00 March 1984")).toEqual([1984, 3]);
    expect(zoteroDateParts("2017-06-12 June 12, 2017")).toEqual([2017, 6, 12]);
    expect(zoteroDateParts("1997-00-00 1997")).toEqual([1997]);
    expect(zoteroDateParts("March 2020")).toEqual([2020, 3]);
    expect(zoteroDateParts("12 Mar 2020")).toEqual([2020, 3, 12]);
    expect(zoteroDateParts("c. 1850")).toEqual([1850]);
    expect(zoteroDateParts("March 4, 2021", "2021-03-04")).toEqual([2021, 3, 4]);
    expect(zoteroDateParts("no date")).toBeUndefined();
    expect(zoteroDateParts(undefined)).toBeUndefined();
  });

  it("takes known lines out of extra and keeps the rest", () => {
    const e = parseExtra(
      "Citation Key: smith2020\nPMCID: PMC123\nDOI: https://doi.org/10.1/x\narXiv: arXiv:1706.03762\nfree text\nTitle: kept",
    );
    expect(e).toMatchObject({
      citationKey: "smith2020",
      pmcid: "PMC123",
      doi: "10.1/x",
      arxiv: "1706.03762",
      rest: "free text\nTitle: kept",
    });
    expect(parseExtra(undefined).rest).toBe("");
  });
});

describe("annotation to card", () => {
  const base = {
    ref: "A1",
    type: "highlight" as const,
    text: "  Quoted text.\r\nSecond line.  ",
    comment: " my thought ",
    pageLabel: "iv",
    position: JSON.stringify({
      pageIndex: 3,
      rects: [
        [1, 2, 3, 4],
        [5, 6, 7, 8],
      ],
      nextPageRects: [[9, 9, 9, 9]],
    }),
    tags: ["x"],
  };

  it("keeps the verbatim quote, the comment, the page label and the rectangles", () => {
    const r = annotationToCard(base);
    expect(r).toEqual({
      card: {
        ref: "A1",
        quote: "Quoted text.\nSecond line.",
        ownWords: "my thought",
        page: 3,
        quads: [
          [1, 2, 3, 4],
          [5, 6, 7, 8],
        ],
        pageLabel: "iv",
        tags: ["x"],
      },
    });
  });

  it("converts underlines and leaves out the comment when there is none", () => {
    const r = annotationToCard({ ...base, type: "underline", comment: "" });
    expect("card" in r && r.card.ownWords).toBeUndefined();
  });

  it("skips what has no verbatim quote or no PDF position", () => {
    const skipCode = (a: Parameters<typeof annotationToCard>[0]) => {
      const r = annotationToCard(a);
      return "skip" in r ? r.skip.code : "card";
    };
    expect(skipCode({ ...base, type: "image" })).toBe("ANNOTATION_TYPE_UNSUPPORTED");
    expect(skipCode({ ...base, type: "ink" })).toBe("ANNOTATION_TYPE_UNSUPPORTED");
    expect(skipCode({ ...base, type: "note" })).toBe("ANNOTATION_TYPE_UNSUPPORTED");
    expect(skipCode({ ...base, text: "  " })).toBe("ANNOTATION_NO_TEXT");
    expect(skipCode({ ...base, position: "{}" })).toBe("ANNOTATION_POSITION_UNSUPPORTED");
    expect(
      skipCode({
        ...base,
        position: JSON.stringify({ type: "FragmentSelector", value: "epubcfi(/6/4)" }),
      }),
    ).toBe("ANNOTATION_POSITION_UNSUPPORTED");
  });

  it("validates positions", () => {
    expect(parsePdfPosition("not json")).toBeUndefined();
    expect(
      parsePdfPosition(JSON.stringify({ pageIndex: -1, rects: [[1, 2, 3, 4]] })),
    ).toBeUndefined();
    expect(parsePdfPosition(JSON.stringify({ pageIndex: 0, rects: [[1, 2, 3]] }))).toBeUndefined();
    expect(
      parsePdfPosition(
        JSON.stringify({
          pageIndex: 0,
          rects: [
            [1, 2, 3, 4],
            ["a", 2, 3, 4],
          ],
        }),
      ),
    ).toEqual({
      page: 0,
      quads: [[1, 2, 3, 4]],
    });
  });
});
