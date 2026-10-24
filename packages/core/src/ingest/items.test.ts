import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Block, type ItemFrontmatter } from "@citegeist/schema";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownFile } from "../frontmatter.js";
import { cardData, cleanTmpDirs } from "../test-helpers.js";
import { rewriteWikiLinks } from "./items.js";
import { createTestEnv, type TestEnv } from "./testing.js";

let envs: TestEnv[] = [];
afterEach(async () => {
  for (const e of envs) {
    await e.svc.close();
    await e.lib.close();
  }
  envs = [];
  cleanTmpDirs();
});

async function env(): Promise<TestEnv> {
  const e = await createTestEnv();
  envs.push(e);
  return e;
}

async function add(e: TestEnv, identifier: string, actor = "human") {
  const out = await e.call<{ citekey: string; job: string }>(
    "items.add",
    { identifier },
    actor as never,
  );
  await e.svc.queue.waitFor(out.job);
  return out;
}

const fm = (e: TestEnv, citekey: string): ItemFrontmatter => e.lib.getItem(citekey).frontmatter;

describe("rewriteWikiLinks", () => {
  it("rewrites links, anchors, aliases and embeds but not code or longer keys", () => {
    const text = [
      "A [[old]] and [[old#^b7f3k2q]] and [[ old |alias]] and ![[old]].",
      "Not [[older]] or [[old2]] or [[x-old]].",
      "In code `[[old]]` and",
      "```",
      "[[old]]",
      "```",
      'Frontmatter-like: "[[old#^b1|see]]"',
    ].join("\n");
    const out = rewriteWikiLinks(text, "old", "new");
    expect(out.count).toBe(5);
    expect(out.text).toBe(
      [
        "A [[new]] and [[new#^b7f3k2q]] and [[ new |alias]] and ![[new]].",
        "Not [[older]] or [[old2]] or [[x-old]].",
        "In code `[[old]]` and",
        "```",
        "[[old]]",
        "```",
        'Frontmatter-like: "[[new#^b1|see]]"',
      ].join("\n"),
    );
  });
});

describe("items.rename", () => {
  it("moves the folder and rewrites links, card item fields and via fields", async () => {
    const e = await env();
    const book = await add(e, "10.1038/s41586-020-2649-2");
    const other = await add(
      e,
      "@book{other, title={Another Book}, author={Doe, Jane}, year={2001}}",
    );
    const old = book.citekey;

    // links from a note, from another item's literature note, from a project brief and in code
    const note = e.lib.createNote("human", {
      title: "Zettel",
      body: `Siehe [[${old}]] und [[${old}#^b7f3k2q|Absatz]].\n\nCode: \`[[${old}]]\`\n\nAndere: [[${old}2]]`,
      type: "permanent",
      projects: [],
    });
    const otherFile = MarkdownFile.parse(readFileSync(e.lib.getItem(other.citekey).path, "utf8"));
    otherFile.setBody(`Vergleiche ![[${old}]].`);
    e.lib.writeFile(`items/${other.citekey}/${other.citekey}.md`, otherFile.toString());
    e.lib.createProject("human", { slug: "thesis", title: "Thesis", brief: `Lesen: [[${old}]]` });

    // cards of the item and a card of another item that cites it as secondary source
    const own = cardData(old, "The quote of the own card.");
    e.lib.writeCard(own.fm, own.body);
    const via = cardData(other.citekey, "A quote citing it secondhand.", { via: old });
    e.lib.writeCard(via.fm, via.body);

    const sourceHash = fm(e, old).sources[0]?.hash ?? "";
    const result = await e.call<{ rewritten: number }>("items.rename", {
      citekey: old,
      to: "harris2020numpy",
    });
    expect(result.rewritten).toBe(5); // note, other item note, project, own card, via card

    const to = "harris2020numpy";
    expect(existsSync(e.lib.paths.itemDir(old))).toBe(false);
    expect(existsSync(e.lib.paths.itemFile(to))).toBe(true);
    expect(fm(e, to).citekey).toBe(to);
    expect(() => e.lib.getItem(old)).toThrow();

    const noteNow = e.lib.getNote(note.frontmatter.id).body;
    expect(noteNow).toContain(`[[${to}]] und [[${to}#^b7f3k2q|Absatz]]`);
    expect(noteNow).toContain(`\`[[${old}]]\``);
    expect(noteNow).toContain(`[[${old}2]]`);
    expect(e.lib.getItem(other.citekey).note).toContain(`![[${to}]]`);
    expect(e.lib.getProject("thesis").brief).toContain(`[[${to}]]`);

    const cards = e.lib.listCards({ limit: 10 }).cards;
    const ownNow = cards.find((c) => c.frontmatter.id === own.fm.id);
    const viaNow = cards.find((c) => c.frontmatter.id === via.fm.id);
    expect(ownNow?.frontmatter.item).toBe(to);
    expect(existsSync(e.lib.paths.cardFile(to, own.fm.id))).toBe(true);
    expect(viaNow?.frontmatter.item).toBe(other.citekey);
    expect(viaNow?.frontmatter.via).toBe(to);
    expect(e.lib.listCards({ citekey: to, limit: 10 }).cards).toHaveLength(1);

    // derived files moved along and are indexed under the new key
    const blocks = e.lib.index.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM blocks WHERE citekey = ? AND source = ?",
      to,
      sourceHash,
    );
    expect(blocks?.n).toBe(9);
    expect(
      e.lib.index.get<{ n: number }>("SELECT COUNT(*) AS n FROM blocks WHERE citekey = ?", old)?.n,
    ).toBe(0);
    const read = await e.call<{ markdown: string }>("documents.read", { citekey: to, pages: "11" });
    expect(read.markdown).toContain("Methods");

    // the index agrees with a full rebuild from the folder
    expect(e.lib.status().problems).toEqual([]);
    e.lib.rebuild();
    expect(e.lib.status().problems).toEqual([]);
    expect(e.lib.getItem(to).cards).toBe(1);
  });

  it("refuses a citekey that is taken", async () => {
    const e = await env();
    const a = await add(e, "@book{a1, title={One}, year={2000}, author={Doe, J}}");
    const b = await add(e, "@book{b1, title={Two}, year={2001}, author={Roe, R}}");
    await expect(
      e.call("items.rename", { citekey: a.citekey, to: b.citekey }),
    ).rejects.toMatchObject({
      detail: { code: "CITEKEY_TAKEN" },
    });
    expect(existsSync(e.lib.paths.itemFile(a.citekey))).toBe(true);
  });
});

describe("items.update", () => {
  it("changes fields, stamps provenance and modified, and keeps the index current", async () => {
    const e = await env();
    const { citekey } = await add(
      e,
      "@article{u1, title={Old Title}, author={Doe, J}, year={2000}}",
    );
    const out = await e.call<{ frontmatter: ItemFrontmatter }>(
      "items.update",
      { citekey, patch: { title: "New Title", tags: ["a", "b"], "container-title": "Journal X" } },
      "agent:grok",
    );
    expect(out.frontmatter.title).toBe("New Title");
    expect(out.frontmatter.tags).toEqual(["a", "b"]);
    expect(out.frontmatter.provenance.title).toBe("agent:grok@2026-10-23");
    expect(out.frontmatter.provenance["container-title"]).toBe("agent:grok@2026-10-23");
    expect(out.frontmatter.provenance.tags).toBeUndefined();
    expect(out.frontmatter.modified?.by).toBe("agent:grok");
    expect(out.frontmatter.author).toEqual([{ family: "Doe", given: "J" }]);
    expect(e.lib.listItems({ tags: ["a"], limit: 10 }).items[0]?.title).toBe("New Title");

    const removed = await e.call<{ frontmatter: ItemFrontmatter }>("items.update", {
      citekey,
      patch: { "container-title": null },
    });
    expect(removed.frontmatter["container-title"]).toBeUndefined();
    expect(removed.frontmatter.provenance["container-title"]).toBeUndefined();
  });

  it("rejects protected fields and values that break the schema", async () => {
    const e = await env();
    const { citekey } = await add(e, "@article{u2, title={T}, author={Doe, J}, year={2000}}");
    await expect(
      e.call("items.update", { citekey, patch: { citekey: "x" } }),
    ).rejects.toMatchObject({
      detail: { code: "INVALID_PATCH" },
    });
    await expect(e.call("items.update", { citekey, patch: { sources: [] } })).rejects.toMatchObject(
      {
        detail: { code: "INVALID_PATCH" },
      },
    );
    await expect(
      e.call("items.update", { citekey, patch: { issued: "sometime" } }),
    ).rejects.toMatchObject({
      detail: { code: "INVALID_PATCH" },
    });
    expect(fm(e, citekey).issued).toBe(2000);
  });
});

describe("items.trash", () => {
  it("moves the whole folder into .trash and drops it from the index", async () => {
    const e = await env();
    const { citekey } = await add(e, "10.1038/s41586-020-2649-2");
    const card = cardData(citekey, "Something quoted.");
    e.lib.writeCard(card.fm, card.body);
    const hash = fm(e, citekey).sources[0]?.hash ?? "";
    expect(await e.call("items.trash", { citekey })).toEqual({ ok: true });
    expect(existsSync(e.lib.paths.itemDir(citekey))).toBe(false);
    const trashed = readdirSync(join(e.root, ".trash"));
    expect(trashed).toHaveLength(1);
    const dir = join(e.root, ".trash", trashed[0] ?? "");
    expect(existsSync(join(dir, "sources", `${hash}.pdf`))).toBe(true);
    expect(existsSync(join(dir, "derived", hash, "doc.md"))).toBe(true);
    expect(existsSync(join(dir, "cards", `${card.fm.id}.md`))).toBe(true);
    expect(() => e.lib.getItem(citekey)).toThrow();
    expect(e.lib.status()).toMatchObject({ items: 0, cards: 0 });
    // the library can use the citekey again and a rebuild does not resurrect the trashed copy
    e.lib.rebuild();
    expect(e.lib.status().items).toBe(0);
  });
});

describe("items.restore", () => {
  it("puts a trashed item back with its cards and indexes it again", async () => {
    const e = await env();
    const { citekey } = await add(e, "10.1038/s41586-020-2649-2");
    const card = cardData(citekey, "Something quoted.");
    e.lib.writeCard(card.fm, card.body);
    await e.call("items.trash", { citekey });
    expect(e.lib.status()).toMatchObject({ items: 0, cards: 0 });

    expect(await e.call("items.restore", { citekey })).toEqual({ ok: true });
    expect(e.lib.getItem(citekey).frontmatter.citekey).toBe(citekey);
    expect(e.lib.status()).toMatchObject({ items: 1, cards: 1 });
    expect(existsSync(join(e.lib.paths.itemDir(citekey), "trashed.json"))).toBe(false);
    expect(readdirSync(join(e.root, ".trash"))).toHaveLength(0);
  });

  it("refuses when the citekey is in use or nothing was trashed", async () => {
    const e = await env();
    const { citekey } = await add(e, "10.1038/s41586-020-2649-2");
    await expect(e.call("items.restore", { citekey })).rejects.toMatchObject({
      detail: { code: "CITEKEY_TAKEN" },
    });
    await expect(e.call("items.restore", { citekey: "nothing1999here" })).rejects.toMatchObject({
      detail: { code: "NOT_IN_TRASH" },
    });
  });
});

describe("documents.read", () => {
  async function converted(e: TestEnv) {
    const { citekey } = await add(e, "10.1038/s41586-020-2649-2");
    const hash = fm(e, citekey).sources[0]?.hash ?? "";
    return { citekey, hash };
  }
  const read = (e: TestEnv, input: Record<string, unknown>) =>
    e.call<{ markdown: string; truncated: boolean; manifest?: { path: string } }>(
      "documents.read",
      input,
    );

  it("returns the whole document with its manifest", async () => {
    const e = await env();
    const { citekey } = await converted(e);
    const out = await read(e, { citekey });
    expect(out.truncated).toBe(false);
    expect(out.manifest?.path).toBe("digital");
    expect(out.markdown).toContain("<!-- page 0 label=10 -->");
    expect(out.markdown).toContain("## Results");
  });

  it("slices by printed page labels", async () => {
    const e = await env();
    const { citekey } = await converted(e);
    const one = (await read(e, { citekey, pages: "11" })).markdown;
    expect(one).toContain("label=11");
    expect(one).toContain("Paragraph 2 of Methods on printed page 11.");
    expect(one).not.toContain("Introduction");
    expect(one).not.toContain("Results");

    const range = (await read(e, { citekey, pages: "10-11" })).markdown;
    expect(range).toContain("Introduction");
    expect(range).toContain("Methods");
    expect(range).not.toContain("Results");

    const list = (await read(e, { citekey, pages: "10, 12" })).markdown;
    expect(list).toContain("Introduction");
    expect(list).toContain("Results");
    expect(list).not.toContain("Methods");

    await expect(read(e, { citekey, pages: "99" })).rejects.toMatchObject({
      detail: { code: "PAGE_NOT_FOUND" },
    });
  });

  it("slices by section title, section number and block ids", async () => {
    const e = await env();
    const { citekey, hash } = await converted(e);
    const byTitle = (await read(e, { citekey, section: "methods" })).markdown;
    expect(byTitle).toContain("## Methods");
    expect(byTitle).toContain("label=11");
    expect(byTitle).not.toContain("Introduction");
    expect(byTitle).not.toContain("Results");
    expect((await read(e, { citekey, section: "2" })).markdown).toBe(byTitle);
    await expect(read(e, { citekey, section: "Discussion" })).rejects.toMatchObject({
      detail: { code: "SECTION_NOT_FOUND" },
    });

    const blocks = readFileSync(e.lib.paths.blocks(citekey, hash), "utf8")
      .trim()
      .split("\n")
      .map((l) => Block.parse(JSON.parse(l)));
    const wanted = blocks.filter((b) => b.sec === "3" && b.type === "paragraph");
    const ids = wanted.map((b) => b.id);
    const byBlock = (await read(e, { citekey, blocks: [`^${ids[1]}`, ids[0] ?? ""] })).markdown;
    expect(byBlock).toContain("label=12");
    expect(byBlock.indexOf(`^${ids[0]}`)).toBeLessThan(byBlock.indexOf(`^${ids[1]}`));
    expect(byBlock).not.toContain("Methods");
    await expect(read(e, { citekey, blocks: ["bdoesnotexist"] })).rejects.toMatchObject({
      detail: { code: "BLOCK_NOT_FOUND" },
    });
  });

  it("cuts at a block boundary when maxChars is reached", async () => {
    const e = await env();
    const { citekey } = await converted(e);
    const full = (await read(e, { citekey })).markdown;
    const cut = await read(e, { citekey, maxChars: 150 });
    expect(cut.truncated).toBe(true);
    expect(cut.markdown.length).toBeLessThanOrEqual(151);
    expect(full.startsWith(cut.markdown.trimEnd())).toBe(true);
    expect(cut.markdown.trimEnd().endsWith(" ")).toBe(false);
    const tiny = await read(e, { citekey, maxChars: 10 });
    expect(tiny.truncated).toBe(true);
    expect(tiny.markdown).toBe(`${full.slice(0, 10)}\n`);
  });

  it("explains what to do when there is no text yet", async () => {
    const e = await env();
    const { citekey } = await add(e, "@book{nb, title={No Source}, author={Doe, J}, year={2000}}");
    await expect(read(e, { citekey })).rejects.toMatchObject({ detail: { code: "NOT_CONVERTED" } });
    await expect(e.call("documents.convert", { citekey })).rejects.toMatchObject({
      detail: { code: "NO_SOURCES" },
    });
  });

  it("refuses page ranges for text without pages", async () => {
    const e = await env();
    const { citekey } = await add(e, "https://example.org/essay");
    expect((await read(e, { citekey })).markdown).toContain("## Methods");
    await expect(read(e, { citekey, pages: "1" })).rejects.toMatchObject({
      detail: { code: "NO_PAGES" },
    });
  });

  it("reads page ranges of an arXiv paper from its PDF and the rest from either source", async () => {
    const e = await env();
    const { citekey } = await add(e, "arXiv:1706.03762");
    expect((await read(e, { citekey, pages: "12" })).markdown).toContain("Results");
    expect((await read(e, { citekey, section: "Results" })).markdown).toContain("Results");
  });
});

describe("documents.convert", () => {
  it("skips converted sources unless forced and converts again with force", async () => {
    const e = await env();
    const { citekey } = await add(e, "10.1038/s41586-020-2649-2");
    const hash = fm(e, citekey).sources[0]?.hash ?? "";
    const marker = join(e.lib.paths.derivedDir(citekey, hash), "stale.txt");
    await import("node:fs").then((fs) => fs.writeFileSync(marker, "old"));

    const plain = await e.call<{ job: string }>("documents.convert", { citekey });
    const plainDone = await e.svc.queue.waitFor(plain.job);
    expect(plainDone.result).toMatchObject({ converted: [], skipped: 1 });
    expect(existsSync(marker)).toBe(true);

    const forced = await e.call<{ job: string }>("documents.convert", { citekey, force: true });
    const forcedDone = await e.svc.queue.waitFor(forced.job);
    expect(forcedDone.result).toMatchObject({ converted: [hash], skipped: 0 });
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(join(e.lib.paths.derivedDir(citekey, hash), "doc.md"))).toBe(true);
    expect(forcedDone.progress).toBe(1);
  });
});
