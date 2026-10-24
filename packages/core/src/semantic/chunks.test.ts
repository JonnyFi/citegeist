import { createFakeEmbedder } from "@citegeist/embed";
import { afterEach, describe, expect, it } from "vitest";
import { Library } from "../library.js";
import { cleanTmpDirs, itemData, noteData, noteFile, tmpDir, writeRaw } from "../test-helpers.js";
import { collectChunks } from "./chunks.js";
import { HeadingTracker } from "./heading-path.js";
import { SemanticSearch } from "./hybrid.js";

const libs: Library[] = [];
afterEach(async () => {
  for (const l of libs.splice(0)) await l.close();
  cleanTmpDirs();
});

const block = (id: string, type: string, sec: string | undefined, text: string) =>
  JSON.stringify({
    id,
    type,
    ...(sec ? { sec } : {}),
    flow: "body",
    text,
    spans: [{ page: 0, label: "1", start: 0, end: text.length }],
    src: { engine: "docling" },
  });

const PARAGRAPH = "A sentence long enough to be embedded as a chunk of its own.";

describe("HeadingTracker", () => {
  it("nests by the printed number and drops closed sections", () => {
    const t = new HeadingTracker();
    const path = (type: string, sec: string | null, text: string) => t.next({ type, sec, text });
    expect(path("paragraph", null, "Before any heading")).toBe("");
    expect(path("heading", "1", "1 Introduction")).toBe("1 Introduction");
    expect(path("heading", "2", "3 Processing pipeline")).toBe("3 Processing pipeline");
    expect(path("heading", "3", "3.2 AI models")).toBe("3 Processing pipeline > 3.2 AI models");
    expect(path("paragraph", "3", "text")).toBe("3 Processing pipeline > 3.2 AI models");
    expect(path("heading", "4", "6 Conclusion")).toBe("6 Conclusion");
  });

  it("puts an unnumbered heading under a numbered subsection, not under a top-level one", () => {
    const t = new HeadingTracker();
    const path = (text: string) => t.next({ type: "heading", sec: "9", text });
    path("3 Processing pipeline");
    path("3.2 AI models");
    expect(path("Layout Analysis Model")).toBe(
      "3 Processing pipeline > 3.2 AI models > Layout Analysis Model",
    );
    path("6 Conclusion");
    expect(path("Acknowledgements")).toBe("Acknowledgements");
  });

  it("falls back to the outline number when the headings carry no printed number", () => {
    const t = new HeadingTracker();
    const path = (sec: string, text: string) => t.next({ type: "heading", sec, text });
    path("1", "Einleitung");
    expect(path("1.1", "Hintergrund")).toBe("Einleitung > Hintergrund");
    expect(path("2", "Methode")).toBe("Methode");
  });
});

async function libraryWithDocument(
  headingTwo = "Methods and materials used here",
): Promise<Library> {
  const lib = await Library.init(tmpDir("cg-chunks-"), {
    watch: false,
    localBase: tmpDir("cg-chunks-local-"),
  });
  libs.push(lib);
  lib.writeItem(itemData("aaaa", { title: "Das Buch" }), "");
  writeBlocks(lib, headingTwo);
  writeRaw(
    lib.root,
    "notes/n.md",
    noteFile(noteData("Eine Notiz"), "Der Text einer Notiz über Wagen."),
  );
  lib.sync();
  return lib;
}

function writeBlocks(lib: Library, headingTwo: string): void {
  lib.writeFile(
    "items/aaaa/derived/3f9a1c2e7b4d/blocks.jsonl",
    `${[
      block("b0000001", "heading", "1", "1 Introduction and motivation"),
      block("b0000002", "paragraph", "1", `${PARAGRAPH} Introduction.`),
      block("b0000003", "heading", "2", `2 ${headingTwo}`),
      block("b0000004", "paragraph", "2", `${PARAGRAPH} Methods one.`),
      block("b0000005", "paragraph", "2", `${PARAGRAPH} Methods two.`),
    ].join("\n")}\n`,
  );
}

describe("collectChunks", () => {
  it("embeds a block together with the headings above it", async () => {
    const lib = await libraryWithDocument();
    const chunks = collectChunks(lib.index, "m");
    const input = (ref: string) => chunks.find((c) => c.ref.endsWith(ref))?.input;
    expect(input("b0000002")).toBe(`1 Introduction and motivation\n${PARAGRAPH} Introduction.`);
    expect(input("b0000005")).toBe(`2 Methods and materials used here\n${PARAGRAPH} Methods two.`);
  });

  it("does not repeat a heading in front of itself and leaves notes as they were", async () => {
    const lib = await libraryWithDocument();
    const chunks = collectChunks(lib.index, "m");
    const heading = chunks.find((c) => c.ref.endsWith("b0000003"));
    expect(heading?.input).toBe("2 Methods and materials used here");
    const note = chunks.find((c) => c.kind === "note");
    expect(note?.input.startsWith("Eine Notiz\n")).toBe(true);
  });

  it("changes the hash of the chunks under a renamed heading and of no others", async () => {
    const lib = await libraryWithDocument("Methods and materials used here");
    const before = new Map(collectChunks(lib.index, "m").map((c) => [c.ref + c.kind, c.hash]));
    writeBlocks(lib, "Materials, methods and sampling");
    const after = collectChunks(lib.index, "m");
    const changed = after.filter((c) => before.get(c.ref + c.kind) !== c.hash).map((c) => c.ref);
    expect(changed.sort()).toEqual(
      ["3f9a1c2e7b4d:b0000003", "3f9a1c2e7b4d:b0000004", "3f9a1c2e7b4d:b0000005"].sort(),
    );
  });

  it("embeds again only the chunks whose input changed", async () => {
    const lib = await libraryWithDocument("Methods and materials used here");
    const embedder = createFakeEmbedder();
    const sem = new SemanticSearch(lib.index, embedder);
    const first = await sem.sync();
    expect(first.embedded).toBe(first.chunks);
    expect((await sem.sync()).embedded).toBe(0);
    writeBlocks(lib, "Materials, methods and sampling");
    const again = await sem.sync();
    // The renamed heading and the two paragraphs under it; the note and the first section stay.
    expect(again.embedded).toBe(3);
    expect(again.rebuilt).toBe(false);
  });
});
