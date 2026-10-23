import { existsSync, readFileSync } from "node:fs";
import { notesBacklinks, notesList, Registry } from "@citegeist/ops";
import { afterEach, describe, expect, it } from "vitest";
import { Library } from "../library.js";
import { cardData, cleanTmpDirs, itemData, noteData, noteFile, tmpDir } from "../test-helpers.js";
import { bindNoteOperations } from "./index.js";

interface Out {
  notes: Array<{ title: string; slug: string; type: string }>;
  backlinks: Array<{ kind: string; title: string }>;
}

const open: Library[] = [];
afterEach(async () => {
  for (const l of open.splice(0)) await l.close();
  cleanTmpDirs();
});

async function setup() {
  const lib = await Library.init(tmpDir("cg-notes-"), {
    name: "Test",
    localBase: tmpDir("cg-local-"),
    watch: false,
  });
  open.push(lib);
  const registry = bindNoteOperations(new Registry(), lib);
  const call = (name: string, input: unknown) =>
    registry.call(name, { actor: "human" }, input) as Promise<Out>;
  return { lib, call };
}

describe("notes.list", () => {
  it("lists notes newest change first and filters by title", async () => {
    const { lib, call } = await setup();
    const a = lib.createNote("human", {
      title: "Autopoiesis",
      body: "",
      type: "permanent",
      projects: [],
    });
    lib.createNote("human", {
      title: "Zettelkasten",
      body: "",
      type: "permanent",
      projects: ["p1"],
    });
    lib.updateNote("human", { id: a.frontmatter.id, body: "geändert" });

    const all = await call("notes.list", {});
    expect(all.notes.map((n) => n.title)).toEqual(["Autopoiesis", "Zettelkasten"]);
    expect(all.notes[0]).toMatchObject({ slug: "autopoiesis", type: "permanent" });

    const hit = await call("notes.list", { query: "zettel" });
    expect(hit.notes.map((n) => n.title)).toEqual(["Zettelkasten"]);
    const byProject = await call("notes.list", { project: "p1" });
    expect(byProject.notes).toHaveLength(1);
    expect((await call("notes.list", { query: "100%" })).notes).toHaveLength(0);
    expect(notesList.name).toBe("notes.list");
  });
});

describe("notes.backlinks", () => {
  it("finds notes, items and cards that link to a note", async () => {
    const { lib, call } = await setup();
    const target = lib.createNote("human", {
      title: "Ziel",
      body: "",
      type: "permanent",
      projects: [],
    });
    lib.createNote("human", {
      title: "Quelle",
      body: `Siehe [[ziel]] und nochmal [[${target.frontmatter.id}]].`,
      type: "permanent",
      projects: [],
    });
    lib.writeItem(itemData("a1xx"), "Notiz zu [[ziel]].");
    const card = cardData("a1xx", "Das System beobachtet sich selbst.");
    lib.writeCard(card.fm, { ...card.body, comment: "Vgl. [[ziel]]" });
    lib.writeFile(
      "notes/typed.md",
      noteFile(
        noteData("Typisiert", {
          links: [{ to: "[[ziel]]", rel: "supports", by: "human", status: "accepted" }],
        }),
        "",
      ),
    );
    lib.sync();

    const out = await call("notes.backlinks", { id: target.frontmatter.id });
    const byKind = (k: string) => out.backlinks.filter((b) => b.kind === k);
    expect(byKind("item")).toMatchObject([{ id: "a1xx", citekey: "a1xx", origin: "wiki" }]);
    expect(byKind("card")).toMatchObject([{ id: card.fm.id, citekey: "a1xx" }]);
    expect(
      byKind("note")
        .map((b) => b.title)
        .sort(),
    ).toEqual(["Quelle", "Typisiert"]);
    expect(byKind("note").find((b) => b.title === "Typisiert")).toMatchObject({
      rel: "supports",
      origin: "frontmatter",
      status: "accepted",
    });
    expect(notesBacklinks.name).toBe("notes.backlinks");
  });

  it("is empty for a note nothing links to", async () => {
    const { lib, call } = await setup();
    const n = lib.createNote("human", {
      title: "Einsam",
      body: "[[einsam]]",
      type: "permanent",
      projects: [],
    });
    expect((await call("notes.backlinks", { id: n.frontmatter.id })).backlinks).toEqual([]);
  });
});

describe("notes.update", () => {
  it("changes type, tags and projects and stamps the caller", async () => {
    const { lib } = await setup();
    const n = lib.createNote("human", {
      title: "Begriff",
      body: "Text.",
      type: "permanent",
      projects: [],
    });
    const out = lib.updateNote("agent:claude-desktop", {
      id: n.frontmatter.id,
      type: "claim",
      tags: [" systems ", "systems", "luhmann"],
      projects: ["p1", "p1"],
    });
    expect(out.frontmatter).toMatchObject({
      type: "claim",
      tags: ["systems", "luhmann"],
      projects: ["p1"],
      title: "Begriff",
      modified: { by: "agent:claude-desktop" },
    });
    expect(out.body.trim()).toBe("Text.");
    expect(lib.index.get("SELECT type FROM notes WHERE id = ?", n.frontmatter.id)).toEqual({
      type: "claim",
    });
    // Without those fields the note keeps them.
    const again = lib.updateNote("human", { id: n.frontmatter.id, body: "Neuer Text." });
    expect(again.frontmatter).toMatchObject({ type: "claim", tags: ["systems", "luhmann"] });
  });

  it("renames the file when the title changes and rewrites the links to the old name", async () => {
    const { lib, call } = await setup();
    const target = lib.createNote("human", {
      title: "Alter Titel",
      body: "Inhalt.",
      type: "permanent",
      projects: [],
    });
    lib.createNote("human", {
      title: "Quelle",
      body: `Per Name [[alter-titel]], mit Alias [[alter-titel|der Alte]], mit Anker [[alter-titel#^b1]], per Id [[${target.frontmatter.id}]] und \`[[alter-titel]]\` im Code.`,
      type: "permanent",
      projects: [],
    });
    lib.writeItem(itemData("a1xx"), "Notiz zu [[alter-titel]].");
    const card = cardData("a1xx", "Das System beobachtet sich selbst.");
    lib.writeCard(card.fm, { ...card.body, comment: "Vgl. [[alter-titel]]" });
    lib.writeFile(
      "notes/typed.md",
      noteFile(
        noteData("Typisiert", {
          links: [{ to: "[[alter-titel]]", rel: "supports", by: "human", status: "accepted" }],
        }),
        "",
      ),
    );
    lib.sync();

    const out = lib.updateNote("human", { id: target.frontmatter.id, title: "Neuer Titel" });
    expect(out.frontmatter.title).toBe("Neuer Titel");
    expect(out.path).toBe(lib.paths.noteFile("neuer-titel"));
    expect(existsSync(lib.paths.noteFile("alter-titel"))).toBe(false);
    expect(readFileSync(out.path, "utf8")).toContain("Inhalt.");

    const read = (rel: string) => readFileSync(lib.paths.abs(rel), "utf8");
    const quelle = read("notes/quelle.md");
    expect(quelle).toContain("[[neuer-titel]]");
    expect(quelle).toContain("[[neuer-titel|der Alte]]");
    expect(quelle).toContain("[[neuer-titel#^b1]]");
    expect(quelle).toContain(`[[${target.frontmatter.id}]]`);
    expect(quelle).toContain("`[[alter-titel]]`");
    expect(read("items/a1xx/a1xx.md")).toContain("[[neuer-titel]]");
    expect(read(`items/a1xx/cards/${card.fm.id}.md`)).toContain("Vgl. [[neuer-titel]]");
    expect(read("notes/typed.md")).toContain("[[neuer-titel]]");
    expect(read("notes/typed.md")).not.toContain("[[alter-titel]]");

    // The index follows: one note under the new slug, and the links still resolve to it.
    const listed = await call("notes.list", {});
    expect(listed.notes.filter((n) => n.title === "Neuer Titel")).toMatchObject([
      { slug: "neuer-titel" },
    ]);
    expect(listed.notes.some((n) => n.slug === "alter-titel")).toBe(false);
    const back = await call("notes.backlinks", { id: target.frontmatter.id });
    expect(
      back.backlinks
        .filter((b) => b.kind === "note")
        .map((b) => b.title)
        .sort(),
    ).toEqual(["Quelle", "Typisiert"]);
    expect(back.backlinks.some((b) => b.kind === "item")).toBe(true);
    expect(back.backlinks.some((b) => b.kind === "card")).toBe(true);
    expect(lib.status().problems).toEqual([]);
  });

  it("takes the next free name when the new slug exists, and keeps the file for the same slug", async () => {
    const { lib } = await setup();
    lib.createNote("human", { title: "Beobachtung", body: "", type: "permanent", projects: [] });
    const n = lib.createNote("human", {
      title: "Anderes",
      body: "",
      type: "permanent",
      projects: [],
    });
    const moved = lib.updateNote("human", { id: n.frontmatter.id, title: "Beobachtung" });
    expect(moved.path).toBe(lib.paths.noteFile("beobachtung-2"));
    expect(moved.frontmatter.title).toBe("Beobachtung");

    // A title that gives the same slug (case, punctuation) changes the title only.
    const same = lib.updateNote("human", { id: n.frontmatter.id, title: "beobachtung!" });
    expect(same.path).toBe(lib.paths.noteFile("beobachtung-2"));
    expect(same.frontmatter.title).toBe("beobachtung!");
  });
});
