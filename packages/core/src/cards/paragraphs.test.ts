import { readFileSync } from "node:fs";
import { AiRouter, MockBackend } from "@citegeist/ai";
import { Registry } from "@citegeist/ops";
import { afterEach, describe, expect, it } from "vitest";
import { documentAssets } from "../assets.js";
import { Library } from "../library.js";
import { bindCoreOperations } from "../ops.js";
import {
  cardData,
  cleanTmpDirs,
  itemData,
  itemFile,
  STAMP,
  tmpDir,
  writeRaw,
} from "../test-helpers.js";
import { bindCardOperations } from "./ops.js";

const CITEKEY = "williams2013manifesto";
const WEB = "a1b2c3d4e5f6";
const PDF = "3f9a1c2e7b4d";

const P1 = "Wir stehen am Anfang einer neuen Debatte ueber Technologie und Arbeit.";
const P2 = "Die Linke hat die Zukunft den Plattformkonzernen ueberlassen und sich zurueckgezogen.";
const P3 = "Eine Politik der Beschleunigung greift die Werkzeuge des Kapitalismus auf.";
const ITEM = "Dritter Punkt in einer Liste von Forderungen.";

const web = [
  { id: "btitle01", type: "title", text: "Manifest" },
  { id: "bhead001", type: "heading", text: "Einleitung" },
  { id: "bpara001", type: "paragraph", text: P1 },
  { id: "bpara002", type: "paragraph", text: P2 },
  { id: "bhead002", type: "heading", text: "Forderungen" },
  { id: "btable01", type: "table", text: "A B C" },
  { id: "bpara003", type: "paragraph", text: P3 },
  { id: "blist001", type: "list-item", text: ITEM },
  { id: "bnote001", type: "footnote", flow: "notes", text: "Eine Fussnote steht hier." },
].map((b) => ({
  flow: "body",
  spans: [{ page: 0, label: null, start: 0, end: b.text.length }],
  src: { engine: "test" },
  ...b,
}));

const webPages = {
  source: WEB,
  confirmed: false,
  pages: [
    {
      index: 0,
      label: null,
      labelSource: "none",
      width: 612,
      height: 792,
      rotation: 0,
      textSource: "html",
      labelConfidence: 0,
    },
  ],
};

const open: Library[] = [];
afterEach(async () => {
  for (const l of open.splice(0)) await l.close();
  cleanTmpDirs();
});

async function setup(kind: "web" | "pdf" = "web") {
  const lib = await Library.init(tmpDir("cg-para-"), { watch: false, localBase: tmpDir("cg-l-") });
  open.push(lib);
  const hash = kind === "web" ? WEB : PDF;
  const item = itemData(CITEKEY, {
    sources: [{ hash, kind, filename: kind === "web" ? "page.html" : "m.pdf", added: STAMP }],
  });
  writeRaw(lib.root, `items/${CITEKEY}/${CITEKEY}.md`, itemFile(item));
  const dir = `items/${CITEKEY}/derived/${hash}`;
  writeRaw(lib.root, `${dir}/blocks.jsonl`, `${web.map((b) => JSON.stringify(b)).join("\n")}\n`);
  writeRaw(
    lib.root,
    `${dir}/pages.json`,
    JSON.stringify(
      kind === "web"
        ? webPages
        : {
            ...webPages,
            source: PDF,
            pages: [{ ...webPages.pages[0], textSource: "born-digital" }],
          },
    ),
  );
  writeRaw(
    lib.root,
    `${dir}/manifest.json`,
    JSON.stringify({
      source: hash,
      path: kind === "web" ? "web" : "digital",
      tools: {},
      createdAt: "2026-10-23T10:00:00.000Z",
      durationMs: 1,
      flags: kind === "web" ? ["no-pages"] : [],
    }),
  );
  lib.sync();
  const ai = new AiRouter([new MockBackend({})], { routing: { "*": "mock" } });
  const reg = bindCardOperations(bindCoreOperations(new Registry(), lib), lib, { ai });
  return { lib, cards: reg.cards, hash, dir };
}

describe("cards of an unpaginated source", () => {
  it("gets the paragraph number of the selected block, counted without headings", async () => {
    const { cards } = await setup();
    const { card } = cards.create("human", {
      citekey: CITEKEY,
      anchor: { text: { exact: "Politik der Beschleunigung" } },
      quote: "Politik der Beschleunigung",
      ai: false,
    });
    expect(card.frontmatter.locator).toEqual({
      label: "paragraph",
      start: "3",
      confirmed: true,
    });
    expect(card.frontmatter.anchor.text?.block).toBe("bpara003");
  });

  it("counts list items and gives a quote across blocks a range", async () => {
    const { cards } = await setup();
    const exact = `${P3} ${ITEM}`;
    const { card } = cards.create("human", {
      citekey: CITEKEY,
      anchor: { text: { exact } },
      quote: exact,
      ai: false,
    });
    expect(card.frontmatter.locator).toMatchObject({ label: "paragraph", start: "3", end: "4" });
  });

  it("gives a card of a PDF source a page locator as before", async () => {
    const { cards } = await setup("pdf");
    // the one page has no printed label, so there is no locator and above all no paragraph
    const { card } = cards.create("human", {
      citekey: CITEKEY,
      anchor: { text: { exact: "Politik der Beschleunigung" } },
      quote: "Politik der Beschleunigung",
      ai: false,
    });
    expect(card.frontmatter.locator).toBeUndefined();
  });
});

describe("migration on read", () => {
  async function legacyCard(locator: Record<string, unknown> | undefined) {
    const ctx = await setup();
    const { fm, body } = cardData(CITEKEY, P2, {
      source: WEB,
      ...(locator ? { locator } : {}),
      anchor: { text: { exact: P2, prefix: "", suffix: "", block: "bpara002" } },
    });
    ctx.lib.writeCard(fm, body);
    return { ...ctx, id: fm.id, rel: `items/${CITEKEY}/cards/${fm.id}.md` };
  }

  it("shows the paragraph for a web card that says page 1, and leaves the file alone", async () => {
    const { lib, cards, id, rel } = await legacyCard({
      label: "page",
      start: "1",
      confirmed: true,
    });
    const before = readFileSync(lib.paths.abs(rel), "utf8");
    expect(cards.getCard(id).frontmatter.locator).toEqual({
      label: "paragraph",
      start: "2",
      confirmed: true,
    });
    expect(
      lib.listCards({ citekey: CITEKEY, limit: 10 }).cards[0]?.frontmatter.locator,
    ).toMatchObject({
      label: "paragraph",
      start: "2",
    });
    expect(readFileSync(lib.paths.abs(rel), "utf8")).toBe(before);
    expect(before).toContain("label: page");
  });

  it("also fills a web card that has no locator", async () => {
    const { cards, id } = await legacyCard(undefined);
    expect(cards.getCard(id).frontmatter.locator).toMatchObject({ label: "paragraph", start: "2" });
  });

  it("keeps a page typed by a person", async () => {
    const { cards, id } = await legacyCard({ label: "page", start: "12", confirmed: true });
    expect(cards.getCard(id).frontmatter.locator).toMatchObject({ label: "page", start: "12" });
  });

  it("writes the paragraph when the card is saved", async () => {
    const { lib, cards, id, rel } = await legacyCard({
      label: "page",
      start: "1",
      confirmed: false,
    });
    cards.update("human", { id, patch: { note: "Wichtig." } });
    const saved = readFileSync(lib.paths.abs(rel), "utf8");
    expect(saved).toContain("label: paragraph");
    expect(saved).not.toContain("label: page");
  });

  it("does not rewrite the locator of a paginated source", async () => {
    const ctx = await setup("pdf");
    const { fm, body } = cardData(CITEKEY, P2, {
      source: PDF,
      locator: { label: "page", start: "1", confirmed: false },
      anchor: { text: { exact: P2, prefix: "", suffix: "", block: "bpara002" } },
    });
    ctx.lib.writeCard(fm, body);
    expect(ctx.cards.getCard(fm.id).frontmatter.locator).toMatchObject({
      label: "page",
      start: "1",
    });
  });
});

describe("cards.export with a paragraph locator", () => {
  it("cites the paragraph in the style of the library", async () => {
    const { cards } = await setup();
    const { card } = cards.create("human", {
      citekey: CITEKEY,
      anchor: { text: { exact: P2 } },
      quote: P2,
      ai: false,
    });
    const id = card.frontmatter.id;
    const de = cards.export({ ids: [id], mode: "direct", format: "text" }).text;
    expect(de).toContain("Abs. 2");
    expect(de).not.toContain("S. ");
    expect(cards.export({ ids: [id], mode: "direct", format: "pandoc" }).text).toContain(
      `@${CITEKEY}, Abs. 2`,
    );
  });
});

describe("documents.assets", () => {
  it("reports a web source as not paginated and a PDF as paginated", async () => {
    const w = await setup();
    expect(documentAssets(w.lib, { citekey: CITEKEY }).paginated).toBe(false);
    const p = await setup("pdf");
    expect(documentAssets(p.lib, { citekey: CITEKEY }).paginated).toBe(true);
  });
});
