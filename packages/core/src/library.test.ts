import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Actor } from "@citegeist/schema";
import { afterEach, describe, expect, it } from "vitest";
import { type ChangeEvent, Library } from "./library.js";
import { createCoreRegistry } from "./ops.js";
import {
  cardData,
  cardFile,
  cleanTmpDirs,
  itemData,
  itemFile,
  noteData,
  noteFile,
  tmpDir,
  until,
  writeRaw,
  writeSyntheticItems,
} from "./test-helpers.js";

const open: Library[] = [];
async function newLibrary(opts: { watch?: boolean } = {}): Promise<{
  lib: Library;
  root: string;
  localBase: string;
}> {
  const root = tmpDir("cg-lib-");
  const localBase = tmpDir("cg-local-");
  const lib = await Library.init(root, { name: "Test", localBase, ...opts });
  open.push(lib);
  return { lib, root: lib.root, localBase };
}

afterEach(async () => {
  for (const l of open.splice(0)) await l.close();
  cleanTmpDirs();
});

const human = { actor: "human" as Actor };
const agent = { actor: "agent:claude-code" as Actor };

describe("open and init", () => {
  it("creates the manifest, folders and agent files, and keeps machine-local data elsewhere", async () => {
    const { lib, root, localBase } = await newLibrary();
    expect(JSON.parse(readFileSync(join(root, "citegeist.json"), "utf8"))).toMatchObject({
      format: 1,
      name: "Test",
    });
    for (const f of ["AGENTS.md", "CLAUDE.md", "items", "notes", "projects", "chats"]) {
      expect(existsSync(join(root, f)), f).toBe(true);
    }
    expect(lib.local.indexDb).toBe(join(localBase, lib.manifest.id, "index.sqlite"));
    expect(existsSync(lib.local.indexDb)).toBe(true);
    expect(readdirSync(root).some((n) => n.includes("sqlite"))).toBe(false);
    expect(lib.paths.cardFile("luhmann1984soziale", "c_1")).toBe(
      join(root, "items", "luhmann1984soziale", "cards", "c_1.md"),
    );
    expect(lib.paths.blocks("a1", "3f9a1c2e7b4d")).toBe(
      join(root, "items", "a1", "derived", "3f9a1c2e7b4d", "blocks.jsonl"),
    );
  });

  it("refuses to init twice and to open a folder without manifest", async () => {
    const { root, localBase } = await newLibrary();
    await expect(Library.init(root, { localBase })).rejects.toThrow(/LIBRARY_EXISTS/);
    await expect(Library.open(tmpDir(), { localBase })).rejects.toThrow(/LIBRARY_NOT_FOUND/);
    await expect(Library.open(join(root, "nope"), { localBase })).rejects.toThrow(
      /LIBRARY_NOT_FOUND/,
    );
  });

  it("catches up with changes made while the library was closed", async () => {
    const { lib, root, localBase } = await newLibrary({ watch: false });
    lib.writeItem(itemData("a1xx"));
    await lib.close();
    writeRaw(root, "items/b2xx/b2xx.md", itemFile(itemData("b2xx")));
    rmSync(join(root, "items", "a1xx"), { recursive: true });
    const again = await Library.open(root, { localBase, watch: false });
    open.push(again);
    expect(again.listItems({ limit: 10 }).items.map((i) => i.citekey)).toEqual(["b2xx"]);
  });
});

describe("operations", () => {
  it("creates, reads and updates notes and stamps the actor", async () => {
    const { lib } = await newLibrary({ watch: false });
    const reg = createCoreRegistry(lib);
    const created = (await reg.call("notes.create", agent, {
      title: "Autopoiesis erklärt Stabilität",
      body: "Siehe [[luhmann1984soziale]].",
      type: "permanent",
      projects: ["phd"],
    })) as { frontmatter: { id: string; created: unknown }; path: string };
    expect(created.frontmatter.created).toMatchObject({ by: "agent:claude-code" });
    expect(created.path).toBe(join(lib.root, "notes", "autopoiesis-erklaert-stabilitaet.md"));

    const id = created.frontmatter.id;
    const got = (await reg.call("notes.get", human, { id })) as { body: string };
    expect(got.body).toBe("Siehe [[luhmann1984soziale]].");

    const updated = (await reg.call(
      "notes.update",
      { actor: "agent:grok" as Actor },
      {
        id,
        body: "Neuer Text",
        title: "Anderer Titel",
      },
    )) as { frontmatter: { title: string; modified: unknown }; body: string; path: string };
    expect(updated.body).toBe("Neuer Text");
    expect(updated.frontmatter.title).toBe("Anderer Titel");
    expect(updated.frontmatter.modified).toMatchObject({ by: "agent:grok" });

    // a new title renames the file, which frees the old name for the next note
    expect(updated.path).toBe(join(lib.root, "notes", "anderer-titel.md"));
    const second = (await reg.call("notes.create", human, {
      title: "Autopoiesis erklärt Stabilität",
      type: "question",
      projects: [],
    })) as { path: string };
    expect(second.path.endsWith("autopoiesis-erklaert-stabilitaet.md")).toBe(true);
    const third = (await reg.call("notes.create", human, {
      title: "Autopoiesis erklärt Stabilität",
      type: "question",
      projects: [],
    })) as { path: string };
    expect(third.path.endsWith("autopoiesis-erklaert-stabilitaet-2.md")).toBe(true);

    // the replaced body no longer contributes edges
    expect(lib.index.all("SELECT dst FROM links WHERE src_ref = ?", id)).toEqual([]);
    await expect(reg.call("notes.get", human, { id: "n_01JB9Z3Q7K" })).rejects.toThrow(
      /NOTE_NOT_FOUND/,
    );
  });

  it("indexes edges from note frontmatter and wiki links", async () => {
    const { lib } = await newLibrary({ watch: false });
    lib.writeItem(itemData("luhmann1984soziale"));
    const card = cardData("luhmann1984soziale", "Ein Zitat.");
    lib.writeCard(card.fm, card.body);
    lib.writeFile(
      "notes/zettel.md",
      noteFile(
        noteData("Zettel", {
          links: [
            {
              to: "[[luhmann1984soziale]]",
              rel: "supports",
              why: "weil",
              evidence: `[[${card.fm.id}]]`,
              by: "agent:x",
              status: "proposed",
            },
          ],
        }),
        `Text mit [[${card.fm.id}]] und [[luhmann1984soziale#^b7f3k2q]].`,
      ),
    );
    const edges = lib.index.all<{
      src_kind: string;
      dst: string;
      rel: string | null;
      origin: string;
      dst_kind: string;
      status: string;
      evidence: string | null;
    }>(
      "SELECT src_kind, dst, rel, origin, dst_kind, status, evidence FROM resolved_links ORDER BY origin, dst",
    );
    expect(edges).toContainEqual({
      src_kind: "note",
      dst: "luhmann1984soziale",
      rel: "supports",
      origin: "frontmatter",
      dst_kind: "item",
      status: "proposed",
      evidence: card.fm.id,
    });
    expect(edges.filter((e) => e.origin === "wiki").map((e) => [e.dst_kind, e.dst])).toEqual([
      ["card", card.fm.id],
      ["item", "luhmann1984soziale"],
    ]);
    expect(edges.find((e) => e.origin === "auto")).toMatchObject({
      src_kind: "card",
      rel: "excerpt-of",
      dst_kind: "item",
    });
  });

  it("creates, reads, lists and updates projects", async () => {
    const { lib } = await newLibrary({ watch: false });
    const reg = createCoreRegistry(lib);
    const p = (await reg.call("projects.create", human, {
      slug: "phd-proposal",
      title: "PhD Proposal",
      brief: "Der Brief.",
    })) as { frontmatter: { style: string; created: unknown }; brief: string };
    expect(p.frontmatter.style).toBe("apa");
    expect(p.frontmatter.created).toMatchObject({ by: "human" });
    await expect(
      reg.call("projects.create", human, { slug: "phd-proposal", title: "x" }),
    ).rejects.toThrow(/PROJECT_EXISTS/);

    lib.writeItem(itemData("a1xx", { projects: ["phd-proposal"] }));
    lib.writeItem(itemData("b2xx"));
    const got = (await reg.call("projects.get", human, { slug: "phd-proposal" })) as {
      items: number;
      brief: string;
    };
    expect(got).toMatchObject({ items: 1, brief: "Der Brief." });

    const upd = (await reg.call("projects.update", human, {
      slug: "phd-proposal",
      patch: {
        style: "chicago-author-date",
        questions: [{ id: "q1", text: "Was ist die Frage?" }],
      },
      brief: "Neuer Brief.",
    })) as { frontmatter: { style: string; questions: unknown[] }; brief: string };
    expect(upd.frontmatter.style).toBe("chicago-author-date");
    expect(upd.frontmatter.questions).toHaveLength(1);
    expect(upd.brief).toBe("Neuer Brief.");
    await expect(
      reg.call("projects.update", human, { slug: "phd-proposal", patch: { status: "bogus" } }),
    ).rejects.toThrow(/INVALID_PATCH/);
    await expect(
      reg.call("projects.update", human, { slug: "phd-proposal", patch: { slug: "other" } }),
    ).rejects.toThrow(/INVALID_PATCH/);

    const list = (await reg.call("projects.list", human, {})) as { projects: { slug: string }[] };
    expect(list.projects.map((x) => x.slug)).toEqual(["phd-proposal"]);
    await expect(reg.call("projects.get", human, { slug: "nope" })).rejects.toThrow(
      /PROJECT_NOT_FOUND/,
    );
  });

  it("reads and lists items and cards with scope filters and paging", async () => {
    const { lib } = await newLibrary({ watch: false });
    const reg = createCoreRegistry(lib);
    lib.writeItem(
      itemData("a1xx", { tags: ["sys"], projects: ["p1"], status: "read" }),
      "Literaturnotiz A",
    );
    lib.writeItem(itemData("b2xx", { tags: ["sys", "x"], inbox: { by: "agent:x" } }));
    lib.writeItem(itemData("c3xx", { author: [{ literal: "OECD" }], issued: "2021-03" }));
    const card = cardData("a1xx", "Quote one", { tags: ["t1"] });
    lib.writeCard(card.fm, { ...card.body, paraphrase: "Para", ownWords: "Eigene Worte" });
    const card2 = cardData("b2xx", "Quote two", { kind: "finding" });
    lib.writeCard(card2.fm, card2.body);

    const item = (await reg.call("items.get", human, { citekey: "a1xx" })) as {
      note: string;
      cards: number;
      path: string;
      frontmatter: { title: string };
    };
    expect(item).toMatchObject({ note: "Literaturnotiz A", cards: 1 });
    expect(item.path).toBe(join(lib.root, "items", "a1xx", "a1xx.md"));
    await expect(reg.call("items.get", human, { citekey: "zzzz" })).rejects.toThrow(
      /ITEM_NOT_FOUND/,
    );

    const all = (await reg.call("items.list", human, {})) as {
      items: { citekey: string; authors?: string; year?: string; inbox: boolean }[];
    };
    expect(all.items.map((i) => i.citekey)).toEqual(["a1xx", "b2xx", "c3xx"]);
    expect(all.items[0]).toMatchObject({ authors: "Luhmann", year: "1984" });
    expect(all.items[2]).toMatchObject({ authors: "OECD", year: "2021" });

    const q = async (input: object) =>
      ((await reg.call("items.list", human, input)) as { items: { citekey: string }[] }).items.map(
        (i) => i.citekey,
      );
    expect(await q({ project: "p1" })).toEqual(["a1xx"]);
    expect(await q({ tags: ["sys"] })).toEqual(["a1xx", "b2xx"]);
    expect(await q({ tags: ["sys", "x"] })).toEqual(["b2xx"]);
    expect(await q({ status: "read" })).toEqual(["a1xx"]);
    expect(await q({ inbox: true })).toEqual(["b2xx"]);

    const page1 = (await reg.call("items.list", human, { limit: 2 })) as {
      items: unknown[];
      next?: string;
    };
    expect(page1.items).toHaveLength(2);
    expect(page1.next).toBe("b2xx");
    const page2 = (await reg.call("items.list", human, { limit: 2, cursor: page1.next })) as {
      items: { citekey: string }[];
      next?: string;
    };
    expect(page2.items.map((i) => i.citekey)).toEqual(["c3xx"]);
    expect(page2.next).toBeUndefined();

    const cards = (await reg.call("cards.list", human, { citekey: "a1xx" })) as {
      cards: { frontmatter: { id: string }; body: { quote: string; ownWords?: string } }[];
    };
    expect(cards.cards).toHaveLength(1);
    expect(cards.cards[0]?.body).toMatchObject({ quote: "Quote one", ownWords: "Eigene Worte" });
    const byKind = (await reg.call("cards.list", human, { kind: "finding" })) as {
      cards: unknown[];
    };
    expect(byKind.cards).toHaveLength(1);
    const byProject = (await reg.call("cards.list", human, { project: "p1" })) as {
      cards: unknown[];
    };
    expect(byProject.cards).toHaveLength(1); // card of an item in the project
    const byQuery = (await reg.call("cards.list", human, { query: "Eigene Worte" })) as {
      cards: { body: { quote: string } }[];
    };
    expect(byQuery.cards.map((c) => c.body.quote)).toEqual(["Quote one"]);

    const status = (await reg.call("library.status", human, {})) as Record<string, unknown>;
    expect(status).toMatchObject({ path: lib.root, items: 3, cards: 2, notes: 0, problems: [] });
  });
});

describe("search", () => {
  it("finds German inflections: 'Kommunikationen' finds 'Kommunikation'", async () => {
    const { lib } = await newLibrary({ watch: false });
    const reg = createCoreRegistry(lib);
    lib.writeItem(
      itemData("a1xx", { title: "Soziale Systeme", abstract: "Eine Theorie der Kommunikation." }),
    );
    lib.writeItem(itemData("b2xx", { title: "Unrelated", abstract: "Bibliotheken und Quellen." }));
    const hit = async (q: string) =>
      (
        (await reg.call("search.query", human, { q })) as {
          hits: { id: string; kind: string }[];
        }
      ).hits.map((h) => h.id);
    expect(await hit("Kommunikationen")).toEqual(["a1xx"]);
    expect(await hit("Kommunikation")).toEqual(["a1xx"]);
    expect(await hit("Bibliothek")).toEqual(["b2xx"]);
    expect(await hit("quelle")).toEqual(["b2xx"]);
  });

  it("finds English inflections and partial words through the trigram table", async () => {
    const { lib } = await newLibrary({ watch: false });
    lib.writeItem(itemData("a1xx", { title: "Learning machines", abstract: "Neural networks." }));
    expect(lib.search({ q: "learned" }).map((h) => h.id)).toEqual(["a1xx"]);
    expect(lib.search({ q: "xyz" })).toEqual([]);
    expect(lib.search({ q: "machine" }).map((h) => h.id)).toEqual(["a1xx"]);
    expect(lib.search({ q: "ural netw" }).map((h) => h.id)).toEqual(["a1xx"]);
  });

  it("applies kind and scope filters and builds snippets", async () => {
    const { lib } = await newLibrary({ watch: false });
    lib.writeItem(
      itemData("a1xx", { tags: ["sys"], projects: ["p1"], status: "read" }),
      "Systemtheorie nach Luhmann",
    );
    lib.writeItem(itemData("b2xx", { tags: ["other"] }), "Systemtheorie in anderem Kontext");
    const card = cardData("a1xx", "Das System beobachtet sich selbst.");
    lib.writeCard(card.fm, card.body);
    lib.writeFile(
      "notes/n.md",
      noteFile(noteData("Zettel", { projects: ["p1"] }), "Ein System im Zettel."),
    );
    lib.writeFile(
      "items/a1xx/derived/3f9a1c2e7b4d/blocks.jsonl",
      `${JSON.stringify({
        id: "bk2f9a1x",
        type: "paragraph",
        flow: "body",
        text: "Jedes System hat eine Umwelt.",
        spans: [{ page: 4, label: "5", start: 0, end: 29 }],
        src: { engine: "docling" },
      })}\n${JSON.stringify({
        id: "bfur0001",
        type: "page-furniture",
        flow: "furniture",
        text: "System Kopfzeile",
        spans: [],
        src: { engine: "docling" },
      })}\n`,
    );

    const kinds = (q: object) => lib.search({ q: "System", ...q }).map((h) => `${h.kind}:${h.id}`);
    expect(kinds({}).sort()).toEqual(
      ["block:bk2f9a1x", `card:${card.fm.id}`, "item:a1xx", "item:b2xx"]
        .concat(lib.search({ q: "System", kinds: ["note"] }).map((h) => `note:${h.id}`))
        .sort(),
    );
    expect(kinds({ kinds: ["item"] }).sort()).toEqual(["item:a1xx", "item:b2xx"]);
    expect(kinds({ kinds: ["item"], project: "p1" })).toEqual(["item:a1xx"]);
    expect(kinds({ kinds: ["item"], tags: ["other"] })).toEqual(["item:b2xx"]);
    expect(kinds({ status: "read", kinds: ["item", "card", "block"] }).sort()).toEqual(
      ["block:bk2f9a1x", `card:${card.fm.id}`, "item:a1xx"].sort(),
    );
    // notes belong to a project through their own frontmatter
    expect(kinds({ project: "p1", kinds: ["note"] })).toHaveLength(1);

    const block = lib.search({ q: "Umwelt", kinds: ["block"] })[0];
    expect(block).toMatchObject({ citekey: "a1xx", page: "5", title: "Title of a1xx" });
    expect(block?.snippet).toContain("Umwelt");
  });

  it("drops entries of deleted and changed files from search", async () => {
    const { lib, root } = await newLibrary({ watch: false });
    lib.writeFile("notes/a.md", noteFile(noteData("A"), "Zebra im Text"));
    expect(lib.search({ q: "Zebra" })).toHaveLength(1);
    lib.writeFile("notes/a.md", noteFile(noteData("A"), "Giraffe im Text"));
    expect(lib.search({ q: "Zebra" })).toHaveLength(0);
    expect(lib.search({ q: "Giraffe" })).toHaveLength(1);
    rmSync(join(root, "notes", "a.md"));
    lib.sync();
    expect(lib.search({ q: "Giraffe" })).toHaveLength(0);
  });
});

describe("watcher", () => {
  it("shows an external file change in the index within one second", async () => {
    const { lib, root } = await newLibrary();
    await new Promise((r) => setTimeout(r, 200)); // let FSEvents settle
    const note = noteData("Extern erstellt");
    const t0 = Date.now();
    writeFileSync(
      join(root, "notes", "extern.md"),
      noteFile(note, "Von einem Agenten geschrieben."),
    );
    await until(() => lib.index.get("SELECT 1 FROM notes WHERE id = ?", note.id), 1000, 5);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(lib.search({ q: "Agenten" })).toHaveLength(1);

    // edit, then delete
    writeFileSync(join(root, "notes", "extern.md"), noteFile(note, "Jetzt anders."));
    await until(() => lib.search({ q: "anders" }).length === 1, 1000, 5);
    rmSync(join(root, "notes", "extern.md"));
    await until(() => !lib.index.get("SELECT 1 FROM notes WHERE id = ?", note.id), 1000, 5);
  });

  it("recognizes its own writes by content hash and reports only external changes", async () => {
    const { lib, root } = await newLibrary();
    await new Promise((r) => setTimeout(r, 200));
    const events: ChangeEvent[] = [];
    lib.on("change", (e: ChangeEvent) => events.push(e));
    const note = lib.createNote("human", {
      title: "Eigen",
      body: "x",
      type: "permanent",
      projects: [],
    });
    expect(events.map((e) => e.external)).toEqual([false]);
    await new Promise((r) => setTimeout(r, 300));
    expect(events.map((e) => e.external)).toEqual([false]); // watcher saw it and ignored it
    writeFileSync(
      join(root, "notes", "eigen.md"),
      readFileSync(note.path, "utf8").replace("x\n", "y\n"),
    );
    await until(() => events.some((e) => e.external), 1000, 5);
    expect(lib.getNote(note.frontmatter.id).body).toBe("y");
  });

  it("indexes a whole folder that appears at once and removes it when it disappears", async () => {
    const { lib, root } = await newLibrary();
    const stage = tmpDir("cg-stage-");
    writeRaw(stage, "items/m1xx/m1xx.md", itemFile(itemData("m1xx")));
    const card = cardData("m1xx", "Zitat");
    writeRaw(stage, `items/m1xx/cards/${card.fm.id}.md`, cardFile(card));
    renameSync(join(stage, "items", "m1xx"), join(root, "items", "m1xx"));
    await until(() => lib.index.count("cards") === 1 && lib.index.count("items") === 1, 2000, 10);
    rmSync(join(root, "items", "m1xx"), { recursive: true });
    await until(() => lib.index.count("cards") === 0 && lib.index.count("items") === 0, 2000, 10);
  });
});

describe("problems", () => {
  it("reports iCloud conflict copies and does not index them", async () => {
    const { lib, root } = await newLibrary();
    await new Promise((r) => setTimeout(r, 200));
    const note = noteData("Original");
    lib.writeFile("notes/zettel.md", noteFile(note, "Fassung A"));
    writeFileSync(join(root, "notes", "zettel 2.md"), noteFile(noteData("Kopie"), "Fassung B"));
    await until(() => lib.status().problems.length > 0, 1000, 5);
    const problems = lib.status().problems;
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      path: join(root, "notes", "zettel 2.md"),
      code: "ICLOUD_CONFLICT",
    });
    expect(lib.index.count("notes")).toBe(1);
    expect(lib.getNote(note.id).body).toBe("Fassung A");
    rmSync(join(root, "notes", "zettel 2.md"));
    await until(() => lib.status().problems.length === 0, 1000, 5);
  });

  it("lists schema-invalid files with the reason, keeps the last valid state and clears the problem on fix", async () => {
    const { lib, root } = await newLibrary({ watch: false });
    lib.writeItem(itemData("a1xx", { title: "Gut" }));
    writeRaw(root, "notes/kaputt.md", "---\nid: nope\ntitle: T\n---\n");
    writeRaw(root, "items/a1xx/a1xx.md", "---\nid: x\n---\nkaputt");
    writeRaw(root, "items/b2xx/b2xx.md", itemFile(itemData("other")));
    lib.sync();
    const codes = lib.status().problems.map((p) => [p.path.slice(root.length + 1), p.code]);
    expect(codes).toEqual([
      ["items/a1xx/a1xx.md", "SCHEMA_INVALID"],
      ["items/b2xx/b2xx.md", "CITEKEY_MISMATCH"],
      ["notes/kaputt.md", "SCHEMA_INVALID"],
    ]);
    expect(
      lib.index.get<{ title: string }>("SELECT title FROM items WHERE citekey = 'a1xx'")?.title,
    ).toBe("Gut");
    expect(lib.index.count("notes")).toBe(0);

    writeRaw(root, "items/a1xx/a1xx.md", itemFile(itemData("a1xx", { title: "Repariert" })));
    lib.sync();
    expect(lib.status().problems.map((p) => p.code)).toEqual([
      "CITEKEY_MISMATCH",
      "SCHEMA_INVALID",
    ]);
    expect(
      lib.index.get<{ title: string }>("SELECT title FROM items WHERE citekey = 'a1xx'")?.title,
    ).toBe("Repariert");
  });

  it("flags duplicate ids and altered quotes", async () => {
    const { lib, root } = await newLibrary({ watch: false });
    const note = noteData("Erste");
    lib.writeFile("notes/erste.md", noteFile(note));
    lib.writeFile("notes/zweite.md", noteFile({ ...note, title: "Zweite" }));
    expect(lib.status().problems.map((p) => p.code)).toEqual(["DUPLICATE_ID"]);

    lib.writeItem(itemData("a1xx"));
    const card = cardData("a1xx", "Original");
    writeRaw(
      root,
      `items/a1xx/cards/${card.fm.id}.md`,
      cardFile(card).replace("> Original", "> Verfälscht"),
    );
    lib.sync();
    expect(
      lib
        .status()
        .problems.map((p) => p.code)
        .sort(),
    ).toEqual(["DUPLICATE_ID", "QUOTE_HASH_MISMATCH"]);
    expect(lib.index.get<{ quote_ok: number }>("SELECT quote_ok FROM cards")?.quote_ok).toBe(0);
  });
});

describe("rebuild", () => {
  it("rebuilds 1,000 synthetic items in under two minutes and leaves the same index", async () => {
    const { lib, root } = await newLibrary({ watch: false });
    writeSyntheticItems(root, 1000);
    writeRaw(
      root,
      "projects/synthetic/project.md",
      "---\nslug: synthetic\ntitle: S\ncreated: {at: 2026-10-23T10:00:00.000Z, by: human}\n---\n",
    );
    const t0 = Date.now();
    const summary = lib.rebuild();
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(120_000);
    console.log(`rebuild of 1000 items + 1000 cards: ${ms} ms`);
    expect(summary.indexed).toBeGreaterThanOrEqual(2001);
    expect(lib.status()).toMatchObject({ items: 1000, cards: 1000, problems: [] });
    expect(lib.search({ q: "Kommunikationen", kinds: ["item"], limit: 5 }).length).toBeGreaterThan(
      0,
    );
    expect(
      lib.search({ q: "synthetic", project: "synthetic", kinds: ["item"], limit: 100 }),
    ).toHaveLength(100);

    // a second rebuild reads the folder again and ends in the same state
    const before = lib.index.all("SELECT citekey, id FROM items ORDER BY citekey");
    lib.rebuild();
    expect(lib.index.all("SELECT citekey, id FROM items ORDER BY citekey")).toEqual(before);
    expect(lib.sync()).toMatchObject({ indexed: 0, removed: 0 });
  }, 150_000);
});
