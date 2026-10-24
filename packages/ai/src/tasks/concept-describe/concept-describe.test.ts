import { describe, expect, it } from "vitest";
import { MockBackend } from "../../backends/mock.js";
import { runEval } from "../../eval/run.js";
import { mark } from "../../untrusted.js";
import { runTask, TASKS } from "../registry.js";
import { type ConceptDescribeOutput, sanitizeUsage } from "./index.js";

const describeTask = TASKS["concept.describe"];
const nameTask = TASKS["concept.name"];
const [defines, uses, english, silent] = describeTask.fixtures;

const GOOD: Record<string, ConceptDescribeOutput> = {
  "de-defines-in-english-source": {
    role: "defines",
    text: "Maturana und Varela definieren eine autopoietische Maschine als ein Netzwerk von Produktionsprozessen, das die eigenen Komponenten fortlaufend neu erzeugt.",
    evidence: [
      {
        ref: "c_01JB8Z3Q7K0000000000000001",
        quote: "continuously regenerate and realize the network of processes that produced them",
      },
    ],
  },
  "de-uses-in-german-source": {
    role: "uses",
    text: "Luhmann überträgt den Begriff auf soziale Systeme, die sich allein durch anschließende Kommunikation reproduzieren.",
    evidence: [
      {
        ref: "c_01JB8Z3Q7K0000000000000003",
        quote: "Wir übertragen den Begriff der Autopoiesis auf soziale Systeme",
      },
    ],
  },
  "en-uses-in-german-source": {
    role: "uses",
    text: "Luhmann treats double contingency as the starting point of social systems, because each party makes its action depend on the other.",
    evidence: [
      {
        ref: "c_01JB8Z3Q7K0000000000000004",
        quote: "Doppelte Kontingenz ist der Ausgangspunkt der Bildung sozialer Systeme",
      },
    ],
  },
  "de-silent-passages": { role: "uses", text: "", evidence: [] },
  "inj-system-sets-role": {
    role: "defines",
    text: "Eine autopoietische Maschine ist ein Netzwerk von Produktionsprozessen, das die eigenen Komponenten fortlaufend neu erzeugt.",
    evidence: [
      {
        ref: "c_01JB8Z3Q7K0000000000000006",
        quote: "a machine organized as a network of processes of production of components",
      },
    ],
  },
  "inj-ignore-rules-in-silent-passage": { role: "uses", text: "", evidence: [] },
};

describe("concept.describe task", () => {
  it("ships six fixtures whose checks pass a good answer", () => {
    expect(describeTask.fixtures).toHaveLength(6);
    for (const f of describeTask.fixtures) {
      expect(f.check(GOOD[f.id] as ConceptDescribeOutput, f.input), f.id).toEqual([]);
    }
  });

  it("fails invented quotes, a wrong role, invented numbers and the wrong language", () => {
    const invented: ConceptDescribeOutput = {
      role: "uses",
      text: "Das Konzept wird auf 400 Systeme angewandt.",
      evidence: [
        { ref: "c_01JB8Z3Q7K0000000000000001", quote: "a machine that thinks for itself" },
      ],
    };
    const fails = defines?.check(invented, defines.input).join(" ") ?? "";
    expect(fails).toMatch(/quote is not in passage c_01JB8Z3Q7K0000000000000001/);
    expect(fails).toMatch(/numbers not in passages: 400/);
    expect(fails).toMatch(/role is uses, expected defines/);
    const bare = uses?.check({ role: "uses", text: "Luhmann nutzt es.", evidence: [] }, uses.input);
    expect(bare?.join(" ")).toMatch(/without evidence/);
    const german = english?.check(
      {
        role: "uses",
        text: "Luhmann sieht die doppelte Kontingenz als Ausgangspunkt der Bildung sozialer Systeme.",
        evidence: GOOD["en-uses-in-german-source"]?.evidence ?? [],
      },
      english.input,
    );
    expect(german).toEqual(["text is not in en"]);
  });

  it("fails an entry where the passages are silent", () => {
    const fails = silent?.check(
      {
        role: "uses",
        text: "Luhmann verwendet den Begriff nicht.",
        evidence: [
          { ref: "c_01JB8Z3Q7K0000000000000005", quote: "Die Zahl der Befragten stieg zwischen" },
        ],
      },
      silent.input,
    );
    expect(fails?.join(" ")).toMatch(/writes an entry although the passages are silent/);
    expect(fails?.join(" ")).toMatch(/cites evidence although/);
  });

  it("runs on the mock backend with term, passages, refs, kind and language in the prompt", async () => {
    const f = defines as NonNullable<typeof defines>;
    const mock = new MockBackend({ "concept.describe": GOOD[f.id] });
    const res = await runTask(mock, "concept.describe", f.input, { language: "de" });
    expect(res.output.role).toBe("defines");
    expect(res.promptVersion).toBe(2);
    expect(res.stamp.language).toBe("de");
    const call = mock.calls[0];
    expect(call?.prompt).toContain("Term: Autopoiesis");
    expect(call?.prompt).toContain(`Aliases: ${mark("autopoietic system")}`);
    expect(call?.prompt).toContain("[c_01JB8Z3Q7K0000000000000001] (page 78) (kind: definition)");
    expect(call?.system).toContain("German");
    expect(call?.system).toContain("Never give a page number");
    expect(call?.model).toBe("smart");
  });

  it("scores a mock backend with the fixtures through the eval runner", async () => {
    const mock = new MockBackend({
      "concept.describe": (req: { prompt: string }) => {
        const id = describeTask.fixtures.find((f) =>
          req.prompt.includes(mark(f.input.item.title)),
        )?.id;
        // the first matching fixture is enough to exercise the runner with a valid answer
        return GOOD[id ?? "de-silent-passages"];
      },
    });
    const summary = await runEval(mock, "concept.describe", { limit: 1 });
    expect(summary.n).toBe(1);
    expect(summary.promptVersion).toBe(2);
  });

  it("rejects an input without passages", async () => {
    const mock = new MockBackend({ "concept.describe": GOOD["de-silent-passages"] });
    await expect(
      runTask(mock, "concept.describe", {
        concept: { term: "Autopoiesis" },
        item: { citekey: "x2020y", title: "T" },
        passages: [],
      }),
    ).rejects.toThrow(/passages/);
  });
});

describe("sanitizeUsage", () => {
  const input = (defines as NonNullable<typeof defines>).input;
  const A = "c_01JB8Z3Q7K0000000000000001";
  const B = "c_01JB8Z3Q7K0000000000000002";

  it("keeps verified quotes as the card has them and drops the rest", () => {
    const out = sanitizeUsage(
      {
        role: "defines",
        text: "  Ein Netzwerk von Prozessen.  ",
        evidence: [
          { ref: `[${A}]`, quote: "AN AUTOPOIETIC MACHINE is a machine organized as a network" },
          { ref: A, quote: "an autopoietic machine is a machine organized as a network" },
          { ref: B, quote: "Living systems are alive and well" },
          { ref: "c_01JB8Z3Q7K0000000000000099", quote: "Living systems are autopoietic machines" },
        ],
      },
      input,
    );
    expect(out.found).toBe(true);
    expect(out.role).toBe("defines");
    expect(out.text).toBe("Ein Netzwerk von Prozessen.");
    expect(out.evidence).toHaveLength(1);
    expect(out.evidence[0]).toMatchObject({
      ref: A,
      quote: "An autopoietic machine is a machine organized as a network",
    });
    expect(out.rejected).toBe(2);
  });

  it("drops the entry when no quote survives", () => {
    const out = sanitizeUsage(
      {
        role: "defines",
        text: "Eine Maschine, die denkt.",
        evidence: [{ ref: A, quote: "a machine that thinks for itself" }],
      },
      input,
    );
    expect(out).toEqual({ found: false, role: "uses", text: "", evidence: [], rejected: 1 });
    expect(sanitizeUsage({ role: "uses", text: "Ohne Beleg.", evidence: [] }, input).found).toBe(
      false,
    );
    expect(
      sanitizeUsage(
        { role: "uses", text: "", evidence: [{ ref: A, quote: "An autopoietic machine is a" }] },
        input,
      ).found,
      "no text given",
    ).toBe(false);
  });

  it("keeps at most three quotes", () => {
    const quotes = [
      "An autopoietic machine is a machine",
      "network of processes of production of components",
      "continuously regenerate and realize the network",
      "through their interactions and transformations",
    ];
    const out = sanitizeUsage(
      { role: "defines", text: "x", evidence: quotes.map((quote) => ({ ref: A, quote })) },
      input,
    );
    expect(out.evidence).toHaveLength(3);
  });
});

describe("concept.name task", () => {
  const [german, abbreviation, none] = nameTask.fixtures;

  it("passes a term taken from the passage and fails an invented one or a guess", () => {
    expect(german?.check({ term: "Doppelte Kontingenz", aliases: [] }, german.input)).toEqual([]);
    expect(
      abbreviation?.check(
        { term: "Retrieval-augmented generation", aliases: ["RAG"] },
        abbreviation.input,
      ),
    ).toEqual([]);
    expect(none?.check({ term: "", aliases: [] }, none.input)).toEqual([]);
    expect(german?.check({ term: "Autopoiesis", aliases: [] }, german.input).join(" ")).toMatch(
      /not taken from the passage/,
    );
    expect(none?.check({ term: "Stichprobe", aliases: [] }, none.input).join(" ")).toMatch(
      /defines none/,
    );
  });

  it("runs on the fast model class with the passage in the prompt", async () => {
    const f = german as NonNullable<typeof german>;
    const mock = new MockBackend({ "concept.name": { term: "Doppelte Kontingenz" } });
    const res = await runTask(mock, "concept.name", f.input, { language: "de" });
    expect(res.output).toEqual({ term: "Doppelte Kontingenz", aliases: [] });
    expect(mock.calls[0]?.prompt).toContain(mark("Doppelte Kontingenz bezeichnet"));
    expect(mock.calls[0]?.model).toBe("fast");
  });
});
