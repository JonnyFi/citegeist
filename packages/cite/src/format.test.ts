import { describe, expect, it } from "vitest";
import {
  exportProjectBib,
  exportProjectCslJson,
  formatCite,
  parseBibtex,
  parseCslJson,
} from "./index.js";
import { SAMPLE_ITEMS } from "./testing/samples.js";

const refs = [
  { citekey: "luhmann1984soziale", locator: "31", prefix: "vgl." },
  { citekey: "foucault1976uberwachen" },
];

describe("cite.format", () => {
  it("formats a citation in text and html", () => {
    expect(formatCite(SAMPLE_ITEMS, { items: [refs[0] ?? { citekey: "" }] }, {}).text).toBe(
      "(vgl. Luhmann, 1984, S. 31)",
    );
    const html = formatCite(SAMPLE_ITEMS, { items: refs, format: "html", locale: "en-US" });
    expect(html.text).toBe("(Foucault, 1976; vgl. Luhmann, 1984, p. 31)");
    expect(html.html).toBeDefined();
  });

  it("formats a bibliography with project defaults", () => {
    const out = formatCite(
      SAMPLE_ITEMS,
      { items: refs, mode: "bibliography" },
      { style: "deutsche-gesellschaft-fur-psychologie", locale: "de-DE" },
    );
    expect(out.text.split("\n")).toEqual([
      "Foucault, M. (1976). Überwachen und Strafen: Die Geburt des Gefängnisses. (W. Seitter, Übers.) (14. Auflage). Frankfurt am Main: Suhrkamp.",
      "Luhmann, N. (1984). Soziale Systeme: Grundriß einer allgemeinen Theorie. Frankfurt am Main: Suhrkamp.",
    ]);
  });

  it("formats a Pandoc cluster", () => {
    expect(formatCite(SAMPLE_ITEMS, { items: refs, format: "pandoc" }).text).toBe(
      "[vgl. @luhmann1984soziale, S. 31; @foucault1976uberwachen]",
    );
  });

  it("returns BibLaTeX and CSL-JSON for the cited items", () => {
    const bib = formatCite(SAMPLE_ITEMS, { items: refs, format: "bibtex" }).text;
    expect(parseBibtex(bib).items.map((i) => i.citekey)).toEqual([
      "luhmann1984soziale",
      "foucault1976uberwachen",
    ]);
    const json = formatCite(SAMPLE_ITEMS, { items: refs, format: "csl-json" }).text;
    expect(parseCslJson(json)).toHaveLength(2);
  });

  it("fails with an agent ready error for unknown keys", () => {
    expect(() =>
      formatCite(SAMPLE_ITEMS, { items: [{ citekey: "missing2000key" }], format: "bibtex" }),
    ).toThrow(/CITE_UNKNOWN_ITEM/);
  });
});

describe("project export", () => {
  it("writes all items to .bib and CSL-JSON", () => {
    const bib = exportProjectBib(SAMPLE_ITEMS);
    expect(parseBibtex(bib).items).toHaveLength(SAMPLE_ITEMS.length);
    const json = exportProjectCslJson(SAMPLE_ITEMS);
    expect(JSON.parse(json)).toHaveLength(SAMPLE_ITEMS.length);
    expect(json.endsWith("\n")).toBe(true);
  });
});
