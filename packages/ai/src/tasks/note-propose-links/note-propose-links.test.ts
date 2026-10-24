import { describe, expect, it } from "vitest";
import { MockBackend } from "../../backends/mock.js";
import { mark } from "../../untrusted.js";
import { runTask, TASKS } from "../registry.js";
import {
  type NoteProposeLinksInput,
  type NoteProposeLinksOutput,
  sanitizeProposals,
} from "./index.js";

const task = TASKS["note.proposeLinks"];
const [argument, method, repeat] = task.fixtures;

/** Answers that pass the deterministic checks of each fixture. */
const GOOD: Record<string, NoteProposeLinksOutput> = {
  "de-autopoiesis-argument": {
    proposals: [
      {
        to: "[[luhmann1984soziale]]",
        rel: "supports",
        why: "Die Notiz stützt sich auf die These, dass sich soziale Systeme über Kommunikation reproduzieren.",
        evidence: "[[c_01JB8Z3Q0001]]",
      },
      {
        to: "[[teubner1987autopoietic]]",
        rel: "qualifies",
        why: "Der Einwand begrenzt die Übertragung des Begriffs, weil das Recht nicht vollständig geschlossen ist.",
        evidence: "[[c_01JB8Z3Q0002]]",
      },
    ],
  },
  "en-method-and-limits": {
    proposals: [
      {
        to: "[[mayring2015qualitative]]",
        rel: "uses-method-of",
        why: "The note codes the interviews with the scheme described in this book.",
      },
      {
        to: "[[kessler2019aging]]",
        rel: "qualifies",
        why: "The sample is limited to active seniors, which narrows what the findings are valid for.",
        evidence: "[[c_01JB8Z3Q0003]]",
      },
    ],
  },
  "inj-note-and-summary": {
    proposals: [
      {
        to: "[[mayring2015qualitative]]",
        rel: "uses-method-of",
        why: "The note codes the interviews with the scheme described in this book.",
      },
      {
        to: "[[kessler2019aging]]",
        rel: "qualifies",
        why: "The sample is limited to active seniors, which narrows what the findings are valid for.",
        evidence: "[[c_01JB8Z3Q0003]]",
      },
    ],
  },
  "de-skips-existing-link": {
    proposals: [
      {
        to: "[[feedback-frage]]",
        rel: "addresses",
        why: "Die Notiz beantwortet die Frage, welche Art von Rückmeldung beim Lernen hilft.",
      },
    ],
  },
};

describe("note.proposeLinks task", () => {
  it("ships four fixtures whose checks pass a good answer", () => {
    expect(task.fixtures).toHaveLength(4);
    for (const f of task.fixtures) {
      expect(f.check(GOOD[f.id] as NoteProposeLinksOutput, f.input), f.id).toEqual([]);
    }
  });

  it("fails an answer that invents a citekey or a foreign card", () => {
    const bad: NoteProposeLinksOutput = {
      proposals: [
        {
          to: "[[luhmann1985erfunden]]",
          rel: "supports",
          why: "Die Quelle ist nicht in der Liste.",
        },
        {
          to: "[[teubner1987autopoietic]]",
          rel: "opposes",
          why: "Der Einwand richtet sich gegen die These, dass das Recht geschlossen ist.",
          evidence: "[[c_01JB8Z3Q0001]]",
        },
      ],
    };
    const fails = argument?.check(bad, argument.input).join(" ") ?? "";
    expect(fails).toMatch(/\[\[luhmann1985erfunden\]\], which is not a target/);
    expect(fails).toMatch(
      /evidence \[\[c_01JB8Z3Q0001\]\] does not belong to \[\[teubner1987autopoietic\]\]/,
    );
    expect(fails).toMatch(/no proposal for \[\[luhmann1984soziale\]\]/);
  });

  it("fails a repeated link, a wrong relation and the wrong language", () => {
    const repeated: NoteProposeLinksOutput = {
      proposals: [
        {
          to: "[[hattie2007power]]",
          rel: "supports",
          why: "Die Studie zeigt, dass aufgabenbezogenes Feedback wirkt.",
        },
        { to: "[[feedback-frage]]", rel: "opposes", why: "This is the open question of the note." },
      ],
    };
    const fails = repeat?.check(repeated, repeat.input).join(" ") ?? "";
    expect(fails).toMatch(/repeats the existing supports link/);
    expect(fails).toMatch(/not in de/);
    expect(fails).toMatch(/got opposes/);
    const wrongRel: NoteProposeLinksOutput = {
      proposals: [
        {
          to: "[[mayring2015qualitative]]",
          rel: "opposes",
          why: "The note argues against the book.",
        },
      ],
    };
    expect(method?.check(wrongRel, method.input).join(" ")).toMatch(/got opposes/);
  });

  it("runs on the mock backend with the note text, the targets and the language in the prompt", async () => {
    const f = argument as NonNullable<typeof argument>;
    const mock = new MockBackend({ "note.proposeLinks": GOOD[f.id] });
    const res = await runTask(mock, "note.proposeLinks", f.input, { language: "de" });
    expect(res.output.proposals).toHaveLength(2);
    expect(res.promptVersion).toBe(2);
    expect(res.stamp.language).toBe("de");
    const call = mock.calls[0];
    expect(call?.prompt).toContain(mark("Soziale Systeme reproduzieren sich"));
    expect(call?.prompt).toContain("ref: [[maturana1980autopoiesis]]");
    expect(call?.prompt).toContain("ref: [[c_01JB8Z3Q0002]]");
    expect(call?.system).toContain("Never invent a citekey");
    expect(call?.system).toContain("German");
    expect(call?.model).toBe("smart");
  });

  it("retries when the model answers with an unknown relation", async () => {
    const f = argument as NonNullable<typeof argument>;
    const mock = new MockBackend({
      "note.proposeLinks": [
        { proposals: [{ to: "[[luhmann1984soziale]]", rel: "cites", why: "x" }] },
        GOOD[f.id],
      ],
    });
    const res = await runTask(mock, "note.proposeLinks", f.input, { language: "de" });
    expect(res.output.proposals[0]?.rel).toBe("supports");
  });

  it("rejects an input without targets", async () => {
    const mock = new MockBackend({ "note.proposeLinks": { proposals: [] } });
    await expect(
      runTask(mock, "note.proposeLinks", { note: { title: "t", body: "b" }, targets: [] }),
    ).rejects.toThrow(/targets/);
  });
});

describe("sanitizeProposals", () => {
  const input = (argument as NonNullable<typeof argument>).input as NoteProposeLinksInput;

  it("drops invented targets, foreign evidence and repeats, and normalizes bare keys", () => {
    const out = sanitizeProposals(
      {
        proposals: [
          { to: "luhmann1984soziale", rel: "supports", why: "  a  ", evidence: "c_01JB8Z3Q0001" },
          { to: "[[luhmann1984soziale]]", rel: "supports", why: "duplicate" },
          { to: "[[nobody1999made-up]]", rel: "supports", why: "invented" },
          {
            to: "[[teubner1987autopoietic]]",
            rel: "opposes",
            why: "b",
            evidence: "[[c_01JB8Z3Q0001]]",
          },
          { to: "[[maturana1980autopoiesis]]", rel: "extends", why: "c" },
        ],
      },
      input,
    );
    expect(out).toEqual([
      { to: "[[luhmann1984soziale]]", rel: "supports", why: "a", evidence: "[[c_01JB8Z3Q0001]]" },
      { to: "[[teubner1987autopoietic]]", rel: "opposes", why: "b" },
      { to: "[[maturana1980autopoiesis]]", rel: "extends", why: "c" },
    ]);
  });

  it("skips typed links the note already has and caps the number", () => {
    const withExisting: NoteProposeLinksInput = {
      ...input,
      existing: [{ to: "[[luhmann1984soziale]]", rel: "supports" }],
    };
    const out = sanitizeProposals(
      { proposals: [{ to: "[[luhmann1984soziale]]", rel: "supports", why: "again" }] },
      withExisting,
    );
    expect(out).toEqual([]);
    const many = (
      ["supports", "opposes", "qualifies", "extends", "elaborates", "related"] as const
    ).flatMap((rel) => input.targets.map((t) => ({ to: t.ref, rel, why: `${rel} ${t.ref}` })));
    expect(sanitizeProposals({ proposals: many }, input)).toHaveLength(8);
  });
});
