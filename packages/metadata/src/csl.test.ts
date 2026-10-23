import { describe, expect, it } from "vitest";
import { mapCslLike, mapType } from "./csl.js";
import { fixShoutedName, jatsToText, splitPersonName } from "./text.js";

describe("mapCslLike", () => {
  it("maps a Crossref work", () => {
    const f = mapCslLike({
      type: "book-chapter",
      DOI: "10.1007/ABC_1",
      title: ["Chapter <i>One</i>", "Second title"],
      subtitle: ["A subtitle"],
      "container-title": ["The Book"],
      author: [{ given: "A", family: "Writer", ORCID: "http://orcid.org/0000-0002-1825-0097" }],
      issued: { "date-parts": [[2025, 3]] },
      page: "10–20",
      ISBN: [
        "http://id.crossref.org/isbn/9783658317157",
        "http://id.crossref.org/isbn/9783658317164",
      ],
      "isbn-type": [
        { value: "9783658317164", type: "electronic" },
        { value: "9783658317157", type: "print" },
      ],
      "issn-type": [{ value: "12345678", type: "print" }],
      URL: "http://dx.doi.org/10.1007/ABC_1",
      language: "de",
    });
    expect(f).toEqual({
      type: "chapter",
      DOI: "10.1007/abc_1",
      title: "Chapter One",
      subtitle: "A subtitle",
      "container-title": "The Book",
      author: [{ given: "A", family: "Writer", orcid: "0000-0002-1825-0097" }],
      issued: "2025-03",
      page: "10-20",
      ISBN: "9783658317157",
      ISSN: "1234-5678",
      language: "de",
    });
  });

  it("maps CSL-JSON with literal authors, 3-letter language and entities", () => {
    const f = mapCslLike({
      type: "book",
      title: "Report",
      author: [
        { literal: "European Commission. Joint Research Centre." },
        { family: "C&#243;ceres" },
      ],
      language: "eng",
      issued: { "date-parts": [[2025]] },
    });
    expect(f.author).toEqual([
      { literal: "European Commission. Joint Research Centre." },
      { family: "Cóceres" },
    ]);
    expect(f.language).toBe("en");
    expect(f.issued).toBe("2025");
  });

  it("ignores empty dates and unknown types", () => {
    const f = mapCslLike({ type: "no-such-type", title: "T", issued: { "date-parts": [[null]] } });
    expect(f.type).toBeUndefined();
    expect(f.issued).toBeUndefined();
  });

  it("maps Crossref and CSL type names", () => {
    expect(mapType("journal-article")).toBe("article-journal");
    expect(mapType("posted-content")).toBe("article");
    expect(mapType("dissertation")).toBe("thesis");
    expect(mapType("dataset")).toBe("dataset");
    expect(mapType("software")).toBe("software");
    expect(mapType("nonsense")).toBeUndefined();
  });
});

describe("text helpers", () => {
  it("turns JATS into paragraphs without section titles", () => {
    const xml =
      "<jats:title>Abstract</jats:title><jats:p>First <jats:italic>part</jats:italic>.</jats:p><jats:p>Second &amp; last.</jats:p>";
    expect(jatsToText(xml)).toBe("First part.\n\nSecond & last.");
  });

  it("fixes names in capitals only", () => {
    expect(fixShoutedName("FEARON")).toBe("Fearon");
    expect(fixShoutedName("JEAN-PAUL")).toBe("Jean-Paul");
    expect(fixShoutedName("McDonald")).toBe("McDonald");
    expect(fixShoutedName("D")).toBe("D");
  });

  it("splits person names with particles", () => {
    expect(splitPersonName("Niklas Luhmann")).toEqual({ given: "Niklas", family: "Luhmann" });
    expect(splitPersonName("Stéfan J. van der Walt")).toEqual({
      given: "Stéfan J.",
      family: "van der Walt",
    });
    expect(splitPersonName("Luhmann, Niklas")).toEqual({ family: "Luhmann", given: "Niklas" });
    expect(splitPersonName("Plato")).toEqual({ family: "Plato" });
  });
});
