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

const human = { actor: "human" as Actor };
const LUHMANN = "luhmann1984soziale";
const TEUBNER = "teubner1987autopoietic";

const open: Library[] = [];
afterEach(async () => {
  for (const l of open.splice(0)) await l.close();
  cleanTmpDirs();
});

async function setup(noteBody?: string) {
  const root = tmpDir("cg-links-");
  const lib = await Library.init(root, { watch: false, localBase: tmpDir("cg-local-") });
  open.push(lib);
  for (const [citekey, title] of [
    [LUHMANN, "Soziale Systeme"],
    [TEUBNER, "Autopoietic Law"],
  ] as const) {
    writeRaw(
      root,
      `items/${citekey}/${citekey}.md`,
      itemFile(itemData(citekey, { title, abstract: `Abstract of ${title}` })),
    );
  }
  const card = cardData(LUHMANN, "Kommunikation ist die Operation sozialer Systeme.");
  writeRaw(root, `items/${LUHMANN}/cards/${card.fm.id}.md`, cardFile(card));
  lib.sync();
  const mock = new MockBackend({ "note.proposeLinks": { proposals: [] } });
  const ai = new AiRouter([mock], { routing: { "*": "mock" } });
  const reg = bindLinkOperations(bindCoreOperations(new Registry(), lib), lib, { ai });
  const note = lib.createNote("human", {
    title: "Autopoiesis",
    body:
      noteBody ??
      `Siehe [[${LUHMANN}]] und dagegen [[${TEUBNER}]]. Nicht vorhanden: [[erfunden2000]].`,
    type: "permanent",
    projects: [],
  });
  return { lib, reg, mock, links: reg.links, note, card: card.fm.id, root };
}

const rawLinks = (path: string) => {
  const text = readFileSync(path, "utf8");
  return text;
};

describe("links.propose", () => {
  it("returns a job at once and writes proposals into the frontmatter", async () => {
    const { reg, mock, links, lib, note, card } = await setup();
    mock.set("note.proposeLinks", {
      proposals: [
        {
          to: `[[${LUHMANN}]]`,
          rel: "supports",
          why: "Die Notiz stützt sich auf die These.",
          evidence: `[[${card}]]`,
        },
        { to: `[[${TEUBNER}]]`, rel: "opposes", why: "Der Einwand richtet sich gegen die These." },
        { to: "[[erfunden2000]]", rel: "related", why: "Gibt es nicht." },
      ],
    });
    const out = (await reg.call("links.propose", human, { note: note.frontmatter.id })) as {
      job: string;
    };
    expect(out.job).toMatch(/^j_/);
    expect(lib.getNote(note.frontmatter.id).frontmatter.links).toEqual([]);

    await links.detached?.idle();
    const after = lib.getNote(note.frontmatter.id);
    expect(after.frontmatter.links).toEqual([
      {
        to: `[[${LUHMANN}]]`,
        rel: "supports",
        why: "Die Notiz stützt sich auf die These.",
        evidence: `[[${card}]]`,
        by: "agent:mock",
        status: "proposed",
      },
      {
        to: `[[${TEUBNER}]]`,
        rel: "opposes",
        why: "Der Einwand richtet sich gegen die These.",
        by: "agent:mock",
        status: "proposed",
      },
    ]);
    expect(after.frontmatter.modified?.by).toBe("agent:mock");
    expect(after.body).toContain("Siehe [[luhmann1984soziale]]");
    expect(rawLinks(after.path)).toContain("status: proposed");
  });

  it("sends the note, the linked items, their cards and the language to the model", async () => {
    const { reg, mock, links, note, card } = await setup();
    await reg.call("links.propose", human, { note: note.frontmatter.id });
    await links.detached?.idle();
    const prompt = mock.calls[0]?.prompt ?? "";
    expect(prompt).toContain(`ref: [[${LUHMANN}]]`);
    expect(prompt).toContain("summary: Abstract of Soziale Systeme");
    expect(prompt).toContain(`ref: [[${card}]]`);
    expect(prompt).not.toContain("ref: [[erfunden2000]]");
    expect(mock.calls[0]?.language).toBe("de");
  });

  it("does not propose a typed link the note already has", async () => {
    const { reg, mock, links, lib, note } = await setup();
    mock.set("note.proposeLinks", {
      proposals: [{ to: `[[${LUHMANN}]]`, rel: "supports", why: "Erste Fassung." }],
    });
    await reg.call("links.propose", human, { note: note.frontmatter.id });
    await links.detached?.idle();
    await reg.call("links.propose", human, { note: note.frontmatter.id });
    await links.detached?.idle();
    expect(lib.getNote(note.frontmatter.id).frontmatter.links).toHaveLength(1);
    expect(mock.calls[1]?.prompt).toContain(`- [[${LUHMANN}]] supports`);
  });

  it("finishes without a model call when the note links to nothing known", async () => {
    const { reg, mock, links, lib, note } = await setup("Nur Text und [[erfunden2000]].");
    await reg.call("links.propose", human, { note: note.frontmatter.id });
    await links.detached?.idle();
    expect(mock.calls).toHaveLength(0);
    expect(lib.getNote(note.frontmatter.id).frontmatter.links).toEqual([]);
  });

  it("fails fast for an unknown note", async () => {
    const { reg } = await setup();
    await expect(reg.call("links.propose", human, { note: "n_0000000000000000" })).rejects.toThrow(
      /no note/,
    );
  });

  it("marks the job failed and leaves the note alone when the model fails", async () => {
    const { reg, mock, links, lib, note } = await setup();
    mock.set("note.proposeLinks", { nonsense: true });
    await reg.call("links.propose", human, { note: note.frontmatter.id });
    await links.detached?.idle();
    const jobs = [...(links.detached?.jobs.values() ?? [])];
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe("failed");
    expect(lib.getNote(note.frontmatter.id).frontmatter.links).toEqual([]);
  });
});

describe("links.decide", () => {
  async function withProposals() {
    const s = await setup();
    s.mock.set("note.proposeLinks", {
      proposals: [
        { to: `[[${LUHMANN}]]`, rel: "supports", why: "Erstens." },
        { to: `[[${TEUBNER}]]`, rel: "opposes", why: "Zweitens." },
        { to: `[[${TEUBNER}]]`, rel: "qualifies", why: "Drittens." },
      ],
    });
    await s.reg.call("links.propose", human, { note: s.note.frontmatter.id });
    await s.links.detached?.idle();
    return s;
  }

  it("accepts and rejects by index in one call", async () => {
    const { reg, lib, note } = await withProposals();
    const out = (await reg.call("links.decide", human, {
      note: note.frontmatter.id,
      accept: [0],
      reject: [1],
    })) as ReturnType<Library["getNote"]>;
    expect(out.frontmatter.links.map((l) => [l.rel, l.status])).toEqual([
      ["supports", "accepted"],
      ["qualifies", "proposed"],
    ]);
    expect(out.frontmatter.links[0]?.by).toBe("agent:mock");
    expect(out.frontmatter.modified?.by).toBe("human");
    expect(
      lib.index.all("SELECT 1 FROM links WHERE origin = 'frontmatter' AND status = 'accepted'"),
    ).toHaveLength(1);
  });

  it("rejects bad indexes, double decisions and links that are already accepted", async () => {
    const { reg, note } = await withProposals();
    const id = note.frontmatter.id;
    await expect(
      reg.call("links.decide", human, { note: id, accept: [7], reject: [] }),
    ).rejects.toThrow(/no link at index 7/);
    await expect(
      reg.call("links.decide", human, { note: id, accept: [0], reject: [0] }),
    ).rejects.toThrow(/both in accept and in reject/);
    await reg.call("links.decide", human, { note: id, accept: [0], reject: [] });
    await expect(
      reg.call("links.decide", human, { note: id, accept: [], reject: [0] }),
    ).rejects.toThrow(/already accepted/);
  });

  it("changes nothing when both lists are empty", async () => {
    const { reg, lib, note } = await withProposals();
    const before = readFileSync(lib.getNote(note.frontmatter.id).path, "utf8");
    await reg.call("links.decide", human, { note: note.frontmatter.id, accept: [], reject: [] });
    expect(readFileSync(lib.getNote(note.frontmatter.id).path, "utf8")).toBe(before);
  });
});
