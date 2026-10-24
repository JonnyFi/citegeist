import { describe, expect, it } from "vitest";
import { MockBackend } from "../../backends/mock.js";
import { runTask } from "../registry.js";
import { litsearchSuggestQueriesFixtures } from "./fixtures.js";
import { planSuggestedQueries, queryKey } from "./index.js";

describe("queryKey", () => {
  it("treats plural and case variants as the same query, like sources.query_key", () => {
    // protects: the suggestion list drops duplicates the pipeline would drop anyway
    // fails_when: "Agents" and "agent" differ, or "analysis", "class" and "status" lose their s
    // no_claim: parity with the Python rule is checked on these words, not exhaustively
    expect(queryKey('"Multi-Agent Systems"')).toBe(queryKey('"multi-agent system"'));
    expect(queryKey("Policies")).toBe("policy");
    expect(queryKey("classes")).toBe("class");
    expect(queryKey("analysis status class")).toBe("analysis status class");
  });
});

describe("planSuggestedQueries", () => {
  it("keeps core queries before variants under the cap and drops duplicates", () => {
    // protects: with a tight cap the user gets the core queries, not three variants of the first one
    // fails_when: a variant pushes out a core query, a plural duplicate survives, or the cap is exceeded
    // no_claim: none beyond protects
    const planned = planSuggestedQueries(
      {
        queries: [
          {
            query: '"agent communication"',
            variants: ['"agents communicating"', '"Agent communications"'],
          },
          { query: '"multi-agent dialogue"', variants: [] },
          { query: "  LLM   agents  protocol ", variants: [] },
        ],
      },
      4,
    );
    expect(planned).toEqual([
      { query: '"agent communication"', kind: "core" },
      { query: '"agents communicating"', kind: "variant" },
      { query: '"multi-agent dialogue"', kind: "core" },
      { query: "LLM agents protocol", kind: "core" },
    ]);
    expect(planSuggestedQueries({ queries: [{ query: "a b", variants: ["c d"] }] }, 1)).toEqual([
      { query: "a b", kind: "core" },
    ]);
  });
});

describe("litsearch.suggestQueries", () => {
  it("runs through a backend and passes its fixture checks with a good answer", async () => {
    // protects: the task is wired (prompt, schema) and its eval checks accept a well-formed answer
    // fails_when: the task is missing from the registry or the checks reject queries that follow the rules
    // no_claim: a mock backend answers; real model quality is measured by the eval runner, not here
    const answer = {
      queries: [
        { query: '"agent communication protocol"', variants: ['"agent communication protocols"'] },
        { query: '"multi-agent communication"', variants: [] },
        { query: '"agent-to-agent" communication', variants: [] },
        { query: '"LLM agents" interoperability', variants: [] },
      ],
    };
    const mock = new MockBackend({ "litsearch.suggestQueries": answer });
    const res = await runTask(mock, "litsearch.suggestQueries", {
      topic: "communication protocols between ai agents",
    });
    expect(res.output.queries).toHaveLength(4);
    const fixture = litsearchSuggestQueriesFixtures[0];
    expect(fixture?.check(res.output, { topic: "x", maxQueries: 10 })).toEqual([]);
    expect(
      fixture?.check(
        { queries: [{ query: "agents AND protocols", variants: [] }] },
        { topic: "x", maxQueries: 10 },
      ),
    ).toEqual(
      expect.arrayContaining([
        "only 1 core queries",
        '"agents AND protocols" uses operators or field prefixes',
        "no quoted phrase",
      ]),
    );
  });
});
