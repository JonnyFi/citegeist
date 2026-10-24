import type { ItemDraft } from "@citegeist/cite";
import { describe, expect, it } from "vitest";
import { DuplicateIndex, existingFromDraft } from "./dupes.js";
import type { ExistingItem } from "./types.js";

const lib: ExistingItem[] = [
  {
    citekey: "luhmann1984social",
    title: "Social Systems and Their Environment",
    year: "1984",
    firstAuthor: "Luhmann",
    doi: "10.1000/xyz123",
    ids: {},
  },
  {
    citekey: "mueller2015",
    title: "Grundlagen der Wissenschaft",
    year: "2015",
    firstAuthor: "Müller",
    isbn: "978-3-16-148410-0",
    ids: {},
  },
  {
    citekey: "vaswani2017",
    title: "Attention Is All You Need",
    year: "2017",
    firstAuthor: "Vaswani",
    ids: { arxiv: "1706.03762" },
  },
  { citekey: "fromzotero", title: "Anything", firstAuthor: "Someone", ids: { zotero: "KEY00001" } },
  { citekey: "untitled", title: "Untitled", ids: {} },
];

const draft = (d: Partial<ItemDraft> & { title: string }): ItemDraft =>
  ({ type: "article-journal", ...d }) as ItemDraft;

describe("duplicate detection", () => {
  const index = new DuplicateIndex(lib);

  it("matches by Zotero key first", () => {
    expect(
      index.find(draft({ title: "Completely different", ids: { zotero: "KEY00001" } })),
    ).toEqual({
      citekey: "fromzotero",
      reason: "zotero-key",
    });
  });

  it("matches by DOI, whatever the form", () => {
    for (const doi of ["10.1000/XYZ123", "https://doi.org/10.1000/xyz123", "doi:10.1000/xyz123"]) {
      expect(index.find(draft({ title: "Other title", DOI: doi }))).toEqual({
        citekey: "luhmann1984social",
        reason: "doi",
      });
    }
    expect(index.find(draft({ title: "Other title", DOI: "10.1000/other" }))).toBeUndefined();
  });

  it("matches by ISBN across ISBN-10, ISBN-13 and hyphens", () => {
    expect(index.find(draft({ type: "book", title: "x", ISBN: "9783161484100" }))?.reason).toBe(
      "isbn",
    );
    expect(index.find(draft({ type: "book", title: "x", ISBN: "3-16-148410-X" }))?.citekey).toBe(
      "mueller2015",
    );
    expect(
      index.find(draft({ type: "book", title: "x", ISBN: "978-0-415-27844-7" })),
    ).toBeUndefined();
  });

  it("matches by arXiv id and ignores the version", () => {
    expect(index.find(draft({ title: "x", ids: { arxiv: "arXiv:1706.03762v5" } }))).toEqual({
      citekey: "vaswani2017",
      reason: "arxiv",
    });
  });

  it("matches normalized title, year and first author", () => {
    expect(
      index.find(
        draft({
          title: "social systems and their environment!",
          issued: "1984-03",
          author: [{ family: "Luhmann", given: "N." }],
        }),
      ),
    ).toEqual({ citekey: "luhmann1984social", reason: "title-year-author" });
    expect(
      index.find(
        draft({
          title: "Grundlagen der Wissenschaft",
          issued: 2015,
          author: [{ family: "MULLER" }],
        }),
      )?.citekey,
    ).toBe("mueller2015");
  });

  it("does not match when year or first author differ", () => {
    const base = { title: "Social Systems and Their Environment", author: [{ family: "Luhmann" }] };
    expect(index.find(draft({ ...base, issued: 1985 }))).toBeUndefined();
    expect(
      index.find(draft({ ...base, issued: 1984, author: [{ family: "Habermas" }] })),
    ).toBeUndefined();
    expect(index.find(draft({ title: base.title, issued: 1984 }))).toBeUndefined();
  });

  it("does not let weak titles swallow unrelated entries", () => {
    expect(index.find(draft({ title: "Untitled" }))).toBeUndefined();
    expect(
      index.find(draft({ title: "Untitled", issued: 2000, author: [{ family: "A" }] })),
    ).toBeUndefined();
    expect(index.find(draft({ title: "Social Systems and Their Environment" }))).toBeUndefined();
  });

  it("grows with planned items, so entries of one source find each other", () => {
    const grown = new DuplicateIndex();
    const a = draft({ title: "A study of things", issued: 2019, author: [{ family: "Doe" }] });
    expect(grown.find(a)).toBeUndefined();
    grown.add(existingFromDraft(a, "doe2019"));
    expect(
      grown.find(
        draft({
          title: "A Study of Things.",
          issued: "2019",
          author: [{ family: "Doe", given: "John" }],
        }),
      ),
    ).toEqual({
      citekey: "doe2019",
      reason: "title-year-author",
    });
  });
});
