import { describe, expect, it } from "vitest";
import { type CardExportEntry, type CardExportFormat, exportCard, exportCards } from "./index.js";
import { SAMPLE_ITEMS } from "./testing/samples.js";

const luhmann = SAMPLE_ITEMS[0];
const foucault = SAMPLE_ITEMS[7];
if (!luhmann || !foucault) throw new Error("samples missing");

const entry: CardExportEntry = {
  card: { locator: { label: "page", start: "31", confirmed: true } },
  body: {
    quote: "Soziale Systeme sind „autopoietisch“ organisiert & operieren [sic] 100% 'selbst'.",
    paraphrase: "Soziale Systeme erzeugen ihre Elemente selbst.",
    ownWords: "Gesellschaft reproduziert sich über Kommunikation.",
  },
  item: luhmann,
};

const FORMATS: CardExportFormat[] = ["html", "text", "pandoc", "latex", "typst"];

function all(e: CardExportEntry, mode: "direct" | "indirect", locale: string, policy = {}) {
  return Object.fromEntries(
    FORMATS.map((format) => [
      format,
      exportCard(e, { mode, format, locale, style: "apa", policy }),
    ]),
  );
}

describe("direct quote", () => {
  it("renders German in every format", () => {
    expect(all(entry, "direct", "de-DE")).toMatchInlineSnapshot(`
      {
        "html": {
          "html": "<p>„Soziale Systeme sind ‚autopoietisch‘ organisiert &amp; operieren [sic] 100% 'selbst'.“ (Luhmann, 1984, S. 31)</p>",
          "text": "„Soziale Systeme sind ‚autopoietisch‘ organisiert & operieren [sic] 100% 'selbst'.“ (Luhmann, 1984, S. 31)",
        },
        "latex": {
          "text": "\\enquote{Soziale Systeme sind \\enquote{autopoietisch} organisiert \\& operieren [sic] 100\\% 'selbst'.} \\parencite[31]{luhmann1984soziale}",
        },
        "pandoc": {
          "text": "„Soziale Systeme sind ‚autopoietisch‘ organisiert & operieren \\[sic\\] 100% 'selbst'.“ [@luhmann1984soziale, S. 31]",
        },
        "text": {
          "text": "„Soziale Systeme sind ‚autopoietisch‘ organisiert & operieren [sic] 100% 'selbst'.“ (Luhmann, 1984, S. 31)",
        },
        "typst": {
          "text": "„Soziale Systeme sind ‚autopoietisch‘ organisiert & operieren \\[sic\\] 100% 'selbst'.“ @luhmann1984soziale[S. 31]",
        },
      }
    `);
  });

  it("renders English in every format", () => {
    expect(all(entry, "direct", "en-US")).toMatchInlineSnapshot(`
      {
        "html": {
          "html": "<p>“Soziale Systeme sind ‘autopoietisch’ organisiert &amp; operieren [sic] 100% 'selbst'.” (Luhmann, 1984, p. 31)</p>",
          "text": "“Soziale Systeme sind ‘autopoietisch’ organisiert & operieren [sic] 100% 'selbst'.” (Luhmann, 1984, p. 31)",
        },
        "latex": {
          "text": "\\enquote{Soziale Systeme sind \\enquote{autopoietisch} organisiert \\& operieren [sic] 100\\% 'selbst'.} \\parencite[31]{luhmann1984soziale}",
        },
        "pandoc": {
          "text": "“Soziale Systeme sind ‘autopoietisch’ organisiert & operieren \\[sic\\] 100% 'selbst'.” [@luhmann1984soziale, p. 31]",
        },
        "text": {
          "text": "“Soziale Systeme sind ‘autopoietisch’ organisiert & operieren [sic] 100% 'selbst'.” (Luhmann, 1984, p. 31)",
        },
        "typst": {
          "text": "“Soziale Systeme sind ‘autopoietisch’ organisiert & operieren \\[sic\\] 100% 'selbst'.” @luhmann1984soziale[p. 31]",
        },
      }
    `);
  });

  it("matches the documented text form", () => {
    const plain = {
      ...entry,
      body: { quote: "Wortlaut" },
    };
    const out = exportCard(plain, { mode: "direct", format: "text", style: "chicago-author-date" });
    expect(out.text).toBe("„Wortlaut“ (Luhmann 1984, 31)");
    expect(out.html).toBeUndefined();
  });

  it("uses the Pandoc, LaTeX and Typst forms from the spec", () => {
    const plain = { ...entry, body: { quote: "Wortlaut" } };
    const o = { mode: "indirect", locale: "de-DE" } as const;
    expect(
      exportCard({ ...plain, body: { ownWords: "Text", quote: "q" } }, { ...o, format: "pandoc" })
        .text,
    ).toBe("Text [vgl. @luhmann1984soziale, S. 31]");
    expect(
      exportCard({ ...plain, body: { ownWords: "Text", quote: "q" } }, { ...o, format: "latex" })
        .text,
    ).toBe("Text \\parencite[vgl.][31]{luhmann1984soziale}");
  });
});

describe("indirect quote", () => {
  it("adds vgl. for German locales in every format", () => {
    expect(all(entry, "indirect", "de-DE")).toMatchInlineSnapshot(`
      {
        "html": {
          "html": "<p>Gesellschaft reproduziert sich über Kommunikation. (vgl. Luhmann, 1984, S. 31)</p>",
          "text": "Gesellschaft reproduziert sich über Kommunikation. (vgl. Luhmann, 1984, S. 31)",
        },
        "latex": {
          "text": "Gesellschaft reproduziert sich über Kommunikation. \\parencite[vgl.][31]{luhmann1984soziale}",
        },
        "pandoc": {
          "text": "Gesellschaft reproduziert sich über Kommunikation. [vgl. @luhmann1984soziale, S. 31]",
        },
        "text": {
          "text": "Gesellschaft reproduziert sich über Kommunikation. (vgl. Luhmann, 1984, S. 31)",
        },
        "typst": {
          "text": "Gesellschaft reproduziert sich über Kommunikation. vgl. @luhmann1984soziale[S. 31]",
        },
      }
    `);
  });

  it("has no prefix for English", () => {
    expect(all(entry, "indirect", "en-US")).toMatchInlineSnapshot(`
      {
        "html": {
          "html": "<p>Gesellschaft reproduziert sich über Kommunikation. (Luhmann, 1984, p. 31)</p>",
          "text": "Gesellschaft reproduziert sich über Kommunikation. (Luhmann, 1984, p. 31)",
        },
        "latex": {
          "text": "Gesellschaft reproduziert sich über Kommunikation. \\parencite[31]{luhmann1984soziale}",
        },
        "pandoc": {
          "text": "Gesellschaft reproduziert sich über Kommunikation. [@luhmann1984soziale, p. 31]",
        },
        "text": {
          "text": "Gesellschaft reproduziert sich über Kommunikation. (Luhmann, 1984, p. 31)",
        },
        "typst": {
          "text": "Gesellschaft reproduziert sich über Kommunikation. @luhmann1984soziale[p. 31]",
        },
      }
    `);
  });
});

describe("export policy", () => {
  const aiOnly: CardExportEntry = { ...entry, body: { ...entry.body, ownWords: undefined } };
  const opts = { mode: "indirect", format: "text", locale: "de-DE", style: "apa" } as const;

  it("prefers own words, then the AI paraphrase", () => {
    expect(exportCard(entry, opts).text).toBe(
      "Gesellschaft reproduziert sich über Kommunikation. (vgl. Luhmann, 1984, S. 31)",
    );
    expect(exportCard(aiOnly, opts).text).toBe(
      "Soziale Systeme erzeugen ihre Elemente selbst. (vgl. Luhmann, 1984, S. 31)",
    );
  });

  it("labels an AI paraphrase when asked, and only then", () => {
    expect(exportCard(aiOnly, { ...opts, policy: { labelAi: true } }).text).toBe(
      "Soziale Systeme erzeugen ihre Elemente selbst. [KI-generierte Paraphrase] (vgl. Luhmann, 1984, S. 31)",
    );
    expect(exportCard(entry, { ...opts, policy: { labelAi: true } }).text).not.toContain("KI");
    expect(
      exportCard(aiOnly, { ...opts, locale: "en-US", policy: { labelAi: true } }).text,
    ).toContain("[AI-generated paraphrase]");
  });

  it("honors the paraphrase source", () => {
    const cite = "(vgl. Luhmann, 1984, S. 31)";
    expect(exportCard(entry, { ...opts, policy: { paraphrase: "ai" } }).text).toBe(
      `Soziale Systeme erzeugen ihre Elemente selbst. ${cite}`,
    );
    expect(exportCard(aiOnly, { ...opts, policy: { paraphrase: "own" } }).text).toBe(cite);
    expect(exportCard(entry, { ...opts, policy: { paraphrase: "none" } }).text).toBe(cite);
  });

  it("never touches the paraphrase of a direct quote", () => {
    const out = exportCard(entry, {
      mode: "direct",
      format: "text",
      locale: "de-DE",
      policy: { paraphrase: "none", labelAi: true },
    });
    expect(out.text).not.toContain("Soziale Systeme erzeugen");
    expect(out.text).toContain("autopoietisch");
  });
});

describe("locators and secondary sources", () => {
  it("renders ranges and other labels", () => {
    const range: CardExportEntry = {
      ...entry,
      body: { quote: "Q" },
      card: { locator: { label: "page", start: "31", end: "33", confirmed: false } },
    };
    expect(exportCard(range, { format: "text", locale: "de-DE" }).text).toBe(
      "„Q“ (Luhmann, 1984, S. 31–33)",
    );
    expect(exportCard(range, { format: "latex", locale: "de-DE" }).text).toBe(
      "\\enquote{Q} \\parencite[31--33]{luhmann1984soziale}",
    );
    const chapter: CardExportEntry = {
      ...entry,
      body: { quote: "Q" },
      card: { locator: { label: "chapter", start: "3", confirmed: true } },
    };
    expect(exportCard(chapter, { format: "latex", locale: "de-DE" }).text).toBe(
      "\\enquote{Q} \\parencite[Kap. 3]{luhmann1984soziale}",
    );
    expect(exportCard(chapter, { format: "pandoc", locale: "de-DE" }).text).toBe(
      "„Q“ [@luhmann1984soziale, Kap. 3]",
    );
  });

  it("works without a locator", () => {
    const bare: CardExportEntry = { ...entry, body: { quote: "Q" }, card: {} };
    expect(exportCard(bare, { format: "text", locale: "de-DE" }).text).toBe("„Q“ (Luhmann, 1984)");
    expect(exportCard(bare, { format: "latex", locale: "de-DE" }).text).toBe(
      "\\enquote{Q} \\parencite{luhmann1984soziale}",
    );
  });

  it("cites a secondary source with zit. n.", () => {
    const via: CardExportEntry = { ...entry, body: { quote: "Q" }, via: foucault };
    expect(all(via, "direct", "de-DE")).toMatchInlineSnapshot(`
      {
        "html": {
          "html": "<p>„Q“ (Luhmann, 1984, S. 31; zit. n. Foucault, 1976)</p>",
          "text": "„Q“ (Luhmann, 1984, S. 31; zit. n. Foucault, 1976)",
        },
        "latex": {
          "text": "\\enquote{Q} \\parencites[31]{luhmann1984soziale}[zit. nach][]{foucault1976uberwachen}",
        },
        "pandoc": {
          "text": "„Q“ [@luhmann1984soziale, S. 31; zit. n. @foucault1976uberwachen]",
        },
        "text": {
          "text": "„Q“ (Luhmann, 1984, S. 31; zit. n. Foucault, 1976)",
        },
        "typst": {
          "text": "„Q“ @luhmann1984soziale[S. 31] (zit. n. @foucault1976uberwachen)",
        },
      }
    `);
  });
});

describe("several cards", () => {
  it("joins plain texts with a blank line and html paragraphs with a newline", () => {
    const out = exportCards([entry, entry], { format: "html", mode: "direct", locale: "de-DE" });
    expect(out.text.split("\n\n")).toHaveLength(2);
    expect(out.html?.split("\n")).toHaveLength(2);
  });
});
