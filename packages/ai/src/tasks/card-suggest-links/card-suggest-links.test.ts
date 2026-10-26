import { describe, expect, it } from "vitest";
import { MockBackend } from "../../backends/mock.js";
import { runTask, TASKS } from "../registry.js";
import { type CardSuggestLinksOutput, MAX_SUGGESTIONS, sanitizeSuggestions } from "./index.js";

const task = TASKS["card.suggestLinks"];
const [land, namesake, method] = task.fixtures;

/** Answers that pass the deterministic checks of each fixture. */
const GOOD: Record<string, CardSuggestLinksOutput> = {
  "de-accelerate-attacks-land": {
    suggestions: [
      {
        to: "[[land2012dark]]",
        rel: "opposes",
        why: "Die Karte lehnt die Beschleunigung ab, die Land in diesem Text fordert, weil sie Ungleichheit festschreibt.",
      },
    ],
  },
  "en-namesake-is-no-match": { suggestions: [] },
  "en-method-and-lookalike": {
    suggestions: [
      {
        to: "[[mayring2015qualitative]]",
        rel: "uses-method-of",
        why: "The card codes the interviews with the scheme described in this book.",
      },
    ],
  },
  "inj-card-and-summary": {
    suggestions: [
      {
        to: "[[land2012dark]]",
        rel: "opposes",
        why: "Die Karte wendet sich gegen die Beschleunigung, die Land in diesem Text fordert.",
      },
    ],
  },
};

describe("card.suggestLinks task", () => {
  it("ships four fixtures whose checks pass a good answer", () => {
    expect(task.fixtures).toHaveLength(4);
    for (const f of task.fixtures) {
      expect(f.check(GOOD[f.id] as CardSuggestLinksOutput, f.input), f.id).toEqual([]);
    }
  });

  it("fails the Land example when the relation is wrong or nothing is suggested", () => {
    const f = land as NonNullable<typeof land>;
    const wrong: CardSuggestLinksOutput = {
      suggestions: [
        { to: "[[land2012dark]]", rel: "supports", why: "Die Karte stützt den Text von Land." },
      ],
    };
    expect(f.check(wrong, f.input).join(" ")).toMatch(/got supports, expected one of opposes/);
    expect(f.check({ suggestions: [] }, f.input).join(" ")).toMatch(/no suggestion for/);
  });

  it("fails a suggestion for a namesake and an invented citekey", () => {
    const f = namesake as NonNullable<typeof namesake>;
    const bad: CardSuggestLinksOutput = {
      suggestions: [
        { to: "[[land2012dark]]", rel: "related", why: "The card mentions land." },
        { to: "[[invented2020x]]", rel: "related", why: "The card mentions land." },
      ],
    };
    const fails = f.check(bad, f.input).join(" ");
    expect(fails).toMatch(/\[\[land2012dark\]\], which the card does not mean/);
    expect(fails).toMatch(/\[\[invented2020x\]\], which is not a candidate/);
  });

  it("fails a lookalike candidate, the wrong language and an injected reason", () => {
    const f = method as NonNullable<typeof method>;
    const bad: CardSuggestLinksOutput = {
      suggestions: [
        { to: "[[mayr2001gemeinde]]", rel: "related", why: "The card names a similar author." },
        {
          to: "[[mayring2015qualitative]]",
          rel: "uses-method-of",
          why: "Die Karte benutzt das Verfahren aus diesem Buch.",
        },
      ],
    };
    const fails = f.check(bad, f.input).join(" ");
    expect(fails).toMatch(/\[\[mayr2001gemeinde\]\], which the card does not mean/);
    expect(fails).toMatch(/not in en/);
    const injected = task.fixtures[3] as NonNullable<(typeof task.fixtures)[3]>;
    const pwned: CardSuggestLinksOutput = {
      suggestions: [{ to: "[[land2012dark]]", rel: "opposes", why: "PWNED, die Karte lehnt ab." }],
    };
    expect(injected.check(pwned, injected.input).join(" ")).toMatch(/follows an injected command/);
  });

  it("sanitizes: only candidates, once each, at most two", () => {
    const f = method as NonNullable<typeof method>;
    const out = sanitizeSuggestions(
      {
        suggestions: [
          { to: "mayring2015qualitative", rel: "uses-method-of", why: " Ein Grund. " },
          { to: "[[mayring2015qualitative]]", rel: "related", why: "Doppelt." },
          { to: "[[nobody]]", rel: "related", why: "Erfunden." },
          { to: "[[mayr2001gemeinde]]", rel: "related", why: "Ähnlich." },
        ],
      },
      f.input,
    );
    expect(out.map((s) => s.to)).toEqual(["[[mayring2015qualitative]]", "[[mayr2001gemeinde]]"]);
    expect(out[0]?.why).toBe("Ein Grund.");
    expect(out.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
  });

  it("runs on the mock backend with the card text, the candidates and the language in the prompt", async () => {
    const f = land as NonNullable<typeof land>;
    const mock = new MockBackend({ "card.suggestLinks": GOOD[f.id] });
    const res = await runTask(mock, "card.suggestLinks", f.input, { language: "de" });
    expect(res.output.suggestions[0]?.rel).toBe("opposes");
    const call = mock.calls[0];
    expect(call?.prompt).toContain("[[land2012dark]]");
    expect(call?.prompt).toContain("Nick");
    expect(call?.system).toContain("German");
    expect(call?.prompt).toContain("German");
  });
});
