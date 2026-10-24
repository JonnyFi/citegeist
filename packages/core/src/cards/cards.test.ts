import { readFileSync } from "node:fs";
import { AiRouter, MockBackend } from "@citegeist/ai";
import { exportCards } from "@citegeist/cite";
import { Registry } from "@citegeist/ops";
import type { Actor } from "@citegeist/schema";
import { afterEach, describe, expect, it } from "vitest";
import { quoteSha256 } from "../hash.js";
import { Library } from "../library.js";
import { bindCoreOperations } from "../ops.js";
import { cleanTmpDirs, itemData, itemFile, STAMP, tmpDir, writeRaw } from "../test-helpers.js";
import { bindCardOperations } from "./ops.js";
import type { CardDeps, CardFile } from "./service.js";

const CITEKEY = "luhmann1984soziale";
const HASH = "3f9a1c2e7b4d";
const human = { actor: "human" as Actor };

const B1 =
  "Soziale Systeme sind autopoietische Systeme, die sich selbst reproduzieren. Kommunikation ist ihre Operation.";
const B2 =
  "Die Gesellschaft besteht nicht aus Menschen, sondern aus Kommunikationen. Diese Aussage irritiert viele Leser bis heute.";
const B3 =
  "Beobachtung setzt eine Unterscheidung voraus und bezeichnet eine Seite. Der blinde Fleck der Beobachtung bleibt unsichtbar.";
const B3_SPLIT = B3.indexOf("Der blinde");

const blocks = [
  {
    id: "b1aaaaaa",
    type: "paragraph",
    text: B1,
    spans: [{ page: 0, label: "213", start: 0, end: B1.length }],
  },
  {
    id: "b2aaaaaa",
    type: "paragraph",
    text: B2,
    spans: [{ page: 1, label: "214", start: 0, end: B2.length }],
  },
  {
    id: "b3aaaaaa",
    type: "paragraph",
    text: B3,
    spans: [
      { page: 1, label: "214", start: 0, end: B3_SPLIT },
      { page: 2, label: "215", start: B3_SPLIT, end: B3.length },
    ],
  },
].map((b) => ({ ...b, flow: "body", src: { engine: "test" } }));

const pagesJson = {
  source: HASH,
  confirmed: false,
  pages: [0, 1, 2].map((i) => ({
    index: i,
    label: String(213 + i),
    labelSource: "header-footer",
    width: 595,
    height: 842,
    rotation: 0,
    textSource: "born-digital",
  })),
};

const open: Library[] = [];
afterEach(async () => {
  for (const l of open.splice(0)) await l.close();
  cleanTmpDirs();
});

async function setup(opts: { item?: Record<string, unknown>; deps?: Partial<CardDeps> } = {}) {
  const root = tmpDir("cg-cards-");
  const lib = await Library.init(root, { watch: false, localBase: tmpDir("cg-local-") });
  open.push(lib);
  const item = itemData(CITEKEY, {
    sources: [{ hash: HASH, kind: "pdf", filename: "luhmann.pdf", added: STAMP }],
    ...opts.item,
  });
  writeRaw(lib.root, `items/${CITEKEY}/${CITEKEY}.md`, itemFile(item));
  const dir = `items/${CITEKEY}/derived/${HASH}`;
  writeRaw(lib.root, `${dir}/blocks.jsonl`, `${blocks.map((b) => JSON.stringify(b)).join("\n")}\n`);
  writeRaw(lib.root, `${dir}/pages.json`, JSON.stringify(pagesJson));
  lib.sync();
  const mock = new MockBackend({
    "card.paraphrase": { paraphrase: "Systeme erzeugen sich selbst.", kind: "definition" },
    "card.verify": { faithful: true, issues: [] },
  });
  const ai = new AiRouter([mock], { routing: { "*": "mock" } });
  const reg = bindCardOperations(bindCoreOperations(new Registry(), lib), lib, {
    ai,
    ...opts.deps,
  });
  return { lib, reg, mock, cards: reg.cards };
}

const pdfAnchor = (page: number) => ({
  pdf: { page, quads: [[72, 310.2, 290.1, 330] as [number, number, number, number]], file: HASH },
});

describe("cards.create", () => {
  it("returns within 300 ms without AI, then fills paraphrase and kind", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { reg, mock, cards } = await setup();
    mock.set("card.paraphrase", async () => {
      await gate;
      return { paraphrase: "Systeme erzeugen sich selbst.", kind: "definition" as const };
    });
    const quote = "Kommunikation ist ihre Operation.";
    const t0 = performance.now();
    const out = (await reg.call("cards.create", human, {
      citekey: CITEKEY,
      anchor: { ...pdfAnchor(0), text: { exact: quote } },
      quote,
    })) as { card: CardFile; job?: string };
    expect(performance.now() - t0).toBeLessThan(300);

    expect(out.job).toMatch(/^j_/);
    expect(out.card.body.quote).toBe(quote);
    expect(out.card.body.paraphrase).toBeUndefined();
    expect(out.card.frontmatter.paraphrase).toBeUndefined();
    expect(out.card.frontmatter.kind).toBeUndefined();
    expect(out.card.frontmatter.source).toBe(HASH);
    expect(out.card.frontmatter.locator).toMatchObject({ label: "page", start: "213" });
    expect(out.card.frontmatter.anchor.text?.block).toBe("b1aaaaaa");
    expect(out.card.frontmatter.anchor.pdf?.page).toBe(0);
    expect(out.card.frontmatter.quote_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(mock.calls).toHaveLength(0);

    release();
    await cards.detached?.idle();
    const done = cards.getCard(out.card.frontmatter.id);
    expect(done.body.paraphrase).toBe("Systeme erzeugen sich selbst.");
    expect(done.body.core).toBeUndefined();
    expect(done.frontmatter.kind).toBe("definition");
    expect(done.body.quote).toBe(quote);
    expect(done.frontmatter.paraphrase).toMatchObject({ by: "mock:mock-fast", language: "de" });
    expect(done.frontmatter.core).toBeUndefined();
    // the file on disk is valid for the index: quote hash still matches
    expect(reg.cards.getCard(done.frontmatter.id).frontmatter.quote_sha256).toBe(
      out.card.frontmatter.quote_sha256,
    );
  });

  it("derives block, page and label from a text-only anchor", async () => {
    const { cards } = await setup();
    const quote = "Die Gesellschaft besteht nicht aus Menschen";
    const { card } = cards.create("human", {
      citekey: CITEKEY,
      anchor: { text: { exact: quote } },
      quote,
      ai: false,
    });
    expect(card.frontmatter.anchor.text).toMatchObject({ block: "b2aaaaaa", exact: quote });
    expect(card.frontmatter.locator).toMatchObject({ label: "page", start: "214" });
    expect(card.frontmatter.source).toBe(HASH);
  });

  it("gives a card across a page break a locator range", async () => {
    const { cards } = await setup();
    const quote = "Der blinde Fleck der Beobachtung bleibt unsichtbar.";
    const { card, job } = cards.create("human", {
      citekey: CITEKEY,
      anchor: {
        text: {
          exact:
            "Beobachtung setzt eine Unterscheidung voraus und bezeichnet eine Seite. Der blinde Fleck",
        },
      },
      quote: `Beobachtung setzt eine Unterscheidung voraus und bezeichnet eine Seite. ${quote}`,
      ai: false,
    });
    expect(job).toBeUndefined();
    expect(card.frontmatter.locator).toMatchObject({ start: "214", end: "215" });
  });

  it("rejects anchors that cannot be right", async () => {
    const { cards } = await setup();
    const base = { citekey: CITEKEY, quote: "x y z", ai: false };
    expect(() => cards.create("human", { ...base, anchor: {} })).toThrow(/INVALID_ANCHOR/);
    expect(() =>
      cards.create("human", {
        ...base,
        anchor: { pdf: { ...pdfAnchor(0).pdf, file: "aaaaaaaaaaaa" } },
      }),
    ).toThrow(/INVALID_ANCHOR/);
    expect(() => cards.create("human", { ...base, anchor: pdfAnchor(9) })).toThrow(
      /INVALID_ANCHOR/,
    );
    expect(() =>
      cards.create("human", {
        ...base,
        quote: "dieser Satz steht nirgends im Dokument",
        anchor: { text: { exact: "dieser Satz steht nirgends im Dokument" } },
      }),
    ).toThrow(/ANCHOR_NOT_FOUND/);
    expect(() =>
      cards.create("human", { ...base, citekey: "nope0000", anchor: pdfAnchor(0) }),
    ).toThrow(/ITEM_NOT_FOUND/);
  });
});

describe("language", () => {
  it("follows explicit value, item, project, library default", async () => {
    const { lib, cards, mock } = await setup();
    const quote = "Kommunikation ist ihre Operation.";
    const make = (extra: Record<string, unknown> = {}) =>
      cards.create("human", {
        citekey: CITEKEY,
        anchor: pdfAnchor(0),
        quote,
        ...extra,
      });
    const lastLang = async () => {
      await cards.detached?.idle();
      return mock.calls[mock.calls.length - 1]?.language;
    };

    make();
    expect(await lastLang()).toBe("de"); // library default

    lib.createProject("human", { slug: "phd", title: "PhD", brief: "" });
    lib.updateProject({ slug: "phd", patch: { ai_language: "fr" } });
    make({ projects: ["phd"] });
    expect(await lastLang()).toBe("fr"); // project
  });

  it("lets the item setting beat the project and an explicit value beat both", async () => {
    const { lib, cards, mock } = await setup({ item: { ai_language: "es", projects: ["phd"] } });
    lib.createProject("human", { slug: "phd", title: "PhD", brief: "" });
    lib.updateProject({ slug: "phd", patch: { ai_language: "fr" } });
    const quote = "Kommunikation ist ihre Operation.";
    cards.create("human", { citekey: CITEKEY, anchor: pdfAnchor(0), quote });
    await cards.detached?.idle();
    expect(mock.calls.at(-1)?.language).toBe("es");
    cards.create("human", { citekey: CITEKEY, anchor: pdfAnchor(0), quote, language: "en" });
    await cards.detached?.idle();
    expect(mock.calls.at(-1)?.language).toBe("en");
    expect(mock.calls.at(-1)?.prompt).toContain(quote);
  });

  it("regenerates in another language and keeps the note and a kind the reader set", async () => {
    const { reg, cards, mock } = await setup();
    const quote = "Kommunikation ist ihre Operation.";
    const { card } = cards.create("human", { citekey: CITEKEY, anchor: pdfAnchor(0), quote });
    await cards.detached?.idle();
    const id = card.frontmatter.id;
    await reg.call("cards.update", human, {
      id,
      patch: { note: "Meine Worte", kind: "critique" },
    });
    mock.set("card.paraphrase", { paraphrase: "Systems create themselves.", kind: "thesis" });
    const r = (await reg.call("cards.regenerate", human, { id, language: "en" })) as {
      job: string;
    };
    expect(r.job).toMatch(/^j_/);
    await cards.detached?.idle();
    const after = cards.getCard(id);
    expect(after.body).toMatchObject({
      quote,
      paraphrase: "Systems create themselves.",
      note: "Meine Worte",
    });
    expect(after.frontmatter.kind).toBe("critique");
    expect(after.frontmatter.paraphrase?.language).toBe("en");
    expect(mock.calls.at(-1)?.language).toBe("en");
  });
});

describe("card.verify", () => {
  it("sets paraphrase.checked from the verdict", async () => {
    const { cards, mock } = await setup({ deps: { verify: true } });
    mock.set("card.verify", { faithful: false, issues: [{ kind: "added", detail: "invented" }] });
    const { card } = cards.create("human", {
      citekey: CITEKEY,
      anchor: pdfAnchor(0),
      quote: "Kommunikation ist ihre Operation.",
    });
    await cards.detached?.idle();
    expect(cards.getCard(card.frontmatter.id).frontmatter.paraphrase?.checked).toBe(false);
    mock.set("card.verify", { faithful: true, issues: [] });
    cards.regenerate("human", { id: card.frontmatter.id });
    await cards.detached?.idle();
    expect(cards.getCard(card.frontmatter.id).frontmatter.paraphrase?.checked).toBe(true);
  });

  it("keeps the card usable when the backend fails", async () => {
    const { cards, mock } = await setup();
    mock.set("card.paraphrase", () => {
      throw new Error("boom");
    });
    const { card, job } = cards.create("human", {
      citekey: CITEKEY,
      anchor: pdfAnchor(0),
      quote: "Kommunikation ist ihre Operation.",
    });
    await cards.detached?.idle();
    expect(cards.detached?.jobs.get(job ?? "")?.status).toBe("failed");
    expect(cards.getCard(card.frontmatter.id).body.paraphrase).toBeUndefined();
  });

  it("uses an injected job queue", async () => {
    const queued: Array<() => Promise<unknown>> = [];
    const { cards } = await setup({
      deps: {
        jobs: {
          enqueue: (spec) => {
            queued.push(spec.run);
            return "j_01JB8Z3Q0000000000000000AA";
          },
        },
      },
    });
    const { card, job } = cards.create("human", {
      citekey: CITEKEY,
      anchor: pdfAnchor(0),
      quote: "Kommunikation ist ihre Operation.",
    });
    expect(job).toBe("j_01JB8Z3Q0000000000000000AA");
    expect(cards.getCard(card.frontmatter.id).body.paraphrase).toBeUndefined();
    await queued[0]?.();
    expect(cards.getCard(card.frontmatter.id).body.paraphrase).toBe(
      "Systeme erzeugen sich selbst.",
    );
  });
});

describe("cards.update", () => {
  it("edits note, kind, tags and locator", async () => {
    const { reg, cards } = await setup();
    const { card } = cards.create("human", {
      citekey: CITEKEY,
      anchor: pdfAnchor(0),
      quote: "Kommunikation ist ihre Operation.",
      ai: false,
    });
    const id = card.frontmatter.id;
    const out = (await reg.call("cards.update", human, {
      id,
      patch: { note: "Eigene Worte", kind: "definition", tags: ["a", "b"] },
    })) as { card: CardFile };
    expect(out.card.body.note).toBe("Eigene Worte");
    expect(out.card.frontmatter).toMatchObject({ kind: "definition", tags: ["a", "b"] });
    expect(out.card.frontmatter.modified).toMatchObject({ by: "human" });

    const withLocator = cards.update("human", {
      id,
      patch: { locator: { label: "page", start: "99", end: "100" } },
    });
    expect(withLocator.card.frontmatter.locator).toEqual({
      label: "page",
      start: "99",
      end: "100",
      confirmed: true,
    });
  });

  it("rejects quote edits and keeps the file intact", async () => {
    const { reg, cards, lib } = await setup();
    const quote = "Kommunikation ist ihre Operation.";
    const { card } = cards.create("human", {
      citekey: CITEKEY,
      anchor: pdfAnchor(0),
      quote,
      ai: false,
    });
    const id = card.frontmatter.id;
    const file = lib.paths.cardFile(CITEKEY, id);
    const before = readFileSync(file, "utf8");
    expect(() => cards.update("human", { id, patch: { quote: "Geändert" } })).toThrow(
      /CARD_QUOTE_IMMUTABLE/,
    );
    expect(() => cards.update("human", { id, patch: { bogus: 1 } })).toThrow(/INVALID_PATCH/);
    expect(readFileSync(file, "utf8")).toBe(before);

    // through the registry the same agent-ready error arrives
    await expect(
      reg.call("cards.update", human, { id, patch: { quote: "Geändert", note: "x" } }),
    ).rejects.toThrow(/CARD_QUOTE_IMMUTABLE/);
    const after = cards.getCard(id);
    expect(after.body.quote).toBe(quote);
    expect(lib.status().problems).toEqual([]);
  });
});

describe("cards from before D15 to D17", () => {
  const ID = "c_01JB8Z3Q7KABCDEFGH";
  const QUOTE = "Kommunikation ist ihre Operation.";
  const legacy = (kind: string) => `---
id: ${ID}
item: ${CITEKEY}
source: ${HASH}
kind: ${kind}
anchor:
  text:
    exact: ${QUOTE}
quote_sha256: ${quoteSha256(QUOTE)}
paraphrase: {by: claude-code/haiku, at: 2026-10-23T11:02:00Z, language: de}
core: {by: claude-code/haiku, at: 2026-10-23T11:02:00Z, language: de}
tags: []
projects: []
created: {at: 2026-10-23T11:01:40Z, by: human}
---
> ${QUOTE}

## Paraphrase

Alte Paraphrase.

## Core statement

Kernaussage zeppelin.

## In my words

Meine Worte.

## Comment

Mein Kommentar.
`;

  async function withLegacy(kind: string) {
    const ctx = await setup();
    writeRaw(ctx.lib.root, `items/${CITEKEY}/cards/${ID}.md`, legacy(kind));
    ctx.lib.sync();
    return ctx;
  }

  it("reads own words and comment as one note, an old quote kind as unset, and shows no core", async () => {
    const { cards, lib } = await withLegacy("quote");
    const card = cards.getCard(ID);
    expect(card.frontmatter.kind).toBeUndefined();
    expect(card.body.note).toBe("Meine Worte.\n\nMein Kommentar.");
    expect(card.body.paraphrase).toBe("Alte Paraphrase.");
    expect(lib.status().problems).toEqual([]);
    // the core statement is not searchable any more
    expect(lib.search({ q: "zeppelin" })).toEqual([]);
    expect(lib.search({ q: "Kommentar" }).length).toBeGreaterThan(0);
  });

  it("rewrites the file with a Note section, drops the old kind and keeps the core", async () => {
    const { cards, lib } = await withLegacy("quote");
    cards.update("human", { id: ID, patch: { tags: ["x"] } });
    const text = readFileSync(lib.paths.cardFile(CITEKEY, ID), "utf8");
    expect(text).toContain("## Note\n\nMeine Worte.\n\nMein Kommentar.");
    expect(text).not.toMatch(/^## (In my words|Comment)$/m);
    expect(text).not.toMatch(/^kind:/m);
    expect(text).toContain("## Core statement\n\nKernaussage zeppelin.");
    expect(text).toMatch(/^core:/m);
    expect(cards.getCard(ID).body.note).toBe("Meine Worte.\n\nMein Kommentar.");
    expect(lib.status().problems).toEqual([]);
  });

  it("keeps a kind that still exists and maps comment to unset", async () => {
    const finding = await withLegacy("finding");
    expect(finding.cards.getCard(ID).frontmatter.kind).toBe("finding");
    await finding.lib.close();
    const comment = await withLegacy("comment");
    expect(comment.cards.getCard(ID).frontmatter.kind).toBeUndefined();
  });

  it("lets the AI classify a card without kind when it is regenerated, but not override one", async () => {
    const { cards, mock } = await withLegacy("quote");
    mock.set("card.paraphrase", { paraphrase: "Neu.", kind: "method" });
    cards.regenerate("human", { id: ID });
    await cards.detached?.idle();
    const after = cards.getCard(ID);
    expect(after.frontmatter.kind).toBe("method");
    expect(after.body.paraphrase).toBe("Neu.");
    expect(after.body.core).toBe("Kernaussage zeppelin.");

    cards.update("human", { id: ID, patch: { kind: "example" } });
    mock.set("card.paraphrase", { paraphrase: "Nochmal.", kind: "thesis" });
    cards.regenerate("human", { id: ID });
    await cards.detached?.idle();
    expect(cards.getCard(ID).frontmatter.kind).toBe("example");
  });

  it("clears the kind with null and rejects the retired patch keys", async () => {
    const { cards } = await withLegacy("finding");
    cards.update("human", { id: ID, patch: { kind: null } });
    expect(cards.getCard(ID).frontmatter.kind).toBeUndefined();
    for (const key of ["ownWords", "comment", "core"]) {
      expect(() => cards.update("human", { id: ID, patch: { [key]: "x" } })).toThrow(
        /INVALID_PATCH/,
      );
    }
  });
});

describe("cards.export", () => {
  it("matches the cite package for the project export policy", async () => {
    const { reg, cards, lib } = await setup();
    lib.createProject("human", { slug: "phd", title: "PhD", brief: "" });
    lib.updateProject({
      slug: "phd",
      patch: { export: { paraphrase: "own-else-ai", labelAi: true } },
    });
    const quote = "Kommunikation ist ihre Operation.";
    const { card } = cards.create("human", { citekey: CITEKEY, anchor: pdfAnchor(0), quote });
    await cards.detached?.idle();
    const id = card.frontmatter.id;

    const direct = (await reg.call("cards.export", human, { ids: [id], project: "phd" })) as {
      html?: string;
      text: string;
    };
    expect(direct.text).toBe("„Kommunikation ist ihre Operation.“ (Luhmann, 1984, S. 213)");
    expect(direct.html).toBe("<p>„Kommunikation ist ihre Operation.“ (Luhmann, 1984, S. 213)</p>");

    const indirect = (await reg.call("cards.export", human, {
      ids: [id],
      project: "phd",
      mode: "indirect",
      format: "text",
    })) as { text: string };
    expect(indirect.text).toBe(
      "Systeme erzeugen sich selbst. [KI-generierte Paraphrase] (vgl. Luhmann, 1984, S. 213)",
    );

    // the note wins under own-else-ai and drop the label
    cards.update("human", { id, patch: { note: "Gesellschaft ist Kommunikation." } });
    const own = (await reg.call("cards.export", human, {
      ids: [id],
      project: "phd",
      mode: "indirect",
      format: "pandoc",
    })) as { text: string };
    expect(own.text).toBe("Gesellschaft ist Kommunikation. [vgl. @luhmann1984soziale, S. 213]");

    // identical to calling cite directly
    const { frontmatter, body } = cards.getCard(id);
    const expected = exportCards(
      [{ card: frontmatter, body, item: lib.getItem(CITEKEY).frontmatter }],
      {
        mode: "indirect",
        format: "latex",
        style: "apa",
        locale: "de-DE",
        policy: { paraphrase: "own-else-ai", labelAi: true },
      },
    );
    const viaOp = (await reg.call("cards.export", human, {
      ids: [id],
      project: "phd",
      mode: "indirect",
      format: "latex",
    })) as { text: string };
    expect(viaOp.text).toBe(expected.text);
  });
});

describe("documents.confirmPages", () => {
  it("shifts the locator of every card of the PDF and confirms the mapping", async () => {
    const { reg, cards, lib } = await setup();
    const a = cards.create("human", {
      citekey: CITEKEY,
      anchor: pdfAnchor(0),
      quote: "Kommunikation ist ihre Operation.",
      ai: false,
    }).card.frontmatter.id;
    const b = cards.create("human", {
      citekey: CITEKEY,
      anchor: { text: { exact: "Der blinde Fleck der Beobachtung bleibt unsichtbar." } },
      quote: "Der blinde Fleck der Beobachtung bleibt unsichtbar.",
      ai: false,
    }).card.frontmatter.id;
    const c = cards.create("human", {
      citekey: CITEKEY,
      anchor: {
        text: {
          exact:
            "Beobachtung setzt eine Unterscheidung voraus und bezeichnet eine Seite. Der blinde Fleck",
        },
      },
      quote:
        "Beobachtung setzt eine Unterscheidung voraus und bezeichnet eine Seite. Der blinde Fleck",
      ai: false,
    }).card.frontmatter.id;
    expect(cards.getCard(a).frontmatter.locator?.start).toBe("213");
    expect(cards.getCard(b).frontmatter.locator?.start).toBe("215");

    const out = (await reg.call("documents.confirmPages", human, {
      citekey: CITEKEY,
      source: HASH,
      offset: 30,
    })) as { cardsUpdated: number };
    expect(out.cardsUpdated).toBe(3);

    expect(cards.getCard(a).frontmatter.locator).toEqual({
      label: "page",
      start: "31",
      confirmed: true,
    });
    expect(cards.getCard(b).frontmatter.locator).toEqual({
      label: "page",
      start: "33",
      confirmed: true,
    });
    expect(cards.getCard(c).frontmatter.locator).toEqual({
      label: "page",
      start: "32",
      end: "33",
      confirmed: true,
    });
    const pages = JSON.parse(readFileSync(lib.paths.pages(CITEKEY, HASH), "utf8"));
    expect(pages.confirmed).toBe(true);
    expect(pages.pages.map((p: { label: string }) => p.label)).toEqual(["31", "32", "33"]);
    expect(pages.pages[0].labelSource).toBe("user");

    // new cards use the confirmed labels and are marked confirmed
    const d = cards.create("human", {
      citekey: CITEKEY,
      anchor: pdfAnchor(1),
      quote: "Diese Aussage irritiert viele Leser bis heute.",
      ai: false,
    });
    expect(d.card.frontmatter.locator).toMatchObject({ start: "32", confirmed: true });

    // explicit labels win over the offset and a second run changes nothing
    const again = cards.confirmPages("human", {
      citekey: CITEKEY,
      source: HASH,
      labels: { "0": "xii" },
    });
    expect(again.cardsUpdated).toBe(1);
    expect(cards.getCard(a).frontmatter.locator?.start).toBe("xii");
    expect(lib.status().problems).toEqual([]);
  });

  it("rejects unknown sources and page keys", async () => {
    const { cards } = await setup();
    expect(() =>
      cards.confirmPages("human", { citekey: CITEKEY, source: "aaaaaaaaaaaa", offset: 1 }),
    ).toThrow(/SOURCE_NOT_FOUND/);
    expect(() =>
      cards.confirmPages("human", { citekey: CITEKEY, source: HASH, labels: { "7": "x" } }),
    ).toThrow(/INVALID_PAGES/);
  });
});

describe("registry", () => {
  it("binds the five operations next to the core ones", async () => {
    const { reg } = await setup();
    const names = reg.list().map((c) => c.name);
    for (const n of [
      "cards.create",
      "cards.update",
      "cards.regenerate",
      "cards.export",
      "documents.confirmPages",
      "cards.list",
    ]) {
      expect(names).toContain(n);
    }
  });
});
