import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AiRouter,
  getTask,
  MockBackend,
  nodeRunner,
  parseJsonLoose,
  resolveBackendId,
  resolveLanguage,
  runTask,
  TASK_NAMES,
  TASKS,
  toModelJsonSchema,
} from "./index.js";
import { CLAUDE_ENV_BLOCKLIST, cleanEnv } from "./runner.js";
import { sentenceCount } from "./tasks/card-paraphrase/fixtures.js";
import {
  prompt as paraphrasePrompt,
  PROMPT_VERSION as paraphraseVersion,
} from "./tasks/card-paraphrase/prompt.v4.js";
import { inventedNumbers, isWrittenIn, longestSharedRun } from "./tasks/checks.js";

describe("resolveLanguage (D9)", () => {
  it("prefers item, then project, then library", () => {
    expect(resolveLanguage({ item: "en", project: "fr", library: "de" })).toBe("en");
    expect(resolveLanguage({ project: "fr", library: "de" })).toBe("fr");
    expect(resolveLanguage({ library: "de" })).toBe("de");
    expect(resolveLanguage({ item: "", project: undefined, library: "de" })).toBe("de");
  });
});

describe("routing", () => {
  it("picks the task entry, then the wildcard", () => {
    const settings = { routing: { "card.paraphrase": "claude-code-cli", "*": "mock" } };
    expect(resolveBackendId(settings, "card.paraphrase")).toBe("claude-code-cli");
    expect(resolveBackendId(settings, "card.verify")).toBe("mock");
    expect(resolveBackendId({ routing: {} }, "card.verify")).toBeUndefined();
  });

  it("sends each task to its backend and explains misconfiguration", async () => {
    const fast = new MockBackend(
      { "card.paraphrase": { paraphrase: "fast", kind: "finding" } },
      "fast",
    );
    const slow = new MockBackend(
      { "card.paraphrase": { paraphrase: "slow", kind: "finding" } },
      "slow",
    );
    const router = new AiRouter([fast, slow], { routing: { "card.paraphrase": "slow" } });
    const res = await router.run("card.paraphrase", { passage: "x" });
    expect(res.output.paraphrase).toBe("slow");
    expect(fast.calls).toHaveLength(0);
    expect(() => router.backendFor("card.verify")).toThrow(/AI_NOT_CONFIGURED/);
    router.updateSettings({ routing: { "*": "gone" } });
    expect(() => router.backendFor("card.verify")).toThrow(/AI_UNKNOWN_BACKEND/);
  });
});

describe("MockBackend", () => {
  const schema = z.object({ a: z.number() });
  const req = { task: "t", prompt: "p", schema };

  it("returns scripted values and records calls", async () => {
    const m = new MockBackend({ t: { a: 1 } });
    expect(await m.complete({ ...req, language: "de", model: "smart" })).toEqual({ a: 1 });
    expect(m.calls[0]).toMatchObject({ task: "t", language: "de", model: "smart" });
  });

  it("validates, retries once and then fails with an agent-ready error", async () => {
    const m = new MockBackend({ t: [{ a: "bad" }, { a: 2 }] });
    expect(await m.complete(req)).toEqual({ a: 2 });
    const bad = new MockBackend({ t: { a: "bad" } });
    await expect(bad.complete(req)).rejects.toMatchObject({
      detail: { code: "AI_SCHEMA_INVALID" },
    });
  });

  it("accepts functions and fails loudly for unscripted tasks", async () => {
    const m = new MockBackend({ t: (_r: unknown, attempt: number) => ({ a: attempt }) });
    expect(await m.complete(req)).toEqual({ a: 1 });
    await expect(new MockBackend().complete(req)).rejects.toMatchObject({
      detail: { code: "AI_BACKEND_FAILED" },
    });
  });
});

describe("structured helpers", () => {
  it("parses fenced and wrapped JSON", () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('Sure! {"a":1} Hope that helps')).toEqual({ a: 1 });
    expect(parseJsonLoose("no json")).toBeUndefined();
  });

  it("exports JSON Schema without the $schema marker", () => {
    const js = toModelJsonSchema(z.object({ a: z.string() }));
    expect(js.$schema).toBeUndefined();
    expect(js.type).toBe("object");
  });
});

describe("nodeRunner", () => {
  it("kills a process that outlives the timeout", async () => {
    const r = await nodeRunner({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 10000)"],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 150,
    });
    expect(r.timedOut).toBe(true);
  });

  it("reports a missing binary and feeds stdin", async () => {
    const missing = await nodeRunner({
      command: "definitely-not-a-binary-xyz",
      args: [],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 1000,
    });
    expect(missing.spawnError).toBe("ENOENT");
    const echo = await nodeRunner({
      command: process.execPath,
      args: ["-e", "process.stdin.pipe(process.stdout)"],
      cwd: process.cwd(),
      env: process.env,
      stdin: "hello",
      timeoutMs: 5000,
    });
    expect(echo.stdout).toBe("hello");
  });

  it("drops session variables from the child environment", () => {
    const env = cleanEnv(
      CLAUDE_ENV_BLOCKLIST,
      {},
      { HOME: "/h", CLAUDECODE: "1", ANTHROPIC_API_KEY: "k" },
    );
    expect(env).toEqual({ HOME: "/h" });
  });
});

describe("task registry", () => {
  it("registers the tasks with versioned prompts, model classes and fixtures", () => {
    expect(TASK_NAMES).toEqual([
      "card.paraphrase",
      "card.verify",
      "matrix.fillCell",
      "metadata.fromFirstPage",
      "note.proposeLinks",
    ]);
    for (const name of TASK_NAMES) {
      const t = TASKS[name];
      expect(t.promptVersion).toBeGreaterThan(0);
      expect(["fast", "smart"]).toContain(t.modelClass);
      expect(t.fixtures.length).toBeGreaterThan(0);
    }
    expect(TASKS["card.paraphrase"].modelClass).toBe("fast");
    expect(paraphraseVersion).toBe(TASKS["card.paraphrase"].promptVersion);
    expect(() => getTask("nope")).toThrow(/AI_UNKNOWN_TASK/);
  });

  it("runs card.paraphrase through a backend with language and stamp", async () => {
    const mock = new MockBackend({ "card.paraphrase": { paraphrase: "Text", kind: "definition" } });
    const res = await runTask(
      mock,
      "card.paraphrase",
      { passage: "The sky is blue." },
      { language: "de" },
    );
    expect(res.output.kind).toBe("definition");
    expect(res.stamp.by).toBe("mock:mock-fast");
    expect(res.stamp.language).toBe("de");
    expect(mock.calls[0]?.system).toContain("German");
    expect(mock.calls[0]?.prompt).toContain("in German");
    expect(mock.calls[0]?.model).toBe("fast");
  });

  it("rejects invalid input before calling the backend", async () => {
    const mock = new MockBackend();
    await expect(runTask(mock, "card.paraphrase", { passage: "" })).rejects.toMatchObject({
      detail: { code: "AI_INPUT_INVALID" },
    });
    expect(mock.calls).toHaveLength(0);
  });

  it("states the no-new-claims rule in the paraphrase prompt", () => {
    const sys = TASKS["card.paraphrase"].system("en");
    expect(sys).toMatch(/Never add a claim/);
    expect(paraphrasePrompt({ passage: "x" }, "fr")).toContain("French");
  });

  it("runs card.verify on the smart class and keeps the issue list typed", async () => {
    const mock = new MockBackend({
      "card.verify": { faithful: false, issues: [{ kind: "added", detail: "adds a cause" }] },
    });
    const res = await runTask(mock, "card.verify", { passage: "p", paraphrase: "q" });
    expect(res.output.faithful).toBe(false);
    expect(mock.calls[0]?.model).toBe("smart");
    const bad = new MockBackend({
      "card.verify": { faithful: true, issues: [{ kind: "invented", detail: "x" }] },
    });
    await expect(
      runTask(bad, "card.verify", { passage: "p", paraphrase: "q" }),
    ).rejects.toMatchObject({
      detail: { code: "AI_SCHEMA_INVALID" },
    });
  });

  it("marks every metadata field as a proposal", async () => {
    const field = (value: unknown, evidence: string) => ({
      proposal: true,
      value,
      confidence: "high",
      evidence,
    });
    const nulls = {
      type: null,
      title: null,
      author: null,
      issued: null,
      "container-title": null,
      volume: null,
      issue: null,
      page: null,
      publisher: null,
      DOI: null,
      abstract: null,
      language: null,
    };
    const ok = {
      ...nulls,
      title: field("Soziale Systeme", "Soziale Systeme"),
      issued: field("1984", "1984"),
    };
    const mock = new MockBackend({ "metadata.fromFirstPage": ok });
    const res = await runTask(mock, "metadata.fromFirstPage", { text: "Soziale Systeme 1984" });
    expect(res.output.title?.proposal).toBe(true);
    const unmarked = { ...nulls, title: { value: "x", confidence: "high", evidence: "x" } };
    await expect(
      runTask(new MockBackend({ "metadata.fromFirstPage": unmarked }), "metadata.fromFirstPage", {
        text: "x",
      }),
    ).rejects.toMatchObject({ detail: { code: "AI_SCHEMA_INVALID" } });
  });
});

describe("eval checks", () => {
  const fixtures = TASKS["card.paraphrase"].fixtures;
  const sleep = fixtures[0];

  it("detects language, invented numbers and copying", () => {
    expect(
      isWrittenIn(
        "de",
        "Der Schlaf ist nicht nur ein Zustand der Ruhe, sondern wird auch für das Lernen genutzt.",
      ),
    ).toBe(true);
    expect(
      isWrittenIn(
        "en",
        "Der Schlaf ist nicht nur ein Zustand der Ruhe, und das ist wichtig für die Forschung.",
      ),
    ).toBe(false);
    expect(inventedNumbers("61 percent fell to 38", "fell from 61 to 40 percent")).toEqual(["40"]);
    expect(inventedNumbers("0,48 Effekt", "effect of 0.48")).toEqual([]);
    expect(longestSharedRun("a b c d e f", "x b c d e y")).toBe(4);
  });

  it("passes a faithful German paraphrase and flags an English one with an invented number", () => {
    if (!sleep) throw new Error("fixture missing");
    const good = {
      paraphrase:
        "Die Festigung von Erinnerungen im Schlaf gilt oft als Weitergabe vom Hippocampus an den Neokortex, doch die Befunde sind uneinheitlicher. Bei Nagetieren treffen Ripples auf das Wiederabspielen von Wegen, beim Menschen sind die Effekte mäßig und hängen vom Material ab.",
      kind: "finding" as const,
    };
    expect(sleep.check(good, sleep.input)).toEqual([]);
    const bad = {
      paraphrase:
        "Sleep helps the brain and improves recall by 30 percent in the study that the authors ran.",
      kind: "method" as const,
    };
    const fails = sleep.check(bad, sleep.input);
    expect(fails.join(" ")).toMatch(/not in de/);
    expect(fails.join(" ")).toMatch(/numbers not in passage: 30/);
    expect(fails.join(" ")).toMatch(/kind is method, expected finding/);
  });

  it("classifies kinds: every fixture names the kinds it accepts, and a wrong kind fails", () => {
    const ACCEPTS_CRITIQUE = new Set(["en-sleep-memory", "en-survey-response"]);
    const byId = (id: string) => fixtures.find((f) => f.id === id);
    const good = "Gesellschaft entsteht aus Kommunikation. Das ist eine kurze Aussage.";
    const expected: Record<string, string> = {
      "en-sleep-memory": "finding",
      "de-institutionen": "thesis",
      "en-survey-response": "finding",
      "de-lernen-feedback": "finding",
      "en-method-sampling": "method",
      "en-definition-social-capital": "definition",
      "de-beispiel-hafen": "example",
      "en-critique-metrics": "critique",
      "de-these-arbeit": "thesis",
    };
    expect(fixtures.map((f) => f.id).sort()).toEqual(Object.keys(expected).sort());
    // all six kinds appear in the fixtures
    expect(new Set(Object.values(expected)).size).toBe(6);
    for (const [id, kind] of Object.entries(expected)) {
      const f = byId(id);
      if (!f) throw new Error(`fixture ${id} missing`);
      const para = f.language === "de" ? good : "Society arises from communication. This is short.";
      const kindFails = (k: string) =>
        f
          .check({ paraphrase: para, kind: k as "finding" }, f.input)
          .filter((m) => m.startsWith("kind is"));
      expect(kindFails(kind), id).toEqual([]);
      // Passages that report results with stated limits accept finding or critique (prompt v4).
      const wrong = kind === "critique" || ACCEPTS_CRITIQUE.has(id) ? "example" : "critique";
      expect(kindFails(wrong), id).toHaveLength(1);
    }
  });

  it("limits the paraphrase to one to three sentences", () => {
    expect(sentenceCount("Ein Satz.")).toBe(1);
    expect(sentenceCount("Der Wert lag bei 0,48. Das ist hoch. Und stabil!")).toBe(3);
    expect(sentenceCount("Eins. Zwei. Drei. Vier.")).toBe(4);
    if (!sleep) throw new Error("fixture missing");
    const four = {
      paraphrase: "Der Schlaf hilft. Er festigt Erinnerungen. Das ist belegt. Aber nicht immer.",
      kind: "finding" as const,
    };
    expect(sleep.check(four, sleep.input).join(" ")).toMatch(/4 sentences, not 1 to 3/);
  });

  it("keeps the verify fixtures consistent with their intent", () => {
    const [faithful, unfaithful] = TASKS["card.verify"].fixtures;
    expect(faithful?.check({ faithful: true, issues: [] }, faithful.input)).toEqual([]);
    expect(unfaithful?.check({ faithful: true, issues: [] }, unfaithful.input)).not.toEqual([]);
  });
});
