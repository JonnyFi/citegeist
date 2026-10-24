import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AiRouter, MockBackend } from "@citegeist/ai";
import { Registry } from "@citegeist/ops";
import type { Actor, Matrix } from "@citegeist/schema";
import { afterEach, describe, expect, it } from "vitest";
import { JobQueue } from "../jobs/index.js";
import { Library } from "../library.js";
import { bindCoreOperations } from "../ops.js";
import {
  cardData,
  cardFile,
  cleanTmpDirs,
  itemData,
  itemFile,
  STAMP,
  tmpDir,
  until,
  writeRaw,
} from "../test-helpers.js";
import { aiTaskJobs } from "./jobs.js";
import { parseMatrix } from "./model.js";
import { bindMatrixOperations } from "./ops.js";
import type { MatrixService } from "./service.js";

const HASH = "aaaaaaaaaaaa";
const KESSLER = "kessler2019aging";
const HATTIE = "hattie2007power";
const LUHMANN = "luhmann1984soziale";

const P1 =
  "We recruited participants through three community centers between March and June. Eligibility required age 65 or older and no formal dementia diagnosis. Of 212 people approached, 143 agreed to take part, and 131 completed both sessions.";
const P2A =
  "Each session consisted of a semi-structured interview of about 60 minutes. Interviews were recorded and transcribed verbatim.";
const P2B =
  "Transcripts were coded in two rounds with a scheme developed from the first twenty interviews.";
const P3 =
  "Because recruitment relied on centers that offer organized activities, the sample probably over-represents socially active older adults, and the findings should not be generalized to people who are isolated or housebound.";

const blocks = [
  {
    id: "b3k9x2a1",
    type: "paragraph",
    text: P1,
    spans: [{ page: 0, label: "114", start: 0, end: P1.length }],
  },
  {
    id: "b3k9x2b7",
    type: "paragraph",
    text: `${P2A} ${P2B}`,
    spans: [
      { page: 1, label: "115", start: 0, end: P2A.length + 1 },
      { page: 2, label: "116", start: P2A.length + 1, end: P2A.length + 1 + P2B.length },
    ],
  },
  {
    id: "b3k9x3c4",
    type: "paragraph",
    text: P3,
    spans: [{ page: 2, label: "116", start: 0, end: P3.length }],
  },
].map((b) => ({ ...b, flow: "body", src: { engine: "test" } }));

const docMd = `<!-- page 0 label=114 -->

# Method ^bh000001

${P1} ^b3k9x2a1

<!-- page 1 label=115 -->

${P2A} <!-- p:116 --> ${P2B} ^b3k9x2b7

<!-- page 2 label=116 -->

${P3} ^b3k9x3c4
`;

const open: Library[] = [];
afterEach(async () => {
  for (const l of open.splice(0)) await l.close();
  cleanTmpDirs();
});

interface Req {
  prompt: string;
}

/** Answers with the first passage of the prompt and a quote cut from its start. */
function quoteFirstPassage(req: Req) {
  const m = /\[([^\]]+)\][^\n]*\n"""\n([\s\S]*?)\n"""/.exec(req.prompt);
  const ref = m?.[1] ?? "";
  return { answer: `Antwort zu ${ref}.`, evidence: [{ ref, quote: (m?.[2] ?? "").slice(0, 50) }] };
}

interface Gate {
  wait: Promise<void>;
  release(): void;
}
function gate(): Gate {
  let release: () => void = () => {};
  const wait = new Promise<void>((r) => {
    release = r;
  });
  return { wait, release };
}

async function setup(opts: { queue?: JobQueue } = {}) {
  const lib = await Library.init(tmpDir("cg-matrix-"), {
    name: "Test",
    watch: false,
    localBase: tmpDir("cg-local-"),
  });
  open.push(lib);
  lib.createProject("human", { slug: "phd", title: "PhD proposal", brief: "Brief" });
  lib.updateProject({
    slug: "phd",
    patch: { ai_language: "de", style: "apa", locale: "de-DE" },
  });

  const kessler = itemData(KESSLER, {
    type: "article-journal",
    title: "Aging and Social Participation",
    author: [{ family: "Kessler", given: "Anna" }],
    issued: 2019,
    sources: [{ hash: HASH, kind: "pdf", filename: "kessler.pdf", added: STAMP }],
  });
  writeRaw(lib.root, `items/${KESSLER}/${KESSLER}.md`, itemFile(kessler));
  const dir = `items/${KESSLER}/derived/${HASH}`;
  writeRaw(lib.root, `${dir}/blocks.jsonl`, `${blocks.map((b) => JSON.stringify(b)).join("\n")}\n`);
  writeRaw(lib.root, `${dir}/doc.md`, docMd);

  const hattie = itemData(HATTIE, {
    type: "article-journal",
    title: "The Power of Feedback",
    author: [{ family: "Hattie", given: "John" }],
    issued: 2007,
  });
  writeRaw(lib.root, `items/${HATTIE}/${HATTIE}.md`, itemFile(hattie));
  const card = cardData(
    HATTIE,
    "Feedback that refers to the task and to the next step is clearly more effective than praise of the person.",
    { locator: { label: "page", start: "88", confirmed: true } },
  );
  writeRaw(lib.root, `items/${HATTIE}/cards/${card.fm.id}.md`, cardFile(card));

  writeRaw(
    lib.root,
    `items/${LUHMANN}/${LUHMANN}.md`,
    itemFile(itemData(LUHMANN, { title: "Soziale Systeme", issued: 1984 })),
  );
  lib.sync();

  const mock = new MockBackend({ "matrix.fillCell": { answer: "", evidence: [] } });
  const ai = new AiRouter([mock], { routing: { "*": "mock" } });
  const jobs = opts.queue ? aiTaskJobs(opts.queue) : undefined;
  const registry = bindMatrixOperations(bindCoreOperations(new Registry(), lib), lib, {
    ai,
    ...(jobs ? { jobs } : {}),
    now: () => new Date("2026-11-01T10:00:00.000Z"),
  });
  const call = <T>(name: string, input: unknown, actor: Actor = "human") =>
    registry.call(name, { actor }, input) as Promise<T>;
  return { lib, mock, registry, service: registry.matrix as MatrixService, call, card };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function newMatrix(s: Setup, items = [KESSLER, HATTIE, LUHMANN]) {
  return s.call<{ matrix: Matrix; path: string }>("matrix.create", {
    project: "phd",
    title: "Altern und Teilhabe",
    columns: [
      { name: "Methode", instruction: "Wie wurde untersucht? recruited interview coded sessions" },
      { name: "Grenzen", instruction: "Welche Grenzen nennen die Autoren? generalized sample" },
    ],
    items,
  });
}

const colId = (m: Matrix, name: string): string => {
  const c = m.columns.find((x) => x.name === name);
  if (!c) throw new Error(`no column ${name}`);
  return c.id;
};

const cell = (m: Matrix, item: string, name: string) => m.cells[item]?.[colId(m, name)];

async function idle(s: Setup): Promise<void> {
  await s.service.detached?.idle();
}

const get = async (s: Setup, id: string) =>
  (await s.call<{ matrix: Matrix }>("matrix.get", { project: "phd", matrix: id })).matrix;

describe("matrix files", () => {
  it("lives as projects/<slug>/matrices/<id>.yaml with rows and columns and no empty cells", async () => {
    const s = await setup();
    const { matrix, path } = await newMatrix(s);
    expect(path).toBe(`projects/phd/matrices/${matrix.id}.yaml`);
    expect(matrix.id).toMatch(/^m_/);
    expect(matrix.rows).toEqual([KESSLER, HATTIE, LUHMANN]);
    expect(matrix.columns.map((c) => c.name)).toEqual(["Methode", "Grenzen"]);
    const text = readFileSync(join(s.lib.root, path), "utf8");
    expect(text).not.toContain("cells: {}\n  ");
    expect(parseMatrix(text).rows).toEqual(matrix.rows);
    const list = await s.call<{ matrices: Array<{ cells: { empty: number }; rows: number }> }>(
      "matrix.list",
      { project: "phd" },
    );
    expect(list.matrices).toHaveLength(1);
    expect(list.matrices[0]).toMatchObject({ rows: 3, cells: { empty: 6 } });
  });

  it("rejects unknown items, duplicate rows and duplicate column names", async () => {
    const s = await setup();
    await expect(newMatrix(s, ["nobody1999made-up"])).rejects.toThrow(/ITEM_NOT_FOUND|no item/);
    const { matrix } = await newMatrix(s);
    await expect(
      s.call("matrix.update", {
        project: "phd",
        matrix: matrix.id,
        ops: [{ op: "addRow", item: KESSLER }],
      }),
    ).rejects.toThrow(/already has a row/);
    await expect(
      s.call("matrix.update", {
        project: "phd",
        matrix: matrix.id,
        ops: [{ op: "addColumn", name: "methode" }],
      }),
    ).rejects.toThrow(/already has a column/);
    await expect(
      s.call("matrix.get", { project: "phd", matrix: "m_01JB8Z3QK7ABCDEFGH" }),
    ).rejects.toThrow(/no matrix/);
  });
});

describe("matrix.update", () => {
  it("edits a cell by hand: status edited, human provenance, card evidence attached", async () => {
    const s = await setup();
    const { matrix } = await newMatrix(s);
    const out = await s.call<{ matrix: Matrix }>("matrix.update", {
      project: "phd",
      matrix: matrix.id,
      ops: [
        { op: "setCell", item: HATTIE, column: "methode", answer: "  Metaanalyse.  " },
        {
          op: "setCell",
          item: HATTIE,
          column: "Grenzen",
          answer: "Große Streuung.",
          evidence: [s.card.fm.id],
        },
      ],
    });
    const a = cell(out.matrix, HATTIE, "Methode");
    expect(a).toMatchObject({
      status: "edited",
      answer: "Metaanalyse.",
      provenance: { source: "human", by: "human", at: "2026-11-01T10:00:00.000Z" },
    });
    expect(cell(out.matrix, HATTIE, "Grenzen")?.evidence).toEqual([
      {
        type: "card",
        card: s.card.fm.id,
        quote: expect.stringContaining("clearly more effective"),
        page: "88",
      },
    ]);
    // An agent's setCell does not pass as human work.
    const byAgent = await s.call<{ matrix: Matrix }>(
      "matrix.update",
      {
        project: "phd",
        matrix: matrix.id,
        ops: [{ op: "setCell", item: KESSLER, column: "Methode", answer: "Interviews." }],
      },
      "agent:test",
    );
    expect(cell(byAgent.matrix, KESSLER, "Methode")?.provenance).toMatchObject({
      source: "model",
      by: "agent:test",
    });
  });

  it("adds, renames, moves and removes rows and columns; removals drop their cells", async () => {
    const s = await setup();
    const { matrix } = await newMatrix(s, [KESSLER, HATTIE]);
    const out = await s.call<{ matrix: Matrix }>("matrix.update", {
      project: "phd",
      matrix: matrix.id,
      ops: [
        { op: "setCell", item: HATTIE, column: "Methode", answer: "Metaanalyse." },
        { op: "addRow", item: LUHMANN, position: 1 },
        { op: "moveRow", item: KESSLER, position: 3 },
        { op: "addColumn", name: "Befund", instruction: "Was kam heraus?", position: 1 },
        { op: "updateColumn", column: "Grenzen", name: "Einschränkungen" },
        { op: "moveColumn", column: "Methode", position: 3 },
        { op: "rename", title: "Neuer Titel" },
      ],
    });
    expect(out.matrix.rows).toEqual([LUHMANN, HATTIE, KESSLER]);
    expect(out.matrix.columns.map((c) => c.name)).toEqual(["Befund", "Einschränkungen", "Methode"]);
    expect(out.matrix.title).toBe("Neuer Titel");
    expect(cell(out.matrix, HATTIE, "Methode")?.answer).toBe("Metaanalyse.");
    // Column ids stay the same through a rename and a move.
    expect(colId(out.matrix, "Methode")).toBe(colId(matrix, "Methode"));

    const gone = await s.call<{ matrix: Matrix }>("matrix.update", {
      project: "phd",
      matrix: matrix.id,
      ops: [
        { op: "removeRow", item: HATTIE },
        { op: "removeColumn", column: "Methode" },
      ],
    });
    expect(gone.matrix.rows).toEqual([LUHMANN, KESSLER]);
    expect(gone.matrix.cells[HATTIE]).toBeUndefined();
    expect(Object.keys(gone.matrix.cells)).toEqual([]);
    expect(
      readFileSync(join(s.lib.root, `projects/phd/matrices/${matrix.id}.yaml`), "utf8"),
    ).not.toContain("Metaanalyse");
  });

  it("applies all operations or none", async () => {
    const s = await setup();
    const { matrix } = await newMatrix(s, [KESSLER]);
    await expect(
      s.call("matrix.update", {
        project: "phd",
        matrix: matrix.id,
        ops: [
          { op: "rename", title: "Halb" },
          { op: "removeColumn", column: "gibt es nicht" },
        ],
      }),
    ).rejects.toThrow(/no column/);
    expect((await get(s, matrix.id)).title).toBe("Altern und Teilhabe");
  });
});

describe("matrix.fillCell", () => {
  it("stores an answer with verified quotes and printed page labels from the document", async () => {
    const s = await setup();
    const { matrix } = await newMatrix(s, [KESSLER]);
    s.mock.set("matrix.fillCell", {
      answer: "Interviews mit 131 Personen aus drei Gemeindezentren, in zwei Runden kodiert.",
      evidence: [
        { ref: "b3k9x2a1", quote: "We recruited participants through three community centers" },
        { ref: "[b3k9x2b7]", quote: "Transcripts were CODED in two rounds with a scheme" },
        { ref: "b3k9x2b7", quote: "Interviews were recorded and transcribed verbatim." },
      ],
    });
    const { job } = await s.call<{ job: string }>("matrix.fillCell", {
      project: "phd",
      matrix: matrix.id,
      item: KESSLER,
      column: "Methode",
    });
    expect(job).toMatch(/^j_/);
    // The cell reads as filling while the job is queued.
    expect(cell(await get(s, matrix.id), KESSLER, "Methode")?.status).toBe("filling");
    await idle(s);

    const c = cell(await get(s, matrix.id), KESSLER, "Methode");
    expect(c?.status).toBe("filled");
    expect(c?.answer).toContain("131 Personen");
    expect(c?.provenance).toMatchObject({
      source: "model",
      by: "human",
      model: "mock:mock-smart",
      language: "de",
      promptVersion: 1,
    });
    expect(c?.evidence).toEqual([
      {
        type: "block",
        block: "b3k9x2a1",
        source: HASH,
        quote: "We recruited participants through three community centers",
        page: "114",
      },
      {
        type: "block",
        block: "b3k9x2b7",
        source: HASH,
        quote: "Transcripts were coded in two rounds with a scheme",
        page: "116",
      },
      {
        type: "block",
        block: "b3k9x2b7",
        source: HASH,
        quote: "Interviews were recorded and transcribed verbatim.",
        page: "115",
      },
    ]);
    const call = s.mock.calls.at(-1);
    expect(call?.language).toBe("de");
    expect(call?.prompt).toContain("[b3k9x2a1] (page 114)");
    expect(call?.prompt).toContain("Transcripts were coded in two rounds");
    expect(call?.prompt).not.toContain("<!--");
    expect(call?.prompt).not.toContain("^b3k9x2a1");
  });

  it("gives a quote that crosses a page break both pages", async () => {
    const s = await setup();
    const { matrix } = await newMatrix(s, [KESSLER]);
    s.mock.set("matrix.fillCell", {
      answer: "Aufgezeichnete und kodierte Interviews.",
      evidence: [
        { ref: "b3k9x2b7", quote: "recorded and transcribed verbatim. Transcripts were coded" },
      ],
    });
    await s.call("matrix.fillCell", {
      project: "phd",
      matrix: matrix.id,
      item: KESSLER,
      column: "Methode",
    });
    await idle(s);
    const c = cell(await get(s, matrix.id), KESSLER, "Methode");
    expect(c?.evidence[0]?.page).toBe("115-116");
  });

  it("stores 'keine Angabe im Text' without evidence when the model invents its quotes", async () => {
    const s = await setup();
    const { matrix } = await newMatrix(s, [KESSLER]);
    s.mock.set("matrix.fillCell", {
      answer: "Telefonische Befragung von 400 Personen.",
      evidence: [{ ref: "b3k9x2a1", quote: "A telephone survey of 400 persons was conducted" }],
    });
    await s.call("matrix.fillCell", {
      project: "phd",
      matrix: matrix.id,
      item: KESSLER,
      column: "Methode",
    });
    await idle(s);
    const c = cell(await get(s, matrix.id), KESSLER, "Methode");
    expect(c).toMatchObject({
      status: "filled",
      answer: "keine Angabe im Text",
      evidence: [],
      provenance: { source: "model", model: "mock:mock-smart" },
    });
  });

  it("stores 'keine Angabe im Text' when the answer has no evidence at all", async () => {
    const s = await setup();
    const { matrix } = await newMatrix(s, [KESSLER]);
    s.mock.set("matrix.fillCell", { answer: "Vermutlich qualitativ.", evidence: [] });
    await s.call("matrix.fillCell", {
      project: "phd",
      matrix: matrix.id,
      item: KESSLER,
      column: "Grenzen",
    });
    await idle(s);
    expect(cell(await get(s, matrix.id), KESSLER, "Grenzen")).toMatchObject({
      status: "filled",
      answer: "keine Angabe im Text",
      evidence: [],
    });
  });

  it("does not call the model for an item without text or cards", async () => {
    const s = await setup();
    const { matrix } = await newMatrix(s, [LUHMANN]);
    await s.call("matrix.fillCell", {
      project: "phd",
      matrix: matrix.id,
      item: LUHMANN,
      column: "Methode",
    });
    await idle(s);
    expect(s.mock.calls).toHaveLength(0);
    expect(cell(await get(s, matrix.id), LUHMANN, "Methode")).toMatchObject({
      status: "filled",
      answer: "keine Angabe im Text",
      evidence: [],
    });
  });

  it("cites cards of the item with the page of their locator", async () => {
    const s = await setup();
    const { matrix } = await newMatrix(s, [HATTIE]);
    s.mock.set("matrix.fillCell", (req: Req) => {
      const ref = /\[(c_[0-9A-Z]+)\]/.exec(req.prompt)?.[1] ?? "";
      return {
        answer: "Rückmeldung zur Aufgabe wirkt stärker als Lob.",
        evidence: [
          { ref, quote: "refers to the task and to the next step is clearly more effective" },
        ],
      };
    });
    await s.call("matrix.fillCell", {
      project: "phd",
      matrix: matrix.id,
      item: HATTIE,
      column: "Methode",
    });
    await idle(s);
    const c = cell(await get(s, matrix.id), HATTIE, "Methode");
    expect(c?.evidence).toEqual([
      {
        type: "card",
        card: s.card.fm.id,
        quote: "refers to the task and to the next step is clearly more effective",
        page: "88",
      },
    ]);
  });

  it("refuses to overwrite a filled or edited cell without force", async () => {
    const s = await setup();
    const { matrix } = await newMatrix(s, [KESSLER]);
    await s.call("matrix.update", {
      project: "phd",
      matrix: matrix.id,
      ops: [{ op: "setCell", item: KESSLER, column: "Methode", answer: "Von Hand." }],
    });
    const input = { project: "phd", matrix: matrix.id, item: KESSLER, column: "Methode" };
    await expect(s.call("matrix.fillCell", input)).rejects.toThrow(/already edited/);
    s.mock.set("matrix.fillCell", {
      answer: "Neu.",
      evidence: [{ ref: "b3k9x2a1", quote: "Eligibility required age 65 or older" }],
    });
    await s.call("matrix.fillCell", { ...input, force: true });
    await idle(s);
    expect(cell(await get(s, matrix.id), KESSLER, "Methode")).toMatchObject({
      status: "filled",
      answer: "Neu.",
    });
  });

  it("discards the result when the user edits the cell while the model works", async () => {
    const s = await setup();
    const { matrix } = await newMatrix(s, [KESSLER]);
    const g = gate();
    s.mock.set("matrix.fillCell", async () => {
      await g.wait;
      return {
        answer: "Vom Modell.",
        evidence: [{ ref: "b3k9x2a1", quote: "Eligibility required age 65 or older" }],
      };
    });
    await s.call("matrix.fillCell", {
      project: "phd",
      matrix: matrix.id,
      item: KESSLER,
      column: "Methode",
    });
    await until(() => s.mock.calls.length > 0);
    await expect(
      s.call("matrix.fillCell", {
        project: "phd",
        matrix: matrix.id,
        item: KESSLER,
        column: "Methode",
        force: true,
      }),
    ).rejects.toThrow(/being filled/);
    await s.call("matrix.update", {
      project: "phd",
      matrix: matrix.id,
      ops: [{ op: "setCell", item: KESSLER, column: "Methode", answer: "Meine Fassung." }],
    });
    g.release();
    await idle(s);
    expect(cell(await get(s, matrix.id), KESSLER, "Methode")).toMatchObject({
      status: "edited",
      answer: "Meine Fassung.",
    });
  });

  it("records a failed model call on the cell and keeps the rest of the matrix intact", async () => {
    const s = await setup();
    const { matrix } = await newMatrix(s, [KESSLER]);
    s.mock.set("matrix.fillCell", () => {
      throw new Error("backend is down");
    });
    const { job } = await s.call<{ job: string }>("matrix.fillCell", {
      project: "phd",
      matrix: matrix.id,
      item: KESSLER,
      column: "Methode",
    });
    await idle(s);
    expect(s.service.detached?.jobs.get(job)).toMatchObject({
      status: "succeeded",
      result: { filled: 0, noInfo: 0, failed: 1 },
    });
    const c = cell(await get(s, matrix.id), KESSLER, "Methode");
    expect(c?.status).toBe("failed");
    expect(c?.error).toMatch(/backend is down|AI_/);
    // A failed cell can be filled again.
    s.mock.set("matrix.fillCell", {
      answer: "Interviews.",
      evidence: [{ ref: "b3k9x2b7", quote: "semi-structured interview of about 60 minutes" }],
    });
    await s.call("matrix.fillCell", {
      project: "phd",
      matrix: matrix.id,
      item: KESSLER,
      column: "Methode",
    });
    await idle(s);
    const again = cell(await get(s, matrix.id), KESSLER, "Methode");
    expect(again?.status).toBe("filled");
    expect(again?.error).toBeUndefined();
  });
});

describe("matrix.fill", () => {
  it("fills every open cell as one job with progress and leaves edited cells alone", async () => {
    const s = await setup();
    const { matrix } = await newMatrix(s);
    await s.call("matrix.update", {
      project: "phd",
      matrix: matrix.id,
      ops: [{ op: "setCell", item: KESSLER, column: "Grenzen", answer: "Meine Grenzen." }],
    });
    const seen: number[] = [];
    s.mock.set("matrix.fillCell", (req: Req) => {
      const job = [...(s.service.detached?.jobs.values() ?? [])][0];
      if (job) seen.push(job.progress);
      return quoteFirstPassage(req);
    });
    const out = await s.call<{ job: string; cells: number }>("matrix.fill", {
      project: "phd",
      matrix: matrix.id,
    });
    expect(out.cells).toBe(5);
    const snapshot = await get(s, matrix.id);
    expect(cell(snapshot, KESSLER, "Methode")?.status).toBe("filling");
    expect(cell(snapshot, KESSLER, "Grenzen")?.status).toBe("edited");
    await idle(s);

    const job = s.service.detached?.jobs.get(out.job);
    expect(job).toBeDefined();
    expect(job).toMatchObject({
      status: "succeeded",
      progress: 1,
      result: { filled: 3, noInfo: 2, failed: 0 },
    });
    expect(job?.message ?? "").toMatch(/3 filled, 2 without answer, 0 failed/);
    // Progress rose across the cells: 0 of 5 before the first one, then in steps.
    expect(seen.length).toBe(3);
    expect(seen[0]).toBeCloseTo(0);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i] as number).toBeGreaterThan(seen[i - 1] as number);
    }

    const done = await get(s, matrix.id);
    expect(cell(done, KESSLER, "Methode")?.status).toBe("filled");
    expect(cell(done, KESSLER, "Grenzen")).toMatchObject({
      status: "edited",
      answer: "Meine Grenzen.",
    });
    expect(cell(done, HATTIE, "Methode")?.evidence[0]).toMatchObject({ type: "card", page: "88" });
    expect(cell(done, LUHMANN, "Methode")?.answer).toBe("keine Angabe im Text");

    // Nothing is open any more: a second fill is a job without cells.
    const second = await s.call<{ job: string; cells: number }>("matrix.fill", {
      project: "phd",
      matrix: matrix.id,
    });
    expect(second.cells).toBe(0);
    await idle(s);
    expect(s.service.detached?.jobs.get(second.job)?.status).toBe("succeeded");
    expect(s.mock.calls).toHaveLength(3);
  });

  it("answers in English when the project language is English", async () => {
    const s = await setup();
    s.lib.updateProject({ slug: "phd", patch: { ai_language: "en" } });
    const { matrix } = await newMatrix(s, [LUHMANN]);
    await s.call("matrix.fill", { project: "phd", matrix: matrix.id });
    await idle(s);
    expect(cell(await get(s, matrix.id), LUHMANN, "Methode")?.answer).toBe(
      "not stated in the text",
    );
  });

  it("runs on the core job queue and reports progress and the result through jobs", async () => {
    const queue = new JobQueue({ dbPath: join(tmpDir("cg-jobs-"), "state.sqlite") });
    const s = await setup({ queue });
    queue.start();
    try {
      const { matrix } = await newMatrix(s, [KESSLER]);
      s.mock.set("matrix.fillCell", quoteFirstPassage);
      const out = await s.call<{ job: string; cells: number }>("matrix.fill", {
        project: "phd",
        matrix: matrix.id,
      });
      expect(out.cells).toBe(2);
      await until(() => queue.get(out.job)?.status === "succeeded");
      const job = queue.get(out.job);
      expect(job?.progress).toBe(1);
      expect(job?.message ?? "").toMatch(/2 filled/);
      expect(job?.result).toEqual({ filled: 2, noInfo: 0, failed: 0 });
      expect(job?.kind).toBe("ai-task");
    } finally {
      queue.close();
    }
  });
});

describe("matrix.export", () => {
  async function filled(s: Setup) {
    const { matrix } = await newMatrix(s);
    s.mock.set("matrix.fillCell", (req: Req) => {
      if (req.prompt.includes("Feedback that refers")) {
        const ref = /\[(c_[0-9A-Z]+)\]/.exec(req.prompt)?.[1] ?? "";
        return {
          answer: "Lob wirkt schwächer als Rückmeldung zum nächsten Schritt.",
          evidence: [{ ref, quote: "is clearly more effective than praise of the person" }],
        };
      }
      if (req.prompt.includes("Question: Grenzen")) {
        return {
          answer: "Stichprobe | stark aktive Ältere.",
          evidence: [
            {
              ref: "b3k9x3c4",
              quote: "the sample probably over-represents socially active older adults",
            },
          ],
        };
      }
      return {
        answer: "Interviews, in zwei Runden kodiert.",
        evidence: [
          { ref: "b3k9x2b7", quote: "Interviews were recorded and transcribed verbatim." },
          { ref: "b3k9x2b7", quote: "Transcripts were coded in two rounds" },
        ],
      };
    });
    await s.call("matrix.update", {
      project: "phd",
      matrix: matrix.id,
      ops: [
        { op: "setCell", item: HATTIE, column: "Methode", answer: 'Metaanalyse, "435" Studien.' },
      ],
    });
    await s.call("matrix.fill", { project: "phd", matrix: matrix.id });
    await idle(s);
    return matrix;
  }

  it("renders a Markdown table with citations in the project style and a bibliography", async () => {
    const s = await setup();
    const matrix = await filled(s);
    const out = await s.call<{ text: string; format: string }>("matrix.export", {
      project: "phd",
      matrix: matrix.id,
      format: "markdown",
    });
    expect(out.format).toBe("markdown");
    expect(out.text).toMatchInlineSnapshot(`
      "# Altern und Teilhabe

      | Quelle | Methode | Grenzen |
      | --- | --- | --- |
      | Kessler, 2019 | Interviews, in zwei Runden kodiert. (Kessler, 2019, S. 115) (Kessler, 2019, S. 116) | Stichprobe \\| stark aktive Ältere. (Kessler, 2019, S. 116) |
      | Hattie, 2007 | Metaanalyse, "435" Studien. | Lob wirkt schwächer als Rückmeldung zum nächsten Schritt. (Hattie, 2007, S. 88) |
      | Luhmann, 1984 | keine Angabe im Text | keine Angabe im Text |

      ## Literatur

      - Hattie, J. (2007). The Power of Feedback.
      - Kessler, A. (2019). Aging and Social Participation.
      - Luhmann, N. (1984). Soziale Systeme.
      "
    `);
  });

  it("renders CSV with a citekey column and quoted fields", async () => {
    const s = await setup();
    const matrix = await filled(s);
    const out = await s.call<{ text: string }>("matrix.export", {
      project: "phd",
      matrix: matrix.id,
      format: "csv",
    });
    expect(out.text).toMatchInlineSnapshot(`
      "Citekey,Quelle,Methode,Grenzen
      kessler2019aging,"Kessler, 2019","Interviews, in zwei Runden kodiert. (Kessler, 2019, S. 115) (Kessler, 2019, S. 116)","Stichprobe | stark aktive Ältere. (Kessler, 2019, S. 116)"
      hattie2007power,"Hattie, 2007","Metaanalyse, ""435"" Studien.","Lob wirkt schwächer als Rückmeldung zum nächsten Schritt. (Hattie, 2007, S. 88)"
      luhmann1984soziale,"Luhmann, 1984",keine Angabe im Text,keine Angabe im Text
      "
    `);
  });

  it("follows another CSL style and locale when asked", async () => {
    const s = await setup();
    const matrix = await filled(s);
    const out = await s.call<{ text: string }>("matrix.export", {
      project: "phd",
      matrix: matrix.id,
      format: "markdown",
      style: "chicago-author-date",
      locale: "en-US",
    });
    expect(out.text).toContain("## References");
    expect(out.text).toContain("Kessler");
    expect(out.text).toContain("(Kessler 2019, 116)");
    expect(out.text).not.toContain("S. 116");
  });
});

describe("bindMatrixOperations", () => {
  it("binds all seven operations", async () => {
    const s = await setup();
    const names = s.registry.list().map((c) => c.name);
    for (const n of [
      "matrix.create",
      "matrix.list",
      "matrix.get",
      "matrix.update",
      "matrix.fillCell",
      "matrix.fill",
      "matrix.export",
    ]) {
      expect(names).toContain(n);
    }
    expect(existsSync(join(s.lib.root, "projects/phd"))).toBe(true);
  });
});
