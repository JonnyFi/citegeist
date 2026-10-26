import { readFileSync } from "node:fs";
import { AiRouter, MockBackend } from "@citegeist/ai";
import { Registry } from "@citegeist/ops";
import type { Actor } from "@citegeist/schema";
import { afterEach, describe, expect, it } from "vitest";
import { Library } from "../library.js";
import { bindCoreOperations } from "../ops.js";
import {
  cardData,
  cardFile,
  cleanTmpDirs,
  itemData,
  itemFile,
  tmpDir,
  writeRaw,
} from "../test-helpers.js";
import { bindLinkOperations } from "./index.js";
import { findMentions } from "./mentions.js";

const human = { actor: "human" as Actor };
const agent = { actor: "agent:claude-code" as Actor };
const ACCELERATE = "williams2013accelerate";
const LAND = "land2012dark";

const open: Library[] = [];
afterEach(async () => {
  for (const l of open.splice(0)) await l.close();
  cleanTmpDirs();
});

const QUOTE =
  "Die Beschleunigung, die Nick Land in seinem Text über die dunkle Aufklärung fordert, endet in Hierarchie und Ausschluss.";

async function setup() {
  const root = tmpDir("cg-cardlinks-");
  const lib = await Library.init(root, { watch: false, localBase: tmpDir("cg-local-") });
  open.push(lib);
  writeRaw(
    root,
    `items/${ACCELERATE}/${ACCELERATE}.md`,
    itemFile(
      itemData(ACCELERATE, {
        title: "#Accelerate: Manifesto for an Accelerationist Politics",
        author: [
          { family: "Williams", given: "Alex" },
          { family: "Srnicek", given: "Nick" },
        ],
        issued: 2013,
      }),
    ),
  );
  writeRaw(
    root,
    `items/${LAND}/${LAND}.md`,
    itemFile(
      itemData(LAND, {
        title: "The Dark Enlightenment",
        author: [{ family: "Land", given: "Nick" }],
        issued: 2012,
        abstract: "Essay against democratic egalitarianism.",
      }),
    ),
  );
  const card = cardData(ACCELERATE, QUOTE, { kind: "critique" });
  writeRaw(root, `items/${ACCELERATE}/cards/${card.fm.id}.md`, cardFile(card));
  lib.sync();
  const mock = new MockBackend({ "card.suggestLinks": { suggestions: [] } });
  const ai = new AiRouter([mock], { routing: { "*": "mock" } });
  const reg = bindLinkOperations(bindCoreOperations(new Registry(), lib), lib, { ai });
  return { lib, reg, mock, links: reg.links, card: card.fm.id, root };
}

const literatureNotes = (lib: Library) =>
  lib.index.all<{ id: string }>("SELECT id FROM notes WHERE type = 'literature'");

describe("links.create from a card", () => {
  it("stores the link in a new literature note of the card's item, with the card as evidence", async () => {
    const { reg, lib, card } = await setup();
    expect(literatureNotes(lib)).toHaveLength(0);

    const note = (await reg.call("links.create", human, {
      from: card,
      link: { to: `[[${LAND}]]`, rel: "opposes", why: "Gegen Lands Beschleunigung." },
    })) as ReturnType<Library["getNote"]>;

    expect(note.frontmatter.type).toBe("literature");
    expect(note.body).toContain(`Item: [[${ACCELERATE}]]`);
    expect(note.frontmatter.links).toEqual([
      {
        from: card,
        to: `[[${LAND}]]`,
        rel: "opposes",
        why: "Gegen Lands Beschleunigung.",
        evidence: `[[${card}]]`,
        by: "human",
        status: "accepted",
      },
    ]);
    expect(readFileSync(note.path, "utf8")).toContain(`from: ${card}`);
  });

  it("reuses an existing literature note of the item, such as one from the Zotero import", async () => {
    const { reg, lib, card } = await setup();
    const existing = lib.createNote("human", {
      title: "Reading notes (williams2013accelerate)",
      body: `Item: [[${ACCELERATE}]]\n\nMy notes.`,
      type: "literature",
      projects: [],
    });
    const note = (await reg.call("links.create", human, {
      from: card,
      link: { to: `[[${LAND}]]`, rel: "opposes" },
    })) as ReturnType<Library["getNote"]>;
    expect(note.frontmatter.id).toBe(existing.frontmatter.id);
    expect(note.body).toContain("My notes.");
    expect(literatureNotes(lib)).toHaveLength(1);
  });

  it("does not take a literature note that only mentions the item", async () => {
    const { reg, lib, card } = await setup();
    lib.createNote("human", {
      title: "Reading notes (other)",
      body: `Item: [[${LAND}]]\n\nCompare [[${ACCELERATE}]].`,
      type: "literature",
      projects: [],
    });
    const note = (await reg.call("links.create", human, {
      from: card,
      link: { to: `[[${LAND}]]`, rel: "opposes" },
    })) as ReturnType<Library["getNote"]>;
    expect(note.body).toContain(`Item: [[${ACCELERATE}]]`);
    expect(literatureNotes(lib)).toHaveLength(2);
  });

  it("is idempotent, refuses unknown targets and a link to itself", async () => {
    const { reg, lib, card } = await setup();
    const args = { from: card, link: { to: `[[${LAND}]]`, rel: "opposes" } };
    await reg.call("links.create", human, args);
    const twice = (await reg.call("links.create", human, args)) as ReturnType<Library["getNote"]>;
    expect(twice.frontmatter.links).toHaveLength(1);
    await expect(
      reg.call("links.create", human, { from: card, link: { to: "[[nobody0000]]" } }),
    ).rejects.toThrow(/LINK_TARGET_NOT_FOUND/);
    await expect(
      reg.call("links.create", human, { from: card, link: { to: `[[${card}]]` } }),
    ).rejects.toThrow(/LINK_TO_SELF/);
    await expect(
      reg.call("links.create", human, { from: "c_00000000000000", link: { to: `[[${LAND}]]` } }),
    ).rejects.toThrow(/CARD_NOT_FOUND/);
    expect(literatureNotes(lib)).toHaveLength(1);
  });

  it("stamps an agent as the author and keeps the card as source in graph and backlinks", async () => {
    const { reg, lib, card } = await setup();
    await reg.call("links.create", agent, {
      from: card,
      link: { to: `[[${LAND}]]`, rel: "opposes", why: "Widerspruch." },
    });
    const forCard = (await reg.call("links.forCard", human, { card })) as {
      links: Array<Record<string, unknown>>;
    };
    expect(forCard.links).toHaveLength(1);
    expect(forCard.links[0]).toMatchObject({
      to: LAND,
      kind: "item",
      short: "Land 2012",
      rel: "opposes",
      by: "agent:claude-code",
      status: "accepted",
      index: 0,
    });
    const graph = (await reg.call("graph.neighbors", human, { node: card, depth: 1 })) as {
      edges: Array<{ from: string; to: string; rel: string }>;
    };
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ from: card, to: LAND, rel: "opposes" }),
    );
    // the edge starts at the card, not at the literature note
    const row = lib.index.get<{ src_kind: string }>(
      "SELECT src_kind FROM links WHERE dst = ? AND rel = 'opposes'",
      LAND,
    );
    expect(row?.src_kind).toBe("card");
  });

  it("keeps a note's own link and a card's link to the same target apart", async () => {
    const { reg, lib, card } = await setup();
    const note = lib.createNote("human", {
      title: "Zettel",
      body: "",
      type: "permanent",
      projects: [],
    });
    await reg.call("links.create", human, {
      from: note.frontmatter.id,
      link: { to: `[[${LAND}]]`, rel: "opposes" },
    });
    await reg.call("links.create", human, {
      from: card,
      link: { to: `[[${LAND}]]`, rel: "opposes" },
    });
    expect(lib.getNote(note.frontmatter.id).frontmatter.links).toHaveLength(1);
    const lit = literatureNotes(lib)[0];
    expect(lib.getNote(lit?.id ?? "").frontmatter.links).toHaveLength(1);
  });
});

describe("links.remove", () => {
  it("removes a link from a card and from a note and fails for a link that is not there", async () => {
    const { reg, lib, card } = await setup();
    await reg.call("links.create", human, {
      from: card,
      link: { to: `[[${LAND}]]`, rel: "opposes" },
    });
    await expect(reg.call("links.remove", human, { from: card, to: "[[nobody]]" })).rejects.toThrow(
      /LINK_NOT_FOUND/,
    );
    const after = (await reg.call("links.remove", human, {
      from: card,
      to: `[[${LAND}]]`,
    })) as ReturnType<Library["getNote"]>;
    expect(after.frontmatter.links).toEqual([]);
    expect(
      ((await reg.call("links.forCard", human, { card })) as { links: unknown[] }).links,
    ).toEqual([]);

    const note = lib.createNote("human", {
      title: "Zettel",
      body: "",
      type: "permanent",
      projects: [],
    });
    await reg.call("links.create", human, {
      from: note.frontmatter.id,
      link: { to: `[[${LAND}]]`, rel: "related" },
    });
    const noteAfter = (await reg.call("links.remove", human, {
      from: note.frontmatter.id,
      to: `[[${LAND}]]`,
      rel: "related",
    })) as ReturnType<Library["getNote"]>;
    expect(noteAfter.frontmatter.links).toEqual([]);
  });
});

describe("findMentions", () => {
  it("matches an author with the given name, a citekey and a full title, and nothing else", async () => {
    const { lib } = await setup();
    const hit = (text: string) => findMentions(lib, ACCELERATE, text).map((m) => m.citekey);
    expect(hit(QUOTE)).toEqual([LAND]);
    expect(hit("As Land argues in 2012, hierarchy is natural.")).toEqual([LAND]);
    expect(hit("Siehe @land2012dark für den Einwand.")).toEqual([LAND]);
    expect(hit("In The Dark Enlightenment geht es um Hierarchie.")).toEqual([LAND]);
    // a common word, a namesake and the family name alone are no match
    expect(hit("The land reform of 1990 gave farmers title to the fields.")).toEqual([]);
    expect(hit("Das Land Tirol hat entschieden.")).toEqual([]);
    expect(hit("Land argues for hierarchy.")).toEqual([]);
    // the item the card comes from never matches
    expect(findMentions(lib, LAND, "Nick Land, The Dark Enlightenment")).toEqual([]);
  });
});

describe("links.suggest", () => {
  const answer = {
    suggestions: [
      {
        to: `[[${LAND}]]`,
        rel: "opposes",
        why: "Die Karte lehnt Lands Beschleunigung ab.",
      },
    ],
  };

  it("stores a suggestion as a proposed link and sends the card text and the match to the model", async () => {
    const { reg, mock, links, lib, card } = await setup();
    mock.set("card.suggestLinks", answer);
    const out = (await reg.call("links.suggest", human, { card })) as { job: string };
    expect(out.job).toMatch(/^j_/);
    await links.detached?.idle();

    const forCard = (await reg.call("links.forCard", human, { card })) as {
      links: Array<{ status: string; rel: string; to: string; by: string }>;
    };
    expect(forCard.links).toMatchObject([
      { status: "proposed", rel: "opposes", to: LAND, by: "agent:mock" },
    ]);
    const prompt = mock.calls[0]?.prompt ?? "";
    expect(prompt).toContain(`ref: [[${LAND}]]`);
    expect(prompt).toContain("given");
    expect(mock.calls[0]?.language).toBe("de");
    expect(lib.index.all("SELECT 1 FROM links WHERE status = 'proposed'")).toHaveLength(1);
  });

  it("never creates an accepted link on its own and asks no model when nothing matches", async () => {
    const { reg, mock, links, lib, card } = await setup();
    mock.set("card.suggestLinks", answer);
    links.autoSuggest(card);
    await links.detached?.idle();
    expect(
      lib.index.all(
        "SELECT 1 FROM links WHERE src_kind = 'card' AND origin = 'frontmatter' AND status = 'accepted'",
      ),
    ).toHaveLength(0);

    const quiet = cardData(ACCELERATE, "Nothing in here names a source of the library.");
    lib.writeCard(quiet.fm, quiet.body);
    const before = mock.calls.length;
    links.autoSuggest(quiet.fm.id);
    await links.detached?.idle();
    expect(mock.calls.length).toBe(before);
    expect(
      ((await reg.call("links.forCard", human, { card: quiet.fm.id })) as { links: unknown[] })
        .links,
    ).toEqual([]);
  });

  it("does not propose a rejected suggestion again", async () => {
    const { reg, mock, links, lib, card } = await setup();
    mock.set("card.suggestLinks", answer);
    await reg.call("links.suggest", human, { card });
    await links.detached?.idle();
    const one = (await reg.call("links.forCard", human, { card })) as {
      links: Array<{ note: string; index: number }>;
    };
    const first = one.links[0];
    await reg.call("links.decide", human, {
      note: first?.note,
      accept: [],
      reject: [first?.index],
    });

    // rejected links are not listed, but they stay in the file as memory
    expect(
      ((await reg.call("links.forCard", human, { card })) as { links: unknown[] }).links,
    ).toEqual([]);
    expect(readFileSync(lib.getNote(first?.note ?? "").path, "utf8")).toContain("status: rejected");

    const before = mock.calls.length;
    await reg.call("links.suggest", human, { card });
    await links.detached?.idle();
    expect(mock.calls.length).toBe(before); // no candidate is left, so no model call
    expect(
      ((await reg.call("links.forCard", human, { card })) as { links: unknown[] }).links,
    ).toEqual([]);
  });

  it("turns a suggestion into a link when the user accepts it, and drops it when they link by hand", async () => {
    const { reg, mock, links, lib, card } = await setup();
    mock.set("card.suggestLinks", answer);
    await reg.call("links.suggest", human, { card });
    await links.detached?.idle();
    const first = (
      (await reg.call("links.forCard", human, { card })) as {
        links: Array<{ note: string; index: number }>;
      }
    ).links[0];
    await reg.call("links.decide", human, {
      note: first?.note,
      accept: [first?.index],
      reject: [],
    });
    const accepted = (await reg.call("links.forCard", human, { card })) as {
      links: Array<{ status: string }>;
    };
    expect(accepted.links).toMatchObject([{ status: "accepted" }]);

    // a second card: the person links by hand while a suggestion is open
    const other = cardData(ACCELERATE, `Gegen ${QUOTE}`);
    lib.writeCard(other.fm, other.body);
    await reg.call("links.suggest", human, { card: other.fm.id });
    await links.detached?.idle();
    await reg.call("links.create", human, {
      from: other.fm.id,
      link: { to: `[[${LAND}]]`, rel: "qualifies" },
    });
    const own = (await reg.call("links.forCard", human, { card: other.fm.id })) as {
      links: Array<{ status: string; rel: string }>;
    };
    expect(own.links).toMatchObject([{ status: "accepted", rel: "qualifies" }]);
  });

  it("keeps to two open suggestions per card", async () => {
    const { reg, mock, links, lib, root, card } = await setup();
    for (const key of ["a1xx", "b2xx", "c3xx"]) {
      writeRaw(
        root,
        `items/${key}/${key}.md`,
        itemFile(
          itemData(key, {
            title: `Work ${key}`,
            author: [{ family: "Zeta", given: "Zed" }],
            issued: 2001,
          }),
        ),
      );
    }
    lib.sync();
    const crowded = cardData(ACCELERATE, `${QUOTE} Siehe @a1xx, @b2xx und @c3xx.`);
    lib.writeCard(crowded.fm, crowded.body);
    mock.set("card.suggestLinks", {
      suggestions: ["a1xx", "b2xx", "c3xx", LAND].map((to) => ({
        to: `[[${to}]]`,
        rel: "related",
        why: "Die Karte nennt dieses Werk.",
      })),
    });
    await reg.call("links.suggest", human, { card: crowded.fm.id });
    await links.detached?.idle();
    const out = (await reg.call("links.forCard", human, { card: crowded.fm.id })) as {
      links: unknown[];
    };
    expect(out.links).toHaveLength(2);
    expect(card).toBeTruthy();
  });
});
