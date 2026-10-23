import { notesBacklinks, notesList } from "@citegeist/editor/contracts";
import { Registry } from "@citegeist/ops";
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
