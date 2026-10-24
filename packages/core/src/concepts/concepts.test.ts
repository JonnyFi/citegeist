import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AiRouter, MockBackend, unmark } from "@citegeist/ai";
import type { Concept, ConceptProposal, ConceptSummary } from "@citegeist/ops";
import { Registry } from "@citegeist/ops";
import type { Actor } from "@citegeist/schema";
import { afterEach, describe, expect, it } from "vitest";
import { classify } from "../classify.js";
import { Library } from "../library.js";
import { listNotes } from "../notes/index.js";
import { bindCoreOperations } from "../ops.js";
import {
  cardData,
  cardFile,
  cleanTmpDirs,
  itemData,
  itemFile,
  noteData,
  noteFile,
  tmpDir,
  writeRaw,
} from "../test-helpers.js";
import { recurringTerms } from "./candidates.js";
import { dedupeAliases, nameMatches, normName } from "./names.js";
import { bindConceptOperations } from "./ops.js";
import { composeBody, splitBody } from "./render.js";
import type { ConceptService } from "./service.js";

const LUHMANN = "luhmann1984soziale";
const MATURANA = "maturana1980autopoiesis";
const KESSLER = "kessler2019aging";

const Q_LUH_DEF =
  "Autopoietische Systeme sind Systeme, die die Elemente, aus denen sie bestehen, durch die Elemente, aus denen sie bestehen, selbst produzieren.";
const Q_LUH_USE =
  "Wir übertragen den Begriff der Autopoiesis auf soziale Systeme. Soziale Systeme reproduzieren sich durch Kommunikation, die an Kommunikation anschließt.";
const Q_MAT_DEF =
  "An autopoietic machine is a machine organized as a network of processes of production of components that continuously regenerate the network.";
const Q_MAT_USE =
  "Living systems are autopoietic machines, and the notion of autopoiesis is necessary and sufficient to characterize their organization.";
const Q_KES = "We recruited participants through three community centers between March and June.";
const Q_LUH_KONT =
  "Doppelte Kontingenz ist der Ausgangspunkt der Bildung sozialer Systeme, weil jeder Beteiligte sein Handeln vom Handeln des anderen abhängig macht.";

const open: Library[] = [];
afterEach(async () => {
  for (const l of open.splice(0)) await l.close();
  cleanTmpDirs();
});

interface Req {
  prompt: string;
}

/** Quotes the first 45 characters of the first passage and says the term is used. */
function describeFirst(req: Req) {
  const m = /\[(c_[^\]]+)\][^\n]*\n"""\n([\s\S]*?)\n"""/.exec(req.prompt);
  const ref = m?.[1] ?? "";
  return {
    role: /\(kind: definition\)/.test(req.prompt) ? "defines" : "uses",
    text: `Die Quelle verwendet den Begriff (${ref}).`,
    evidence: [{ ref, quote: (m?.[2] ?? "").slice(0, 45) }],
  };
}

function nameFor(req: Req) {
  if (unmark(req.prompt).includes("autopoietic machine")) {
    return { term: "autopoietic machine", aliases: [] };
  }
  if (unmark(req.prompt).includes("Autopoietische Systeme")) {
    return { term: "Autopoietisches System", aliases: [] };
  }
  return { term: "", aliases: [] };
}

async function setup() {
  const lib = await Library.init(tmpDir("cg-concepts-"), {
    name: "Test",
    watch: false,
    localBase: tmpDir("cg-local-"),
  });
  open.push(lib);
  for (const [key, title] of [
    [LUHMANN, "Soziale Systeme"],
    [MATURANA, "Autopoiesis and Cognition"],
    [KESSLER, "Aging and Social Participation"],
  ] as const) {
    writeRaw(lib.root, `items/${key}/${key}.md`, itemFile(itemData(key, { title })));
  }
  const cards: Record<string, string> = {};
  const addCard = (name: string, item: string, quote: string, extra: Record<string, unknown>) => {
    const card = cardData(item, quote, extra);
    cards[name] = card.fm.id;
    writeRaw(lib.root, `items/${item}/cards/${card.fm.id}.md`, cardFile(card));
  };
  addCard("luhDef", LUHMANN, Q_LUH_DEF, {
    kind: "definition",
    locator: { label: "page", start: "60", confirmed: true },
  });
  addCard("luhUse", LUHMANN, Q_LUH_USE, {
    locator: { label: "page", start: "61", confirmed: true },
  });
  addCard("luhKont", LUHMANN, Q_LUH_KONT, {
    locator: { label: "page", start: "148", confirmed: true },
  });
  addCard("matDef", MATURANA, Q_MAT_DEF, {
    kind: "definition",
    locator: { label: "page", start: "78", confirmed: true },
  });
  addCard("matUse", MATURANA, Q_MAT_USE, {
    locator: { label: "page", start: "79", confirmed: true },
  });
  addCard("kes", KESSLER, Q_KES, { locator: { label: "page", start: "114", confirmed: true } });
  lib.sync();

  const mock = new MockBackend({
    "concept.describe": describeFirst,
    "concept.name": nameFor,
  });
  const ai = new AiRouter([mock], { routing: { "*": "mock" } });
  const registry = bindConceptOperations(bindCoreOperations(new Registry(), lib), lib, {
    ai,
    now: () => new Date("2026-11-01T10:00:00.000Z"),
  });
  const service = registry.concepts as ConceptService;
  const call = <T>(name: string, input: unknown, actor: Actor = "human") =>
    registry.call(name, { actor }, input) as Promise<T>;
  return { lib, mock, registry, service, call, cards };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const create = (s: Setup, input: Record<string, unknown>) =>
  s.call<{ concept: Concept; merged: boolean }>("concepts.create", input);

const get = async (s: Setup, id: string) =>
  (await s.call<{ concept: Concept }>("concepts.get", { id })).concept;

async function runJob<T>(s: Setup, job: string): Promise<T> {
  await s.service.detached?.idle();
  const j = s.service.detached?.jobs.get(job);
  if (j?.status !== "succeeded") {
    throw new Error(`job ${job} ${j?.status}: ${j?.error?.message}`);
  }
  return j.result as T;
}

describe("concept files", () => {
  it("live in notes/concepts as notes of type concept with aliases and member cards", async () => {
    const s = await setup();
    const { concept, merged } = await create(s, {
      term: "Autopoiesis",
      aliases: ["Autopoiese", "autopoiesis"],
    });
    expect(merged).toBe(false);
    expect(concept.title).toBe("Autopoiesis");
    // "autopoiesis" repeats the title and is dropped
    expect(concept.aliases).toEqual(["Autopoiese"]);
    expect(concept.path).toBe(join(s.lib.root, "notes/concepts/autopoiesis.md"));
    expect(concept.slug).toBe("autopoiesis");
    // cards that contain the term (by stem) are collected, the unrelated one is not
    expect(concept.cards.sort()).toEqual([s.cards.luhUse, s.cards.matUse].sort());
    expect(concept.sources).toBe(2);
    expect(concept.open).toBe(2);

    const raw = readFileSync(concept.path, "utf8");
    expect(raw).toMatch(/^---\n[\s\S]*\ntype: concept\n/);
    expect(raw).toContain("aliases:\n  - Autopoiese");

    const notes = listNotes(s.lib, { limit: 10 });
    expect(notes).toEqual([expect.objectContaining({ type: "concept", slug: "autopoiesis" })]);
    expect(classify("notes/concepts/autopoiesis.md")).toEqual({ kind: "note", key: "autopoiesis" });
  });

  it("find a concept by alias in search", async () => {
    const s = await setup();
    await create(s, { term: "Autopoiesis", aliases: ["Selbstherstellung"] });
    const hits = s.lib.search({ q: "Selbstherstellung", kinds: ["note"], limit: 5 });
    expect(hits.map((h) => h.title)).toEqual(["Autopoiesis"]);
  });

  it("take explicit cards and skip collecting when asked", async () => {
    const s = await setup();
    const { concept } = await create(s, {
      term: "Autopoiesis",
      cards: [s.cards.matDef],
      collect: false,
    });
    expect(concept.cards).toEqual([s.cards.matDef]);
    await expect(create(s, { term: "Anderes", cards: ["c_01JB8Z3QK7ABCDEFGH"] })).rejects.toThrow(
      /CARD_NOT_FOUND|no card/,
    );
  });
});

describe("alias merge", () => {
  it("extends the concept that already has the term or an alias instead of making a twin", async () => {
    const s = await setup();
    const first = await create(s, { term: "Autopoiesis", aliases: ["Autopoiese"] });

    // the same alias, in another spelling: case and accents do not matter
    const again = await create(s, { term: "AUTOPOIESE", collect: false });
    expect(again.merged).toBe(true);
    expect(again.concept.id).toBe(first.concept.id);
    expect(again.concept.aliases).toEqual(["Autopoiese"]);

    // a new term that names an old alias becomes an alias of the old concept
    const third = await create(s, {
      term: "Selbstorganisation",
      aliases: ["autopoiese"],
      cards: [s.cards.luhDef],
    });
    expect(third.merged).toBe(true);
    expect(third.concept.id).toBe(first.concept.id);
    expect(third.concept.title).toBe("Autopoiesis");
    expect(third.concept.aliases).toEqual(["Autopoiese", "Selbstorganisation"]);
    expect(third.concept.cards).toContain(s.cards.luhDef);

    expect(
      (await s.call<{ concepts: ConceptSummary[] }>("concepts.list", {})).concepts,
    ).toHaveLength(1);
  });

  it("refuses names that belong to two different concepts", async () => {
    const s = await setup();
    await create(s, { term: "Autopoiesis", collect: false });
    await create(s, { term: "Kontingenz", aliases: ["Zufälligkeit"], collect: false });
    await expect(
      create(s, { term: "Autopoiesis", aliases: ["zufaelligkeit"], collect: false }),
    ).rejects.toThrow(/CONCEPT_AMBIGUOUS|different concepts/);
  });

  it("merges concepts: titles become aliases, cards unite, links follow, the source file goes", async () => {
    const s = await setup();
    const a = await create(s, { term: "Autopoiesis", aliases: ["Autopoiese"] });
    const b = await create(s, {
      term: "Selbstreferenz",
      aliases: ["Selbstbezug"],
      cards: [s.cards.luhDef],
      collect: false,
    });
    await s.call("concepts.update", {
      id: b.concept.id,
      ops: [{ op: "setNote", note: "Siehe auch Maturana." }],
    });
    // a note links to the concept that is about to disappear, by file name and by id
    s.lib.createNote("human", {
      title: "Lesenotiz",
      body: `Zu [[selbstreferenz]] und [[${b.concept.id}]] und [[autopoiesis]].`,
      type: "permanent",
      projects: [],
    });
    const bPath = b.concept.path;
    expect(existsSync(bPath)).toBe(true);

    const merged = await s.call<{ concept: Concept }>("concepts.merge", {
      into: a.concept.id,
      from: [b.concept.id],
    });
    const c = merged.concept;
    expect(c.id).toBe(a.concept.id);
    expect(c.title).toBe("Autopoiesis");
    expect(c.aliases).toEqual(["Autopoiese", "Selbstreferenz", "Selbstbezug"]);
    expect(c.cards).toContain(s.cards.luhDef);
    expect(c.cards).toContain(s.cards.matUse);
    expect(c.note).toBe("Siehe auch Maturana.");
    expect(existsSync(bPath)).toBe(false);
    expect(
      (await s.call<{ concepts: ConceptSummary[] }>("concepts.list", {})).concepts,
    ).toHaveLength(1);
    expect(() => s.lib.getNote(b.concept.id)).toThrow(/NOTE_NOT_FOUND|no note/);

    expect(readFileSync(join(s.lib.root, "notes/lesenotiz.md"), "utf8")).toContain(
      `Zu [[autopoiesis]] und [[${a.concept.id}]] und [[autopoiesis]].`,
    );

    // the merged names now resolve to the target
    const again = await create(s, { term: "Selbstbezug", collect: false });
    expect(again.merged).toBe(true);
    expect(again.concept.id).toBe(a.concept.id);
  });

  it("keeps entries of both concepts when they are merged and marks shared sources stale", async () => {
    const s = await setup();
    const a = await create(s, { term: "Autopoiesis", cards: [s.cards.luhUse], collect: false });
    const b = await create(s, {
      term: "Autopoietisches System",
      cards: [s.cards.luhDef, s.cards.matDef],
      collect: false,
    });
    for (const id of [a.concept.id, b.concept.id]) {
      const { job } = await s.call<{ job: string }>("concepts.describe", { id });
      await runJob(s, job);
    }
    const merged = (
      await s.call<{ concept: Concept }>("concepts.merge", {
        into: a.concept.id,
        from: [b.concept.id],
      })
    ).concept;
    const byItem = new Map(merged.usages.map((u) => [u.item, u]));
    expect([...byItem.keys()].sort()).toEqual([LUHMANN, MATURANA]);
    // Luhmann had an entry on both sides: the target's stays, and it no longer covers all cards
    expect(byItem.get(LUHMANN)?.stale).toBe(true);
    // Maturana only had one on the merged side and its cards did not change
    expect(byItem.get(MATURANA)?.stale).toBe(false);
  });
});

describe("rename", () => {
  it("moves the file, keeps the old name as alias and rewrites links to it", async () => {
    const s = await setup();
    const { concept } = await create(s, { term: "Autopoiese", collect: false });
    s.lib.createNote("human", {
      title: "Verweis",
      body: "Siehe [[autopoiese]].",
      type: "permanent",
      projects: [],
    });
    const out = await s.call<{ concept: Concept }>("concepts.update", {
      id: concept.id,
      ops: [{ op: "rename", title: "Autopoiesis" }],
    });
    expect(out.concept.title).toBe("Autopoiesis");
    expect(out.concept.aliases).toEqual(["Autopoiese"]);
    expect(out.concept.slug).toBe("autopoiesis");
    expect(out.concept.path).toBe(join(s.lib.root, "notes/concepts/autopoiesis.md"));
    expect(existsSync(join(s.lib.root, "notes/concepts/autopoiese.md"))).toBe(false);
    expect(readFileSync(join(s.lib.root, "notes/verweis.md"), "utf8")).toContain("[[autopoiesis]]");
  });

  it("refuses a name another concept has", async () => {
    const s = await setup();
    await create(s, { term: "Autopoiesis", collect: false });
    const other = await create(s, { term: "Kontingenz", collect: false });
    await expect(
      s.call("concepts.update", {
        id: other.concept.id,
        ops: [{ op: "addAlias", alias: "autopoiesis" }],
      }),
    ).rejects.toThrow(/CONCEPT_NAME_TAKEN|already a name/);
  });

  it("edits aliases, cards and the note", async () => {
    const s = await setup();
    const { concept } = await create(s, { term: "Autopoiesis", collect: false });
    const out = await s.call<{ concept: Concept }>("concepts.update", {
      id: concept.id,
      ops: [
        { op: "addAlias", alias: "Selbstherstellung" },
        { op: "addAlias", alias: "Autopoiese" },
        { op: "removeAlias", alias: "selbstherstellung" },
        { op: "addCards", cards: [s.cards.luhUse, s.cards.matUse] },
        { op: "removeCards", cards: [s.cards.luhUse] },
        { op: "setNote", note: "Mein Gedanke." },
      ],
    });
    expect(out.concept.aliases).toEqual(["Autopoiese"]);
    expect(out.concept.cards).toEqual([s.cards.matUse]);
    expect(out.concept.note).toBe("Mein Gedanke.");
    expect(readFileSync(out.concept.path, "utf8")).toContain("Mein Gedanke.");
  });
});

describe("concepts.describe", () => {
  it("writes one entry per source from the member cards, with verified quotes and pages", async () => {
    const s = await setup();
    const { concept } = await create(s, { term: "Autopoiesis", aliases: ["Autopoiese"] });
    const started = await s.call<{ job: string; sources: number }>("concepts.describe", {
      id: concept.id,
    });
    expect(started.sources).toBe(2);
    const result = await runJob<{ written: number; silent: number; failed: number }>(
      s,
      started.job,
    );
    expect(result).toEqual({ written: 2, silent: 0, failed: 0 });

    const call = s.mock.calls.find((c) => c.task === "concept.describe");
    expect(call?.language).toBe("de");
    expect(call?.prompt).toContain("Term: Autopoiesis");
    expect(call?.prompt).toContain("Aliases: Autopoiese");

    const done = await get(s, concept.id);
    expect(done.open).toBe(0);
    expect(done.described).toBe(2);
    const luh = done.usages.find((u) => u.item === LUHMANN);
    expect(luh).toMatchObject({
      role: "uses",
      stale: false,
      promptVersion: 2,
      stamp: { by: "mock:mock-smart", language: "de" },
    });
    expect(luh?.evidence).toEqual([
      { card: s.cards.luhUse, quote: Q_LUH_USE.slice(0, 45), page: "61" },
    ]);
    expect(luh?.basis).toEqual([s.cards.luhUse]);

    const body = readFileSync(done.path, "utf8");
    expect(body).toContain(`## [[${LUHMANN}]]`);
    expect(body).toContain(`## [[${MATURANA}]]`);
    expect(body).toContain(`> [[${s.cards.luhUse}]], S. 61`);
    expect(body).toContain(`> [[${s.cards.matUse}]], S. 79`);
    expect(body).toContain(`> ${Q_LUH_USE.slice(0, 45)}`);
  });

  it("drops an entry whose quote the card does not contain and counts the source as silent", async () => {
    const s = await setup();
    s.mock.set("concept.describe", (req: Req) => {
      const first = describeFirst(req);
      return {
        ...first,
        evidence: [{ ref: first.evidence[0]?.ref, quote: "a sentence the card never says" }],
      };
    });
    const { concept } = await create(s, { term: "Autopoiesis", collect: true });
    const { job } = await s.call<{ job: string }>("concepts.describe", { id: concept.id });
    const result = await runJob<{ written: number; silent: number }>(s, job);
    expect(result).toMatchObject({ written: 0, silent: 2 });
    const after = await get(s, concept.id);
    expect(after.usages).toEqual([]);
    expect(readFileSync(after.path, "utf8")).not.toContain("concept:entries");
  });

  it("stores the card text for a quote that differs in case, quotes and spacing", async () => {
    const s = await setup();
    s.mock.set("concept.describe", (req: Req) => {
      const ref = /\[(c_[^\]]+)\]/.exec(req.prompt)?.[1] ?? "";
      return {
        role: "uses",
        text: "Eintrag.",
        evidence: [{ ref: `[${ref}]`, quote: "WIR  ÜBERTRAGEN den Begriff der AUTOPOIESIS" }],
      };
    });
    const { concept } = await create(s, {
      term: "Autopoiesis",
      cards: [s.cards.luhUse],
      collect: false,
    });
    const { job } = await s.call<{ job: string }>("concepts.describe", { id: concept.id });
    await runJob(s, job);
    const after = await get(s, concept.id);
    expect(after.usages[0]?.evidence[0]?.quote).toBe("Wir übertragen den Begriff der Autopoiesis");
  });

  it("only describes missing or stale sources, and everything with force", async () => {
    const s = await setup();
    const { concept } = await create(s, { term: "Autopoiesis" });
    const describeCalls = () => s.mock.calls.filter((c) => c.task === "concept.describe").length;
    await runJob(s, (await s.call<{ job: string }>("concepts.describe", { id: concept.id })).job);
    expect(describeCalls()).toBe(2);

    const nothing = await s.call<{ job: string; sources: number }>("concepts.describe", {
      id: concept.id,
    });
    expect(nothing.sources).toBe(0);
    await runJob(s, nothing.job);
    expect(describeCalls()).toBe(2);

    // another Luhmann card joins: only his entry is out of date
    await s.call("concepts.update", {
      id: concept.id,
      ops: [{ op: "addCards", cards: [s.cards.luhDef] }],
    });
    const stale = await get(s, concept.id);
    expect(stale.usages.filter((u) => u.stale).map((u) => u.item)).toEqual([LUHMANN]);
    expect(stale.open).toBe(1);
    const again = await s.call<{ job: string; sources: number }>("concepts.describe", {
      id: concept.id,
    });
    expect(again.sources).toBe(1);
    await runJob(s, again.job);
    expect(describeCalls()).toBe(3);
    const fresh = await get(s, concept.id);
    expect(fresh.open).toBe(0);
    expect(fresh.usages.find((u) => u.item === LUHMANN)?.basis.sort()).toEqual(
      [s.cards.luhDef, s.cards.luhUse].sort(),
    );

    const forced = await s.call<{ job: string; sources: number }>("concepts.describe", {
      id: concept.id,
      force: true,
    });
    expect(forced.sources).toBe(2);
    await runJob(s, forced.job);
    expect(describeCalls()).toBe(5);
  });

  it("drops the entry of a source whose cards were all removed", async () => {
    const s = await setup();
    const { concept } = await create(s, { term: "Autopoiesis" });
    await runJob(s, (await s.call<{ job: string }>("concepts.describe", { id: concept.id })).job);
    const out = await s.call<{ concept: Concept }>("concepts.update", {
      id: concept.id,
      ops: [{ op: "removeCards", cards: [s.cards.matUse] }],
    });
    expect(out.concept.usages.map((u) => u.item)).toEqual([LUHMANN]);
    expect(readFileSync(out.concept.path, "utf8")).not.toContain(`[[${MATURANA}]]`);
  });

  it("does not store an entry when the cards changed while the model worked", async () => {
    const s = await setup();
    const { concept } = await create(s, {
      term: "Autopoiesis",
      cards: [s.cards.luhUse],
      collect: false,
    });
    s.mock.set("concept.describe", async (req: Req) => {
      await s.call("concepts.update", {
        id: concept.id,
        ops: [{ op: "addCards", cards: [s.cards.luhDef] }],
      });
      return describeFirst(req);
    });
    const { job } = await s.call<{ job: string }>("concepts.describe", { id: concept.id });
    const result = await runJob<{ written: number; silent: number }>(s, job);
    expect(result).toMatchObject({ written: 0, silent: 1 });
    expect((await get(s, concept.id)).usages).toEqual([]);
  });

  it("reports a failing model as a failed source and keeps going", async () => {
    const s = await setup();
    let n = 0;
    s.mock.set("concept.describe", (req: Req) => {
      n++;
      if (n === 1) throw new Error("backend down");
      return describeFirst(req);
    });
    const { concept } = await create(s, { term: "Autopoiesis" });
    const { job } = await s.call<{ job: string }>("concepts.describe", { id: concept.id });
    const result = await runJob<{ written: number; failed: number }>(s, job);
    expect(result).toMatchObject({ written: 1, failed: 1 });
  });
});

describe("concepts.propose", () => {
  it("names definition cards with the model, finds recurring terms and skips known names", async () => {
    const s = await setup();
    // a card that mentions a term in two sources
    const extra = cardData(KESSLER, "Die Kontingenz der Teilnahme wurde nicht untersucht.", {
      locator: { label: "page", start: "5", confirmed: true },
    });
    writeRaw(s.lib.root, `items/${KESSLER}/cards/${extra.fm.id}.md`, cardFile(extra));
    s.lib.sync();
    s.lib.createNote("human", {
      title: "Gedanke",
      body: "Kontingenz hängt mit Beobachtung zusammen.",
      type: "permanent",
      projects: [],
    });

    const { job } = await s.call<{ job: string }>("concepts.propose", { limit: 30 });
    const { proposals } = await runJob<{ proposals: ConceptProposal[] }>(s, job);

    const defs = proposals.filter((p) => p.origin === "definition");
    expect(defs.map((p) => p.term).sort()).toEqual([
      "Autopoietisches System",
      "autopoietic machine",
    ]);
    expect(defs.find((p) => p.term === "autopoietic machine")).toMatchObject({
      cards: [s.cards.matDef],
      sources: [MATURANA],
    });
    expect(s.mock.calls.filter((c) => c.task === "concept.name")).toHaveLength(2);

    const recurring = proposals.filter((p) => p.origin === "recurring").map((p) => p.term);
    expect(recurring).toContain("Kontingenz");

    // a concept that has the name makes the proposal an extension of that concept
    const known = await create(s, { term: "Kontingenz", collect: false });
    const again = await runJob<{ proposals: ConceptProposal[] }>(
      s,
      (await s.call<{ job: string }>("concepts.propose", { limit: 30 })).job,
    );
    expect(
      again.proposals.filter((p) => p.origin === "recurring").map((p) => p.term),
    ).not.toContain("Kontingenz");
    expect(known.concept.title).toBe("Kontingenz");
  });

  it("drops a term the model made up and flags one a concept already has", async () => {
    const s = await setup();
    s.mock.set("concept.name", (req: Req) =>
      unmark(req.prompt).includes("autopoietic machine")
        ? { term: "Quantenverschränkung", aliases: [] }
        : { term: "Autopoietisches System", aliases: ["Phantasiebegriff"] },
    );
    const known = await create(s, { term: "Autopoietisches System", collect: false });
    const { job } = await s.call<{ job: string }>("concepts.propose", { limit: 30 });
    const { proposals } = await runJob<{ proposals: ConceptProposal[] }>(s, job);
    const defs = proposals.filter((p) => p.origin === "definition");
    expect(defs).toEqual([
      {
        term: "Autopoietisches System",
        aliases: [],
        origin: "definition",
        cards: [s.cards.luhDef],
        sources: [LUHMANN],
        existing: known.concept.id,
      },
    ]);
  });

  it("leaves cards that already belong to a concept alone", async () => {
    const s = await setup();
    await create(s, { term: "Autopoietisches System", cards: [s.cards.luhDef], collect: false });
    const { job } = await s.call<{ job: string }>("concepts.propose", { limit: 30 });
    const { proposals } = await runJob<{ proposals: ConceptProposal[] }>(s, job);
    expect(proposals.filter((p) => p.origin === "definition").map((p) => p.term)).toEqual([
      "autopoietic machine",
    ]);
  });
});

describe("names", () => {
  it("normalizes case, accents, ß and punctuation", () => {
    expect(normName("  Doppelte  Kontingenz ")).toBe("doppelte kontingenz");
    expect(normName("Straße")).toBe(normName("STRASSE"));
    expect(normName("Zufälligkeit")).toBe("zufaelligkeit");
    expect(normName("Façade")).toBe("facade");
    expect(normName("Retrieval-Augmented Generation")).toBe("retrieval augmented generation");
  });

  it("dedupes aliases against the title and each other", () => {
    expect(dedupeAliases("Autopoiesis", ["autopoiesis", " Autopoiese ", "AUTOPOIESE", ""])).toEqual(
      ["Autopoiese"],
    );
  });

  it("matches a name in a text by stem, and short names only as whole words", () => {
    expect(nameMatches("Soziale Systeme sind selbstreferentiell.", "soziales System")).toBe(true);
    expect(nameMatches("Die doppelte Kontingenz bleibt.", "Doppelte Kontingenz")).toBe(true);
    expect(nameMatches("Kontingenz ist doppelt.", "Doppelte Kontingenz")).toBe(false);
    expect(nameMatches("Wir bauen RAG-Modelle.", "RAG")).toBe(true);
    expect(nameMatches("Das Dragee schmeckt.", "RAG")).toBe(false);
    expect(nameMatches("Alles gut", "")).toBe(false);
  });
});

describe("recurringTerms", () => {
  const texts = [
    { ref: "c1", item: "a", text: "Die doppelte Kontingenz ist der Ausgangspunkt." },
    { ref: "c2", item: "b", text: "Doppelte Kontingenz führt zu Erwartungserwartungen." },
    { ref: "c3", item: "b", text: "Noch einmal doppelte Kontingenz." },
    { ref: "c4", item: "c", text: "Erwartungserwartungen sind selten." },
    { ref: "n1", text: "Kontingenz im Zettelkasten, Erwartungserwartungen auch." },
  ];

  it("ranks terms by the number of sources and ignores repeats within one source", () => {
    const out = recurringTerms(texts, { minSources: 2 });
    // "Kontingenz" alone is part of the longer term with the same sources
    expect(out.map((t) => t.term)).toEqual(["doppelte Kontingenz", "Erwartungserwartungen"]);
    const dk = out.find((t) => t.term === "doppelte Kontingenz");
    expect(dk?.items.sort()).toEqual(["a", "b"]);
    expect(dk?.cards.sort()).toEqual(["c1", "c2", "c3"]);
    const ee = out.find((t) => t.term === "Erwartungserwartungen");
    expect(ee?.items.sort()).toEqual(["b", "c"]);
    // notes add to the count but never to the sources
    expect(ee?.count).toBe(3);
  });

  it("skips short single words, stop words and known names", () => {
    const out = recurringTerms(
      [
        { ref: "1", item: "a", text: "Der Weg ist das Ziel, und das Ziel ist der Weg." },
        { ref: "2", item: "b", text: "Der Weg ist das Ziel." },
      ],
      { minSources: 2 },
    );
    expect(out).toEqual([]);
    const known = recurringTerms(texts, { known: new Set([normName("Erwartungserwartungen")]) });
    expect(known.map((t) => t.term)).not.toContain("Erwartungserwartungen");
  });
});

describe("body", () => {
  it("splits the reader's text from the generated entries and joins them again", () => {
    const body = composeBody(
      "Mein Text.",
      [
        {
          item: LUHMANN,
          role: "uses",
          text: "Eintrag.",
          evidence: [{ card: "c_01JB8Z3QK7ABCDEFGH", quote: "Ein Zitat", page: "5" }],
          basis: [],
          stamp: { by: "mock:x", at: "2026-11-01T10:00:00.000Z" },
        },
      ],
      "en",
    );
    expect(body).toContain("> [[c_01JB8Z3QK7ABCDEFGH]], p. 5");
    const split = splitBody(body);
    expect(split.note).toBe("Mein Text.");
    expect(split.entries).toContain("## [[luhmann1984soziale]]");
    expect(splitBody("Nur Text.")).toEqual({ note: "Nur Text.", entries: "" });
    expect(splitBody(composeBody("", [], "de"))).toEqual({ note: "", entries: "" });
  });

  it("leaves a concept that Obsidian wrote by hand readable", async () => {
    const s = await setup();
    const fm = noteData("Handbegriff", { type: "concept", aliases: ["Hand"] });
    writeRaw(s.lib.root, "notes/concepts/handbegriff.md", noteFile(fm, "Meine Notiz."));
    s.lib.sync();
    const out = await get(s, fm.id);
    expect(out).toMatchObject({
      title: "Handbegriff",
      aliases: ["Hand"],
      note: "Meine Notiz.",
      cards: [],
    });
  });
});
