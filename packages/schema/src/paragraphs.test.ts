import { describe, expect, it } from "vitest";
import { isUnpaginated, paragraphLocator, paragraphNumbers } from "./index.js";

const b = (id: string, type: string, flow = "body") =>
  ({ id, type, flow }) as Parameters<typeof paragraphNumbers>[0][number];

const page = (label: string | null, textSource: "html" | "born-digital" = "html") => ({
  index: 0,
  label,
  labelSource: "none" as const,
  width: 612,
  height: 792,
  rotation: 0 as const,
  textSource,
});

describe("paragraphNumbers", () => {
  it("counts text blocks from 1 in reading order and skips headings and the rest", () => {
    const n = paragraphNumbers([
      b("t", "title"),
      b("h1", "heading"),
      b("p1", "paragraph"),
      b("p2", "paragraph"),
      b("h2", "heading"),
      b("tab", "table"),
      b("fig", "figure"),
      b("cap", "caption"),
      b("eq", "equation"),
      b("code", "code"),
      b("l1", "list-item"),
      b("q1", "quote"),
      b("fn", "footnote", "notes"),
      b("ref", "reference"),
      b("furn", "page-furniture", "furniture"),
      b("p3", "paragraph"),
    ]);
    expect([...n]).toEqual([
      ["p1", 1],
      ["p2", 2],
      ["l1", 3],
      ["q1", 4],
      ["p3", 5],
    ]);
  });

  it("does not count a paragraph in the notes flow", () => {
    expect(paragraphNumbers([b("n", "paragraph", "notes"), b("p", "paragraph")]).get("p")).toBe(1);
  });
});

describe("paragraphLocator", () => {
  const numbers = new Map([
    ["a", 3],
    ["b", 4],
  ]);
  it("names one paragraph", () => {
    expect(paragraphLocator(numbers, ["a"])).toEqual({
      label: "paragraph",
      start: "3",
      confirmed: true,
    });
  });
  it("names the range of several paragraphs and ignores uncounted blocks", () => {
    expect(paragraphLocator(numbers, ["heading", "a", "b"])).toMatchObject({
      start: "3",
      end: "4",
    });
  });
  it("is undefined when no block is a paragraph", () => {
    expect(paragraphLocator(numbers, ["heading"])).toBeUndefined();
  });
});

describe("isUnpaginated", () => {
  it("is false for a PDF", () => {
    expect(isUnpaginated({ kind: "pdf", manifest: { path: "digital", flags: [] } })).toBe(false);
  });
  it("is true for web, HTML and EPUB sources", () => {
    for (const kind of ["web", "html", "epub"]) expect(isUnpaginated({ kind })).toBe(true);
  });
  it("is true for a conversion that flags missing pages", () => {
    expect(
      isUnpaginated({
        kind: "arxiv-html",
        manifest: { path: "arxiv", flags: ["no-pdf-for-page-mapping"] },
      }),
    ).toBe(true);
  });
  it("is false for arXiv HTML that was mapped to its PDF pages", () => {
    expect(
      isUnpaginated({
        kind: "arxiv-html",
        manifest: { path: "arxiv", flags: [] },
        pages: { pages: [page("1"), page("2")] },
      }),
    ).toBe(false);
  });
  it("falls back to the placeholder page when nothing else is known", () => {
    expect(isUnpaginated({ pages: { pages: [page(null)] } })).toBe(true);
    expect(isUnpaginated({ pages: { pages: [page(null, "born-digital")] } })).toBe(false);
    expect(isUnpaginated({})).toBe(false);
  });
});
