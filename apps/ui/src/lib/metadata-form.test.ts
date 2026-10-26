import { ItemFrontmatter } from "@citegeist/schema";
import { describe, expect, it } from "vitest";
import {
  emptyRow,
  formFromItem,
  hasThinMetadata,
  isValidDoi,
  isValidIsbn,
  isValidIsbnList,
  patchFromForm,
  validateForm,
} from "./metadata-form";

const item = (extra: Record<string, unknown> = {}) =>
  ItemFrontmatter.parse({
    id: "01JB8Z3QK7ABCDEFGH",
    citekey: "anonndarray",
    type: "webpage",
    title: "Array programming with NumPy",
    created: { at: "2026-10-23T12:00:00.000Z", by: "human" },
    ...extra,
  });

describe("identifier checks", () => {
  it("accepts a DOI with or without its prefix and refuses text", () => {
    expect(isValidDoi("10.1038/s41586-020-2649-2")).toBe(true);
    expect(isValidDoi("https://doi.org/10.1038/S41586-020-2649-2")).toBe(true);
    expect(isValidDoi("doi:10.1000/x")).toBe(true);
    expect(isValidDoi("10.1038")).toBe(false);
    expect(isValidDoi("not a doi")).toBe(false);
  });

  it("checks the check digit of an ISBN", () => {
    expect(isValidIsbn("978-3-518-58706-5")).toBe(true);
    expect(isValidIsbn("3-518-28266-2")).toBe(true);
    expect(isValidIsbn("0-7432-0304-6")).toBe(true);
    expect(isValidIsbn("978-3-518-58706-4")).toBe(false);
    expect(isValidIsbn("12345")).toBe(false);
    expect(isValidIsbnList("978-3-518-58706-5, 0-7432-0304-6")).toBe(true);
    expect(isValidIsbnList("978-3-518-58706-5, 12")).toBe(false);
  });
});

describe("validateForm", () => {
  it("names each problem with its own message", () => {
    const form = {
      ...formFromItem(item()),
      title: " ",
      doi: "x",
      isbn: "123",
      url: "ftp://a",
      issued: "20.20",
      language: "Deutsch",
      authors: [{ ...emptyRow(), given: "Anna" }],
    };
    expect(validateForm(form)).toEqual({
      title: "metaform.error.title",
      doi: "metaform.error.doi",
      isbn: "metaform.error.isbn",
      url: "metaform.error.url",
      issued: "metaform.error.issued",
      language: "metaform.error.language",
      authors: "metaform.error.creator",
    });
  });

  it("accepts a year, a month and a day", () => {
    for (const issued of ["2020", "2020-09", "2020-09-16", ""]) {
      expect(validateForm({ ...formFromItem(item()), issued })).toEqual({});
    }
  });
});

describe("patchFromForm", () => {
  it("is empty when nothing changed", () => {
    const fm = item({
      author: [{ family: "Harris", given: "Charles", orcid: "0000-0002-1825-0097" }],
    });
    expect(patchFromForm(formFromItem(fm), fm)).toEqual({});
  });

  it("holds only the changed fields, and null for a field that was emptied", () => {
    const fm = item({ volume: "3", publisher: "Old" });
    const form = {
      ...formFromItem(fm),
      type: "article-journal",
      issued: "2020",
      volume: "",
      doi: "https://doi.org/10.1038/S41586-020-2649-2",
      authors: [
        { ...emptyRow(), family: "Harris", given: "Charles" },
        { ...emptyRow(), family: "Millman" },
        emptyRow(),
      ],
    };
    expect(patchFromForm(form, fm)).toEqual({
      type: "article-journal",
      issued: 2020,
      volume: null,
      DOI: "10.1038/s41586-020-2649-2",
      author: [{ family: "Harris", given: "Charles" }, { family: "Millman" }],
    });
  });

  it("keeps the extra keys of a creator that was not touched", () => {
    const fm = item({
      author: [
        { family: "Harris", given: "Charles", orcid: "0000-0002-1825-0097" },
        { family: "Millman" },
      ],
    });
    const form = formFromItem(fm);
    form.authors[1] = { ...form.authors[1], given: "K. Jarrod" } as never;
    expect(patchFromForm(form, fm).author).toEqual([
      { family: "Harris", given: "Charles", orcid: "0000-0002-1825-0097" },
      { family: "Millman", given: "K. Jarrod" },
    ]);
  });

  it("removes the authors when every row is empty", () => {
    const fm = item({ author: [{ family: "Harris" }] });
    expect(patchFromForm({ ...formFromItem(fm), authors: [emptyRow()] }, fm)).toEqual({
      author: null,
    });
  });
});

describe("hasThinMetadata", () => {
  it("is true without author or without date", () => {
    expect(hasThinMetadata(item())).toBe(true);
    expect(hasThinMetadata(item({ author: [{ family: "A" }] }))).toBe(true);
    expect(hasThinMetadata(item({ issued: 2020 }))).toBe(true);
    expect(hasThinMetadata(item({ author: [{ family: "A" }], issued: 2020 }))).toBe(false);
    expect(hasThinMetadata(item({ editor: [{ family: "A" }], issued: 2020 }))).toBe(false);
  });
});
