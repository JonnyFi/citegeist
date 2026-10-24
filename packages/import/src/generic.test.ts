import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { bundleFromFile, extractBibFiles, matchPdfs } from "./generic.js";
import { tinyPdf } from "./testing/zotero-fixture.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "cg-generic-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const refs = (b: { items: { ref: string }[] }) => b.items.map((i) => i.ref);

describe("BibTeX", () => {
  it("reads BibTeX and BibLaTeX entries into drafts and reports the ones it cannot read", async () => {
    const bundle = await bundleFromFile(
      { kind: "bibtex", path: join(FIXTURES, "sample.bib") },
      { attachments: false },
    );
    expect(bundle.tag).toBe("bibtex");
    expect(bundle.label).toBe("BibTeX (sample.bib)");
    expect(refs(bundle)).toEqual([
      "luhmann1984social",
      "Smith2020Deep",
      "mueller2015grundlagen",
      "Doe_2019",
      "doe2019study",
    ]);
    // The entry without a title is reported and left out.
    expect(bundle.problems.some((p) => p.code === "BIBTEX_ENTRY_INVALID")).toBe(true);
    const first = bundle.items[0]?.draft;
    expect(first).toMatchObject({
      type: "article-journal",
      title: "Social Systems and Their Environment",
      issued: 1984,
      DOI: "10.1000/xyz123",
      page: "31-45",
      tags: ["systems theory", "sociology"],
    });
    expect(bundle.items[1]?.draft.issued).toBe("2020-05-01");
    expect(bundle.items[2]?.draft).toMatchObject({
      ISBN: "978-3-16-148410-0",
      "publisher-place": "Wien",
    });
  });

  it("finds PDFs in the file field of an entry, relative to the .bib file", async () => {
    const dir = tmp();
    copyFileSync(join(FIXTURES, "sample.bib"), join(dir, "sample.bib"));
    mkdirSync(join(dir, "files"));
    writeFileSync(join(dir, "files", "Smith2020.pdf"), tinyPdf("smith"));
    const bundle = await bundleFromFile(
      { kind: "bibtex", path: join(dir, "sample.bib") },
      { attachments: true },
    );
    const smith = bundle.items.find((i) => i.ref === "Smith2020Deep");
    expect(smith?.attachments.map((a) => a.path)).toEqual([join(dir, "files", "Smith2020.pdf")]);
    // The snapshot is listed but not on disk: reported, not fatal.
    expect(
      bundle.problems.some(
        (p) => p.code === "ATTACHMENT_FILE_MISSING" && p.ref === "Smith2020Deep",
      ),
    ).toBe(true);
  });

  it("parses the formats of the file field", () => {
    const text = [
      "@article{a, file = {Full Text:/abs/a.pdf:application/pdf}}",
      "@article{b, file = {:rel/b.pdf:PDF}}",
      "@article{c, file = {C\\:/Users/x/c.pdf}}",
      "@article{d, title = {none}}",
    ].join("\n");
    const files = extractBibFiles(text);
    expect(files.get("a")).toEqual(["/abs/a.pdf"]);
    expect(files.get("b")).toEqual(["rel/b.pdf"]);
    expect(files.get("c")).toEqual(["C:/Users/x/c.pdf"]);
    expect(files.has("d")).toBe(false);
  });

  it("fails clearly for a missing file and for broken CSL-JSON", async () => {
    await expect(
      bundleFromFile({ kind: "bibtex", path: join(tmp(), "nope.bib") }, { attachments: false }),
    ).rejects.toMatchObject({ detail: { code: "IMPORT_SOURCE_NOT_FOUND" } });
    const bad = join(tmp(), "bad.json");
    writeFileSync(bad, "{ not json");
    await expect(
      bundleFromFile({ kind: "csl-json", path: bad }, { attachments: false }),
    ).rejects.toMatchObject({
      detail: { code: "IMPORT_SOURCE_INVALID" },
    });
  });
});

describe("RIS and CSL-JSON", () => {
  it("reads RIS records, keeping the ID as citekey candidate", async () => {
    const bundle = await bundleFromFile(
      { kind: "ris", path: join(FIXTURES, "sample.ris") },
      { attachments: false },
    );
    expect(bundle.tag).toBe("ris");
    expect(refs(bundle)).toEqual(["Kuhn1962", "#2", "#3"]);
    expect(bundle.items[0]?.draft).toMatchObject({
      type: "article-journal",
      title: "The Structure of Scientific Revolutions",
      DOI: "10.1234/kuhn.1962",
      tags: ["paradigm", "philosophy of science"],
    });
    expect(bundle.items[1]?.draft).toMatchObject({ type: "book", ISBN: "978-0-415-27844-7" });
    // The record without a title is reported and left out.
    expect(bundle.problems.some((p) => p.code === "RIS_RECORD_INVALID")).toBe(true);
  });

  it("reads CSL-JSON items", async () => {
    const bundle = await bundleFromFile(
      { kind: "csl-json", path: join(FIXTURES, "sample.json") },
      { attachments: false },
    );
    expect(bundle.tag).toBe("csl-json");
    expect(refs(bundle)).toEqual(["latour2005reassembling", "Bourdieu1984", "weber1922"]);
    expect(bundle.items[1]?.draft.tags).toEqual(["sociology", "taste"]);
    expect(bundle.items[2]?.draft).toMatchObject({
      type: "chapter",
      issued: "1922-03",
      DOI: "10.9999/weber.1922",
    });
  });
});

describe("PDF folder", () => {
  const drafts = [
    {
      ref: "a",
      draft: {
        type: "book",
        title: "Reassembling the Social: An Introduction",
        citekey: "latour2005reassembling",
      },
    },
    {
      ref: "b",
      draft: {
        type: "article-journal",
        title: "Deep Learning for Everything",
        DOI: "10.5555/deep.2020.7",
      },
    },
    {
      ref: "c",
      draft: {
        type: "article-journal",
        title: "Something About Consensus",
        DOI: "10.7777/consensus",
      },
    },
    { ref: "d", draft: { type: "book", title: "Grundlagen der Wissenschaft" } },
    { ref: "e", draft: { type: "book", title: "Hidden Inside", DOI: "10.8888/hidden" } },
  ] as never[];

  function folder(): { dir: string; files: string[] } {
    const dir = tmp();
    mkdirSync(join(dir, "sub"));
    const names = [
      "latour2005reassembling.pdf",
      "sub/10.5555_deep.2020.7.pdf",
      "Mueller - 2015 - Grundlagen der Wissenschaft.pdf",
      "scan0001.pdf",
      "random.pdf",
    ];
    for (const n of names) writeFileSync(join(dir, n), tinyPdf(n));
    return { dir, files: names.map((n) => join(dir, n)) };
  }

  it("matches by citekey, DOI in the name and title in the name, once per PDF", async () => {
    const { files } = folder();
    const { matches, unmatched } = await matchPdfs(drafts, files, {});
    expect(matches.get("a")).toBe(files[0]);
    expect(matches.get("b")).toBe(files[1]);
    expect(matches.get("d")).toBe(files[2]);
    expect(matches.has("c")).toBe(false);
    expect(unmatched.sort()).toEqual([files[3], files[4]].sort());
  });

  it("asks for the DOI inside a PDF when the name says nothing", async () => {
    const { files } = folder();
    const asked: string[] = [];
    const { matches } = await matchPdfs(drafts, files, {
      pdfDoi: async (p) => {
        asked.push(p);
        return p.endsWith("scan0001.pdf") ? "https://doi.org/10.8888/HIDDEN" : undefined;
      },
    });
    expect(matches.get("e")).toBe(files[3]);
    // Only PDFs that nothing else claimed are opened.
    expect(asked.sort()).toEqual([files[3], files[4]].sort());
  });

  it("attaches the matches to a CSL-JSON import and reports the leftovers", async () => {
    const dir = tmp();
    copyFileSync(join(FIXTURES, "sample.json"), join(dir, "sample.json"));
    const pdfs = join(dir, "pdfs");
    mkdirSync(pdfs);
    writeFileSync(join(pdfs, "latour2005reassembling.pdf"), tinyPdf("l"));
    writeFileSync(join(pdfs, "unrelated.pdf"), tinyPdf("u"));
    const bundle = await bundleFromFile(
      { kind: "csl-json", path: join(dir, "sample.json"), pdfFolder: pdfs },
      { attachments: true },
    );
    expect(bundle.items[0]?.attachments.map((a) => a.filename)).toEqual([
      "latour2005reassembling.pdf",
    ]);
    expect(bundle.items[1]?.attachments).toEqual([]);
    expect(bundle.problems.find((p) => p.code === "PDF_UNMATCHED")?.message).toContain(
      "unrelated.pdf",
    );
    const none = await bundleFromFile(
      { kind: "csl-json", path: join(dir, "sample.json"), pdfFolder: pdfs },
      { attachments: false },
    );
    expect(none.items.every((i) => i.attachments.length === 0)).toBe(true);
  });

  it("reports a PDF folder that does not exist", async () => {
    const bundle = await bundleFromFile(
      { kind: "csl-json", path: join(FIXTURES, "sample.json"), pdfFolder: join(tmp(), "gone") },
      { attachments: true },
    );
    expect(bundle.problems.some((p) => p.code === "PDF_FOLDER_NOT_FOUND")).toBe(true);
  });
});
