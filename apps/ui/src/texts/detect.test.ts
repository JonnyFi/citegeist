import { describe, expect, it } from "vitest";
import { detectPlainCitations } from "./detect";

const library = [
  { citekey: "williams2013accelerate", authors: "Williams, Srnicek", year: "2013" },
  { citekey: "srnicek2013accelerate", authors: "Srnicek", year: "2013" },
  { citekey: "luhmann1984soziale", authors: "Luhmann", year: "1984" },
  { citekey: "muller2020a", authors: "Müller", year: "2020" },
  { citekey: "muller2020b", authors: "Müller", year: "2020" },
  { citekey: "hall2001many", authors: "Hall, Kim, Lee", year: "2001" },
];

const found = (text: string, lang = "de-DE") =>
  detectPlainCitations(text, library, lang).map((c) => ({ text: c.text, to: c.replacement }));

describe("detectPlainCitations", () => {
  it("finds the citation of a direct quote and converts it with the locator", () => {
    const body = "Er schreibt: „Der Tag kommt.“ (Williams & Srnicek, 2013, S. 1) und weiter.";
    expect(found(body)).toEqual([
      { text: "(Williams & Srnicek, 2013, S. 1)", to: "[@williams2013accelerate, S. 1]" },
    ]);
    const [hit] = detectPlainCitations(body, library);
    expect(body.slice(hit?.from, hit?.to)).toBe("(Williams & Srnicek, 2013, S. 1)");
  });

  it("keeps the prefix of an indirect citation", () => {
    expect(found("Systeme erzeugen sich selbst (vgl. Luhmann, 1984, S. 31).")).toEqual([
      { text: "(vgl. Luhmann, 1984, S. 31)", to: "[vgl. @luhmann1984soziale, S. 31]" },
    ]);
  });

  it("reads the Chicago form and the English terms", () => {
    expect(found("As argued (cf. Williams and Srnicek 2013, 4).", "en-US")).toEqual([
      { text: "(cf. Williams and Srnicek 2013, 4)", to: "[cf. @williams2013accelerate, p. 4]" },
    ]);
    expect(found("Dort (Luhmann 1984, pp. 31-33).", "en-US")[0]?.to).toBe(
      "[@luhmann1984soziale, pp. 31-33]",
    );
  });

  it("writes the locator terms of the language of the text", () => {
    expect(found("Dort (Luhmann, 1984, p. 31).", "de-DE")[0]?.to).toBe(
      "[@luhmann1984soziale, S. 31]",
    );
    expect(found("Dort (Luhmann, 1984, Abs. 4).", "en-US")[0]?.to).toBe(
      "[@luhmann1984soziale, para. 4]",
    );
  });

  it("converts a citation without a locator and one with several sources", () => {
    expect(found("Belegt (Luhmann, 1984).")[0]?.to).toBe("[@luhmann1984soziale]");
    expect(found("Belegt (Luhmann, 1984; vgl. Srnicek, 2013, S. 2).")[0]?.to).toBe(
      "[@luhmann1984soziale; vgl. @srnicek2013accelerate, S. 2]",
    );
  });

  it("matches et al. against the first author of a work with several authors", () => {
    expect(found("Viele (Hall et al., 2001, S. 5).")[0]?.to).toBe("[@hall2001many, S. 5]");
  });

  it("leaves alone what names no item or more than one", () => {
    expect(found("Unbekannt (Nobody, 2020).")).toEqual([]);
    expect(found("Falsches Jahr (Luhmann, 1985).")).toEqual([]);
    expect(found("Mehrdeutig (Müller, 2020).")).toEqual([]);
    expect(found("Mit Suffix (Müller, 2020a).")).toEqual([]);
    expect(found("Nur ein Autor genannt (Williams, 2013).")).toEqual([]);
  });

  it("leaves alone what is not a citation", () => {
    expect(found("Ein Hinweis (siehe oben) und ein Jahr (1984).")).toEqual([]);
    expect(found("Ein Link [Luhmann](Luhmann, 1984).")).toEqual([]);
    expect(found("Code `(Luhmann, 1984)` bleibt.")).toEqual([]);
    expect(found("```\n(Luhmann, 1984)\n```\n")).toEqual([]);
    expect(found("Schon Pandoc [@luhmann1984soziale, S. 31].")).toEqual([]);
    expect(found("Unbekanntes Locator-Wort (Luhmann, 1984, passim).")).toEqual([]);
  });

  it("gives every citation of a text its own range", () => {
    const body = "A (Luhmann, 1984, S. 1).\nB (Luhmann, 1984, S. 2).\n";
    const hits = detectPlainCitations(body, library);
    expect(hits.map((h) => body.slice(h.from, h.to))).toEqual([
      "(Luhmann, 1984, S. 1)",
      "(Luhmann, 1984, S. 2)",
    ]);
  });
});
