import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mapZoteroItem, parseZoteroDate, type ZoteroItem, zoteroTags } from "./zotero.js";

function fixtureItem(name: string): ZoteroItem {
  const raw = readFileSync(join(import.meta.dirname, "fixtures", `${name}.json`), "utf8");
  return (JSON.parse(raw) as { body: { items: ZoteroItem[] } }).body.items[0] as ZoteroItem;
}

describe("parseZoteroDate", () => {
  it.each([
    ["2020-09-16", "2020-09-16"],
    ["2020-09", "2020-09"],
    ["2020", "2020"],
    ["2019-03-05 March 5, 2019", "2019-03-05"],
    ["March 5, 2019", "2019-03-05"],
    ["5 March 2019", "2019-03-05"],
    ["5. März 1984", "1984-03-05"],
    ["Sept. 2001", "2001-09"],
    ["Spring 2018", "2018"],
    ["circa 1999?", "1999"],
    ["undated", undefined],
    ["", undefined],
    [undefined, undefined],
  ])("%j becomes %j", (input, expected) => {
    expect(parseZoteroDate(input)).toBe(expected);
  });
});

describe("mapZoteroItem", () => {
  it("maps a journal article to a BibLaTeX article with identifiers", () => {
    const mapped = mapZoteroItem(fixtureItem("save-items-journal-article"));
    expect(mapped.bibtex).toMatch(/^@article\{harris2020,/);
    expect(mapped.bibtex).toContain("title = {Array programming with NumPy},");
    expect(mapped.bibtex).toContain("author = {Harris, Charles R. and Millman, K. Jarrod},");
    expect(mapped.bibtex).toContain("date = {2020-09-16},");
    expect(mapped.bibtex).toContain("journaltitle = {Nature},");
    expect(mapped.bibtex).toContain("volume = {585},");
    expect(mapped.bibtex).toContain("number = {7825},");
    expect(mapped.bibtex).toContain("pages = {357--362},");
    expect(mapped.bibtex).toContain("doi = {10.1038/s41586-020-2649-2},");
    expect(mapped.bibtex).toContain("issn = {1476-4687},");
    expect(mapped.bibtex).toContain("url = {https://www.nature.com/articles/s41586-020-2649-2},");
    expect(mapped.title).toBe("Array programming with NumPy");
    expect(mapped.tags).toEqual(["Computational science", "Software"]);
  });

  it("escapes LaTeX specials, keeps an institutional editor whole and reads a German date", () => {
    const mapped = mapZoteroItem(fixtureItem("save-items-book"));
    expect(mapped.bibtex).toMatch(/^@book\{luhmann1984,/);
    expect(mapped.bibtex).toContain(
      "title = {Soziale Systeme \\& ihre Grenzen: 100\\% Theorie\\_Praxis},",
    );
    expect(mapped.bibtex).toContain("editor = {{Deutsche Gesellschaft für Soziologie}},");
    expect(mapped.bibtex).toContain("date = {1984-03-05},");
    expect(mapped.bibtex).toContain("location = {Frankfurt am Main},");
    expect(mapped.bibtex).toContain("isbn = {978-3-518-28266-3},");
    expect(mapped.bibtex).toContain("pagetotal = {674},");
    expect(mapped.tags).toEqual([]);
  });

  it("falls back to the URL, then to a placeholder, when the item has no title", () => {
    expect(mapZoteroItem({ itemType: "webpage", url: "https://example.org/x" }).title).toBe(
      "https://example.org/x",
    );
    expect(mapZoteroItem({}).title).toBe("Untitled");
  });

  it("maps types: conference paper to inproceedings with booktitle, thesis, web page", () => {
    const paper = mapZoteroItem({
      itemType: "conferencePaper",
      title: "Attention",
      proceedingsTitle: "NeurIPS 2017",
      conferenceName: "NeurIPS",
    }).bibtex;
    expect(paper).toMatch(/^@inproceedings\{/);
    expect(paper).toContain("booktitle = {NeurIPS 2017},");
    expect(paper).toContain("eventtitle = {NeurIPS},");

    const thesis = mapZoteroItem({
      itemType: "thesis",
      title: "On things",
      university: "TU Wien",
      thesisType: "PhD thesis",
    }).bibtex;
    expect(thesis).toMatch(/^@thesis\{/);
    expect(thesis).toContain("publisher = {TU Wien},");
    expect(thesis).toContain("type = {PhD thesis},");

    const page = mapZoteroItem({
      itemType: "webpage",
      title: "A post",
      websiteTitle: "Example Blog",
      accessDate: "2026-10-24 09:12:00",
    }).bibtex;
    expect(page).toMatch(/^@online\{/);
    expect(page).toContain("journaltitle = {Example Blog},");
    expect(page).toContain("urldate = {2026-10-24},");
  });

  it("reads an arXiv id from the extra field", () => {
    const bib = mapZoteroItem({
      itemType: "preprint",
      title: "Attention is all you need",
      extra: "arXiv:1706.03762 [cs]",
    }).bibtex;
    expect(bib).toContain("eprint = {1706.03762},");
    expect(bib).toContain("eprinttype = {arXiv},");
  });

  it("never lets a quote or brace in a value break the entry", () => {
    const bib = mapZoteroItem({ itemType: "book", title: "A {broken} \\ title ~ ^" }).bibtex;
    expect(bib).toContain(
      "title = {A \\{broken\\} \\textbackslash{} title \\textasciitilde{} \\textasciicircum{}},",
    );
  });
});

describe("zoteroTags", () => {
  it("accepts strings and tag objects and drops empty and repeated ones", () => {
    expect(zoteroTags({ tags: ["a", { tag: "b", type: 1 }, "", { tag: " " }, "a"] })).toEqual([
      "a",
      "b",
    ]);
  });
});
