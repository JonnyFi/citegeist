import { describe, expect, it } from "vitest";
import { MockBackend } from "../../backends/mock.js";
import { runTask, TASKS } from "../registry.js";
import {
  type MatrixFillCellOutput,
  noInfoText,
  normalizeForMatch,
  sanitizeCell,
  verifyQuote,
} from "./index.js";

const task = TASKS["matrix.fillCell"];
const [method, limits, finding, silent] = task.fixtures;

const GOOD: Record<string, MatrixFillCellOutput> = {
  "de-method-from-english-passages": {
    answer:
      "Halbstrukturierte Interviews mit 131 Teilnehmenden, die über drei Gemeindezentren gewonnen wurden; die Transkripte wurden in zwei Runden kodiert.",
    evidence: [
      { ref: "b3k9x2a1", quote: "We recruited participants through three community centers" },
      { ref: "b3k9x2b7", quote: "coded in two rounds with a scheme developed from the first" },
    ],
  },
  "de-limits-with-quote": {
    answer:
      "Die Stichprobe ist wahrscheinlich zu aktiv und lässt sich nicht auf isolierte Ältere übertragen.",
    evidence: [
      {
        ref: "b3k9x3c4",
        quote: "the findings should not be generalized to people who are isolated or housebound",
      },
    ],
  },
  "en-finding": {
    answer: "Feedback on the task and the next step works much better than praise of the person.",
    evidence: [
      {
        ref: "bf1a0002",
        quote: "wirkten deutlich stärker als Lob für die Person",
      },
    ],
  },
  "de-silent-passages": { answer: "", evidence: [] },
};

describe("matrix.fillCell task", () => {
  it("ships four fixtures whose checks pass a good answer", () => {
    expect(task.fixtures).toHaveLength(4);
    for (const f of task.fixtures) {
      expect(f.check(GOOD[f.id] as MatrixFillCellOutput, f.input), f.id).toEqual([]);
    }
  });

  it("fails invented quotes, an answer without evidence, invented numbers and the wrong language", () => {
    const invented: MatrixFillCellOutput = {
      answer: "Die Befragung umfasste 400 Personen.",
      evidence: [{ ref: "b3k9x2a1", quote: "We surveyed four hundred people by telephone" }],
    };
    const fails = method?.check(invented, method.input).join(" ") ?? "";
    expect(fails).toMatch(/quote is not in passage b3k9x2a1/);
    expect(fails).toMatch(/numbers not in passages: 400/);
    const bare = limits?.check(
      { answer: "Die Stichprobe ist schief.", evidence: [] },
      limits.input,
    );
    expect(bare?.join(" ")).toMatch(/answers without evidence/);
    const german = finding?.check(
      {
        answer: "Rückmeldung zur Aufgabe wirkt deutlich stärker als das Lob für die Person.",
        evidence: GOOD["en-finding"]?.evidence ?? [],
      },
      finding.input,
    );
    expect(german).toEqual(["answer is not in en"]);
    const wrongRef = finding?.check(
      { answer: "Feedback works.", evidence: [{ ref: "bx", quote: "irrelevant quote text" }] },
      finding.input,
    );
    expect(wrongRef?.join(" ")).toMatch(/bx, which is not a passage/);
  });

  it("fails an answer where the passages are silent", () => {
    const fails = silent?.check(
      {
        answer: "Befragt wurden Lehrkräfte.",
        evidence: [{ ref: "bf1a0002", quote: "wirkten deutlich stärker als Lob" }],
      },
      silent.input,
    );
    expect(fails?.join(" ")).toMatch(/answers although the passages are silent/);
    expect(fails?.join(" ")).toMatch(/cites evidence although/);
  });

  it("runs on the mock backend with question, passages, refs and language in the prompt", async () => {
    const f = method as NonNullable<typeof method>;
    const mock = new MockBackend({ "matrix.fillCell": GOOD[f.id] });
    const res = await runTask(mock, "matrix.fillCell", f.input, { language: "de" });
    expect(res.output.evidence).toHaveLength(2);
    expect(res.promptVersion).toBe(1);
    expect(res.stamp.language).toBe("de");
    const call = mock.calls[0];
    expect(call?.prompt).toContain("Question: Methode");
    expect(call?.prompt).toContain("[b3k9x2b7] (page 115)");
    expect(call?.prompt).toContain("Of 212 people approached");
    expect(call?.system).toContain("German");
    expect(call?.system).toContain("Never give a page number");
    expect(call?.model).toBe("smart");
  });

  it("rejects an input without passages", async () => {
    const mock = new MockBackend({ "matrix.fillCell": { answer: "", evidence: [] } });
    await expect(
      runTask(mock, "matrix.fillCell", {
        item: { citekey: "x2020y", title: "T" },
        column: { name: "Methode" },
        passages: [],
      }),
    ).rejects.toThrow(/passages/);
  });
});

describe("verifyQuote", () => {
  const passage =
    "Soziale Systeme sind „autopoietische“ Systeme – sie repro-\nduzieren sich selbst.  Kommunikation ist ihre Operation.";

  it("matches after unifying quotes, dashes, case, whitespace and hyphenation", () => {
    const hit = verifyQuote(
      passage,
      'systeme sind "autopoietische" Systeme - sie reproduzieren sich selbst. Kommunikation',
    );
    expect(hit?.text).toBe(
      "Systeme sind „autopoietische“ Systeme – sie repro-\nduzieren sich selbst.  Kommunikation",
    );
    expect(passage.slice(hit?.start, hit?.end)).toBe(hit?.text);
  });

  it("rejects text that the passage does not contain", () => {
    expect(verifyQuote(passage, "Kommunikation ist ihre wichtigste Operation")).toBeUndefined();
    expect(verifyQuote(passage, "Soziale Systeme sind lebende Systeme")).toBeUndefined();
  });

  it("rejects quotes that are too short to prove anything", () => {
    expect(verifyQuote(passage, "Systeme")).toBeUndefined();
    expect(normalizeForMatch("  a \n b ").text).toBe("a b");
  });

  it("does not join across an ellipsis", () => {
    expect(verifyQuote(passage, "Soziale Systeme sind ... Operation.")).toBeUndefined();
  });
});

describe("sanitizeCell", () => {
  const input = (method as NonNullable<typeof method>).input;

  it("keeps verified quotes as the passage has them and drops the rest", () => {
    const out = sanitizeCell(
      {
        answer: "  Interviews in Zentren.  ",
        evidence: [
          { ref: "[b3k9x2a1]", quote: "recruited participants through THREE community centers" },
          { ref: "b3k9x2a1", quote: "recruited participants through THREE community centers" },
          { ref: "b3k9x2b7", quote: "Interviews were recorded and filmed" },
          { ref: "b999", quote: "Eligibility required age 65 or older" },
        ],
      },
      input,
    );
    expect(out.found).toBe(true);
    expect(out.answer).toBe("Interviews in Zentren.");
    expect(out.evidence).toHaveLength(1);
    expect(out.evidence[0]).toMatchObject({
      ref: "b3k9x2a1",
      kind: "block",
      quote: "recruited participants through three community centers",
    });
    expect(out.rejected).toBe(2);
  });

  it("drops the answer when no quote survives", () => {
    const out = sanitizeCell(
      {
        answer: "Eine Umfrage unter 500 Personen.",
        evidence: [{ ref: "b3k9x2a1", quote: "A telephone survey of 500 persons" }],
      },
      input,
    );
    expect(out).toEqual({ found: false, answer: "", evidence: [], rejected: 1 });
    expect(
      sanitizeCell({ answer: "Ohne Beleg.", evidence: [] }, input).found,
      "no evidence given",
    ).toBe(false);
    expect(
      sanitizeCell(
        { answer: "", evidence: [{ ref: "b3k9x2a1", quote: "Eligibility required age 65" }] },
        input,
      ).found,
      "no answer given",
    ).toBe(false);
  });

  it("keeps at most four quotes", () => {
    const quotes = [
      "recruited participants through three",
      "Eligibility required age 65 or older",
      "Of 212 people approached",
      "143 agreed to take part",
      "131 completed both sessions",
    ];
    const out = sanitizeCell(
      { answer: "x", evidence: quotes.map((quote) => ({ ref: "b3k9x2a1", quote })) },
      input,
    );
    expect(out.evidence).toHaveLength(4);
  });
});

describe("noInfoText", () => {
  it("is German unless the answer language is English", () => {
    expect(noInfoText("de")).toBe("keine Angabe im Text");
    expect(noInfoText("de-AT")).toBe("keine Angabe im Text");
    expect(noInfoText("fr")).toBe("keine Angabe im Text");
    expect(noInfoText("en-GB")).toBe("not stated in the text");
  });
});
