import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURE_DIR, LUHMANN_QUERY, LUHMANN_SHORT_QUERY, TRAP_QUERIES } from "./fixture-cases.js";
import {
  matchTitle,
  scoreCandidate,
  TITLE_THRESHOLD,
  type TitleQuery,
  titleSimilarity,
  typesCompatible,
} from "./match.js";
import { createReplayFetch } from "./replay.js";
import { createResolver } from "./resolver.js";
import type { MetadataFields } from "./types.js";

const luhmann: TitleQuery = LUHMANN_QUERY;

/** The shape of the trap: the title passes, author, year and type do not. */
const handbookChapter: MetadataFields = {
  type: "chapter",
  title: "Soziale Systeme: Grundriß einer allgemeinen Theorie",
  author: [{ family: "Höhn", given: "Hans-Joachim" }],
  "container-title": "Niklas Luhmann Handbuch",
  issued: "2020",
  DOI: "10.1007/example-chapter",
};

describe("threshold", () => {
  it("is documented as 0.9", () => {
    expect(TITLE_THRESHOLD).toBe(0.9);
  });
});

describe("titleSimilarity", () => {
  it("ignores case, punctuation and diacritics", () => {
    expect(titleSimilarity("The Strength of Weak Ties", "the strength of weak ties.")).toBe(1);
    expect(titleSimilarity("Grundriß", "Grundriss")).toBe(1);
  });

  it("tolerates a missing subtitle on one side", () => {
    expect(
      titleSimilarity("Soziale Systeme", "Soziale Systeme: Grundriß einer allgemeinen Theorie"),
    ).toBeGreaterThanOrEqual(TITLE_THRESHOLD);
  });

  it("tolerates OCR noise but not different titles", () => {
    expect(titleSimilarity("Social Capital and Trust", "Social Capitai and Trust")).toBeGreaterThan(
      TITLE_THRESHOLD,
    );
    expect(
      titleSimilarity("Thematic Analysis", "Using thematic analysis in psychology"),
    ).toBeLessThan(TITLE_THRESHOLD);
  });
});

describe("types", () => {
  it("treats article, preprint and conference paper as one group", () => {
    expect(typesCompatible("article-journal", "article")).toBe(true);
    expect(typesCompatible("article-journal", "paper-conference")).toBe(true);
  });

  it("keeps book and chapter apart", () => {
    expect(typesCompatible("book", "chapter")).toBe(false);
    expect(typesCompatible("article-journal", "chapter")).toBe(false);
  });
});

describe("Luhmann trap", () => {
  it("rejects a handbook chapter with the same title", () => {
    const scored = scoreCandidate(luhmann, handbookChapter);
    expect(scored.titleSimilarity).toBeGreaterThanOrEqual(TITLE_THRESHOLD);
    expect(scored.failed.sort()).toEqual(["author", "type", "year"]);
    expect(scored.verdict).toBe("reject");
    expect(matchTitle(luhmann, [handbookChapter]).verdict).toBe("reject");
  });

  it("still rejects when the query has no type", () => {
    const { type: _type, ...noType } = luhmann;
    const result = matchTitle(noType, [handbookChapter]);
    expect(result.verdict).toBe("reject");
    expect(result.scored[0]?.failed).toContain("author");
  });

  it("accepts the real book record", () => {
    const book: MetadataFields = {
      type: "book",
      title: "Soziale Systeme",
      subtitle: "Grundriß einer allgemeinen Theorie",
      author: [{ family: "Luhmann", given: "Niklas" }],
      issued: "1984",
    };
    const result = matchTitle(luhmann, [handbookChapter, book]);
    expect(result.verdict).toBe("accept");
    expect(result.accepted).toBe(book);
  });

  it("rejects every hit Crossref returned for the recorded searches", async () => {
    const resolver = createResolver({
      fetch: createReplayFetch(join(FIXTURE_DIR, "http")),
      sleep: async () => {},
    });
    for (const query of [LUHMANN_QUERY, LUHMANN_SHORT_QUERY]) {
      const { match, resolved } = await resolver.resolveByTitle(query);
      expect(match.scored.length).toBeGreaterThan(0);
      expect(match.verdict).toBe("reject");
      expect(resolved).toBeUndefined();
      for (const s of match.scored) expect(s.failed).toContain("year");
    }
  });
});

describe("other conditions", () => {
  const article: MetadataFields = {
    type: "article-journal",
    title: "The Strength of Weak Ties",
    author: [{ family: "Granovetter", given: "Mark S." }],
    issued: "1973-05",
    DOI: "10.1086/225469",
  };

  it("accepts when title, author, year and type agree", () => {
    const q: TitleQuery = {
      title: "The strength of weak ties",
      firstAuthor: "Granovetter, M.",
      year: 1973,
      type: "article-journal",
    };
    expect(matchTitle(q, [article]).verdict).toBe("accept");
  });

  it("accepts a year one off (preprint versus print) but not two", () => {
    const base: TitleQuery = {
      title: "The strength of weak ties",
      firstAuthor: "Granovetter",
      type: "article-journal",
    };
    expect(matchTitle({ ...base, year: 1974 }, [article]).verdict).toBe("accept");
    expect(matchTitle({ ...base, year: 1975 }, [article]).verdict).toBe("reject");
  });

  it("rejects a different first author", () => {
    const q: TitleQuery = {
      title: "The strength of weak ties",
      firstAuthor: "Putnam",
      year: 1973,
      type: "article-journal",
    };
    expect(matchTitle(q, [article]).scored[0]?.failed).toEqual(["author"]);
  });

  it("asks for review when the query lacks author, year or type", () => {
    const result = matchTitle({ title: "The strength of weak ties" }, [article]);
    expect(result.verdict).toBe("review");
    expect(result.accepted).toBeUndefined();
    expect(result.scored[0]?.unverified.sort()).toEqual(["author", "type", "year"]);
  });

  it("downgrades two equally good candidates with different DOIs to review", () => {
    const twin = { ...article, DOI: "10.1086/other" };
    const q: TitleQuery = {
      title: "The strength of weak ties",
      firstAuthor: "Granovetter",
      year: 1973,
      type: "article-journal",
    };
    expect(matchTitle(q, [article, twin]).verdict).toBe("review");
  });
});

describe("recorded Crossref searches", () => {
  it("accepts the right article and rejects the reprint chapters", async () => {
    const resolver = createResolver({
      fetch: createReplayFetch(join(FIXTURE_DIR, "http")),
      sleep: async () => {},
    });
    for (const query of TRAP_QUERIES) {
      const { match, resolved } = await resolver.resolveByTitle(query);
      expect(match.verdict).toBe("accept");
      expect(match.accepted?.type).toBe("article-journal");
      expect(resolved?.status).toBe("resolved");
      expect(resolved?.fields.DOI).toBe(match.accepted?.DOI?.toLowerCase());
    }
  });
});
