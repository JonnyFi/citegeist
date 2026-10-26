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
    note: "Gesellschaft reproduziert sich über Kommunikation.",
  },
  item: luhmann,
};

const FORMATS: CardExportFormat[] = ["html", "text", "pandoc", "latex", "typst"];

function all(
  e: CardExportEntry,
  mode: "direct" | "indirect" | "cite",
  locale: string,
  policy = {},
) {
  return Object.fromEntries(
    FORMATS.map((format) => [
      format,
      exportCard(e, { mode, format, locale, style: "apa", policy }),
    ]),
  );
}

describe("citation only", () => {
  it("renders the citation without quote, paraphrase or prefix in every format", () => {
    const out = all(entry, "cite", "de-DE");
    expect(out.pandoc?.text).toBe("[@luhmann1984soziale, S. 31]");
    expect(out.text?.text).toBe("(Luhmann, 1984, S. 31)");
    expect(out.html?.text).toBe("(Luhmann, 1984, S. 31)");
    expect(out.html?.html).toBe("<p>(Luhmann, 1984, S. 31)</p>");
    expect(out.latex?.text).toBe("\\parencite[31]{luhmann1984soziale}");
    expect(out.typst?.text).toBe("@luhmann1984soziale[S. 31]");
  });

  it("uses the terms of the requested locale in the Pandoc form", () => {
    expect(all(entry, "cite", "en-US").pandoc?.text).toBe("[@luhmann1984soziale, p. 31]");
    const para = {
      ...entry,
      card: { locator: { label: "paragraph", start: "4", confirmed: true } },
    };
    expect(all(para, "cite", "en-US").pandoc?.text).toBe("[@luhmann1984soziale, para. 4]");
    expect(all(para, "cite", "de-DE").pandoc?.text).toBe("[@luhmann1984soziale, Abs. 4]");
  });
});

describe("direct quote", () => {
  it("renders German in every format", () => {
    expect(all(entry, "direct", "de-DE")).toMatchInlineSnapshot(`
      {
        "html": {
          "html": "<p>„Soziale Systeme sind ‚autopoietisch‘ organisiert &amp; operieren [sic] 100% 'selbst'“ (Luhmann, 1984, S. 31).</p>",
          "text": "„Soziale Systeme sind ‚autopoietisch‘ organisiert & operieren [sic] 100% 'selbst'“ (Luhmann, 1984, S. 31).",
        },
        "latex": {
          "text": "\\enquote{Soziale Systeme sind \\enquote{autopoietisch} organisiert \\& operieren [sic] 100\\% 'selbst'} \\parencite[31]{luhmann1984soziale}.",
        },
        "pandoc": {
          "text": "„Soziale Systeme sind ‚autopoietisch‘ organisiert & operieren \\[sic\\] 100% 'selbst'“ [@luhmann1984soziale, S. 31].",
        },
        "text": {
          "text": "„Soziale Systeme sind ‚autopoietisch‘ organisiert & operieren [sic] 100% 'selbst'“ (Luhmann, 1984, S. 31).",
        },
        "typst": {
          "text": "„Soziale Systeme sind ‚autopoietisch‘ organisiert & operieren \\[sic\\] 100% 'selbst'“ @luhmann1984soziale[S. 31].",
        },
      }
    `);
  });

  it("renders English in every format", () => {
    expect(all(entry, "direct", "en-US")).toMatchInlineSnapshot(`
      {
        "html": {
          "html": "<p>“Soziale Systeme sind ‘autopoietisch’ organisiert &amp; operieren [sic] 100% 'selbst'” (Luhmann, 1984, p. 31).</p>",
          "text": "“Soziale Systeme sind ‘autopoietisch’ organisiert & operieren [sic] 100% 'selbst'” (Luhmann, 1984, p. 31).",
        },
        "latex": {
          "text": "\\enquote{Soziale Systeme sind \\enquote{autopoietisch} organisiert \\& operieren [sic] 100\\% 'selbst'} \\parencite[31]{luhmann1984soziale}.",
        },
        "pandoc": {
          "text": "“Soziale Systeme sind ‘autopoietisch’ organisiert & operieren \\[sic\\] 100% 'selbst'” [@luhmann1984soziale, p. 31].",
        },
        "text": {
          "text": "“Soziale Systeme sind ‘autopoietisch’ organisiert & operieren [sic] 100% 'selbst'” (Luhmann, 1984, p. 31).",
        },
        "typst": {
          "text": "“Soziale Systeme sind ‘autopoietisch’ organisiert & operieren \\[sic\\] 100% 'selbst'” @luhmann1984soziale[p. 31].",
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
      exportCard({ ...plain, body: { note: "Text", quote: "q" } }, { ...o, format: "pandoc" }).text,
    ).toBe("Text [vgl. @luhmann1984soziale, S. 31]");
    expect(
      exportCard({ ...plain, body: { note: "Text", quote: "q" } }, { ...o, format: "latex" }).text,
    ).toBe("Text \\parencite[vgl.][31]{luhmann1984soziale}");
  });
});

describe("indirect quote", () => {
  it("adds vgl. for German locales in every format", () => {
    expect(all(entry, "indirect", "de-DE")).toMatchInlineSnapshot(`
      {
        "html": {
          "html": "<p>Gesellschaft reproduziert sich über Kommunikation (vgl. Luhmann, 1984, S. 31).</p>",
          "text": "Gesellschaft reproduziert sich über Kommunikation (vgl. Luhmann, 1984, S. 31).",
        },
        "latex": {
          "text": "Gesellschaft reproduziert sich über Kommunikation \\parencite[vgl.][31]{luhmann1984soziale}.",
        },
        "pandoc": {
          "text": "Gesellschaft reproduziert sich über Kommunikation [vgl. @luhmann1984soziale, S. 31].",
        },
        "text": {
          "text": "Gesellschaft reproduziert sich über Kommunikation (vgl. Luhmann, 1984, S. 31).",
        },
        "typst": {
          "text": "Gesellschaft reproduziert sich über Kommunikation vgl. @luhmann1984soziale[S. 31].",
        },
      }
    `);
  });

  it("has no prefix for English", () => {
    expect(all(entry, "indirect", "en-US")).toMatchInlineSnapshot(`
      {
        "html": {
          "html": "<p>Gesellschaft reproduziert sich über Kommunikation (Luhmann, 1984, p. 31).</p>",
          "text": "Gesellschaft reproduziert sich über Kommunikation (Luhmann, 1984, p. 31).",
        },
        "latex": {
          "text": "Gesellschaft reproduziert sich über Kommunikation \\parencite[31]{luhmann1984soziale}.",
        },
        "pandoc": {
          "text": "Gesellschaft reproduziert sich über Kommunikation [@luhmann1984soziale, p. 31].",
        },
        "text": {
          "text": "Gesellschaft reproduziert sich über Kommunikation (Luhmann, 1984, p. 31).",
        },
        "typst": {
          "text": "Gesellschaft reproduziert sich über Kommunikation @luhmann1984soziale[p. 31].",
        },
      }
    `);
  });
});

describe("note in indirect citations", () => {
  const opts = { mode: "indirect", format: "text", locale: "de-DE", style: "apa" } as const;

  it("uses the note for own-else-ai and flattens its paragraphs", () => {
    const multi: CardExportEntry = {
      ...entry,
      body: { ...entry.body, note: "Erster Gedanke.\n\nZweiter Gedanke." },
    };
    expect(
      exportCard(multi, { ...opts, policy: { paraphrase: "own-else-ai" } }),
    ).toMatchInlineSnapshot(`
      {
        "text": "Erster Gedanke. Zweiter Gedanke (vgl. Luhmann, 1984, S. 31).",
      }
    `);
  });

  it("falls back to the AI paraphrase when the note is blank", () => {
    const blank: CardExportEntry = { ...entry, body: { ...entry.body, note: "  \n " } };
    expect(exportCard(blank, opts).text).toBe(
      "Soziale Systeme erzeugen ihre Elemente selbst (vgl. Luhmann, 1984, S. 31).",
    );
  });

  it("never mentions the note in a direct quote", () => {
    expect(exportCard(entry, { ...opts, mode: "direct" }).text).not.toContain("Gesellschaft");
  });
});

describe("export policy", () => {
  const aiOnly: CardExportEntry = { ...entry, body: { ...entry.body, note: undefined } };
  const opts = { mode: "indirect", format: "text", locale: "de-DE", style: "apa" } as const;

  it("prefers own words, then the AI paraphrase", () => {
    expect(exportCard(entry, opts).text).toBe(
      "Gesellschaft reproduziert sich über Kommunikation (vgl. Luhmann, 1984, S. 31).",
    );
    expect(exportCard(aiOnly, opts).text).toBe(
      "Soziale Systeme erzeugen ihre Elemente selbst (vgl. Luhmann, 1984, S. 31).",
    );
  });

  it("labels an AI paraphrase when asked, and only then", () => {
    expect(exportCard(aiOnly, { ...opts, policy: { labelAi: true } }).text).toBe(
      "Soziale Systeme erzeugen ihre Elemente selbst [KI-generierte Paraphrase] (vgl. Luhmann, 1984, S. 31).",
    );
    expect(exportCard(entry, { ...opts, policy: { labelAi: true } }).text).not.toContain("KI");
    expect(
      exportCard(aiOnly, { ...opts, locale: "en-US", policy: { labelAi: true } }).text,
    ).toContain("[AI-generated paraphrase]");
  });

  it("honors the paraphrase source", () => {
    const cite = "(vgl. Luhmann, 1984, S. 31)";
    expect(exportCard(entry, { ...opts, policy: { paraphrase: "ai" } }).text).toBe(
      `Soziale Systeme erzeugen ihre Elemente selbst ${cite}.`,
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

describe("sentence punctuation", () => {
  const withText = (quote: string, para: string): CardExportEntry => ({
    ...entry,
    body: { quote, note: para },
    card: { locator: { label: "paragraph", start: "5", confirmed: true } },
  });
  const run = (
    e: CardExportEntry,
    mode: "direct" | "indirect",
    locale: string,
    format: CardExportFormat = "pandoc",
  ) => exportCard(e, { mode, format, locale, style: "apa" }).text;

  it("moves the final period of a paraphrase behind the citation", () => {
    const e = withText("Q", "Das ist wesentlich.");
    expect(run(e, "indirect", "de-DE")).toBe(
      "Das ist wesentlich [vgl. @luhmann1984soziale, Abs. 5].",
    );
    expect(run(e, "indirect", "de-DE", "text")).toBe(
      "Das ist wesentlich (vgl. Luhmann, 1984, Abs. 5).",
    );
    expect(run(e, "indirect", "de-DE", "html")).toBe(
      "Das ist wesentlich (vgl. Luhmann, 1984, Abs. 5).",
    );
    expect(exportCard(e, { mode: "indirect", format: "html", locale: "de-DE" }).html).toBe(
      "<p>Das ist wesentlich (vgl. Luhmann, 1984, Abs. 5).</p>",
    );
    expect(run(withText("Q", "This is essential."), "indirect", "en-US")).toBe(
      "This is essential [@luhmann1984soziale, para. 5].",
    );
    expect(run(withText("Q", "This is essential."), "indirect", "en-US", "text")).toBe(
      "This is essential (Luhmann, 1984, para. 5).",
    );
  });

  it("moves a final ! or ? of a paraphrase as well", () => {
    expect(run(withText("Q", "Ist das wesentlich?"), "indirect", "de-DE")).toBe(
      "Ist das wesentlich [vgl. @luhmann1984soziale, Abs. 5]?",
    );
    expect(run(withText("Q", "Is this essential!"), "indirect", "en-US")).toBe(
      "Is this essential [@luhmann1984soziale, para. 5]!",
    );
  });

  it("leaves a paraphrase without a closing mark and an ellipsis alone", () => {
    expect(run(withText("Q", "Das ist wesentlich"), "indirect", "de-DE")).toBe(
      "Das ist wesentlich [vgl. @luhmann1984soziale, Abs. 5]",
    );
    expect(run(withText("Q", "Das ist wesentlich ..."), "indirect", "de-DE")).toBe(
      "Das ist wesentlich ... [vgl. @luhmann1984soziale, Abs. 5]",
    );
  });

  it("puts the period of a German quote behind the citation", () => {
    const e = withText("Soziale Systeme bestehen.", "n");
    expect(run(e, "direct", "de-DE")).toBe(
      "„Soziale Systeme bestehen“ [@luhmann1984soziale, Abs. 5].",
    );
    expect(run(e, "direct", "de-DE", "text")).toBe(
      "„Soziale Systeme bestehen“ (Luhmann, 1984, Abs. 5).",
    );
    expect(exportCard(e, { mode: "direct", format: "html", locale: "de-DE" }).html).toBe(
      "<p>„Soziale Systeme bestehen“ (Luhmann, 1984, Abs. 5).</p>",
    );
  });

  it("puts the period of an English quote behind the citation", () => {
    const e = withText("Social systems exist.", "n");
    expect(run(e, "direct", "en-US")).toBe(
      "“Social systems exist” [@luhmann1984soziale, para. 5].",
    );
    expect(run(e, "direct", "en-US", "text")).toBe(
      "“Social systems exist” (Luhmann, 1984, para. 5).",
    );
  });

  it("keeps ! and ? inside the quote and adds the period after the citation", () => {
    expect(run(withText("Gibt es Systeme?", "n"), "direct", "de-DE")).toBe(
      "„Gibt es Systeme?“ [@luhmann1984soziale, Abs. 5].",
    );
    expect(run(withText("Systems exist!", "n"), "direct", "en-US")).toBe(
      "“Systems exist!” [@luhmann1984soziale, para. 5].",
    );
  });

  it("adds no period after a quote that stops mid-sentence or ends in an ellipsis", () => {
    expect(run(withText("Soziale Systeme bestehen", "n"), "direct", "de-DE")).toBe(
      "„Soziale Systeme bestehen“ [@luhmann1984soziale, Abs. 5]",
    );
    expect(run(withText("Social systems exist...", "n"), "direct", "en-US")).toBe(
      "“Social systems exist...” [@luhmann1984soziale, para. 5]",
    );
    expect(run(withText("Soziale Systeme bestehen …", "n"), "direct", "de-DE")).toBe(
      "„Soziale Systeme bestehen …“ [@luhmann1984soziale, Abs. 5]",
    );
  });

  it("applies to LaTeX and Typst too and never to a bare citation", () => {
    const e = withText("Soziale Systeme bestehen.", "n");
    expect(run(e, "direct", "de-DE", "latex")).toBe(
      "\\enquote{Soziale Systeme bestehen} \\parencite[Abs. 5]{luhmann1984soziale}.",
    );
    expect(run(e, "direct", "de-DE", "typst")).toBe(
      "„Soziale Systeme bestehen“ @luhmann1984soziale[Abs. 5].",
    );
    expect(exportCard(e, { mode: "cite", format: "pandoc", locale: "de-DE" }).text).toBe(
      "[@luhmann1984soziale, Abs. 5]",
    );
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

  it("cites a paragraph of an unpaginated source in every format", () => {
    const para: CardExportEntry = {
      ...entry,
      card: { locator: { label: "paragraph", start: "4", confirmed: true } },
    };
    const de = all(para, "direct", "de-DE");
    expect(de.html?.text).toContain("(Luhmann, 1984, Abs. 4)");
    expect(de.text?.text).toContain("(Luhmann, 1984, Abs. 4)");
    expect(de.pandoc?.text).toContain("[@luhmann1984soziale, Abs. 4]");
    expect(de.latex?.text).toContain("\\parencite[Abs. 4]{luhmann1984soziale}");
    expect(de.typst?.text).toContain("@luhmann1984soziale[Abs. 4]");
    const en = all(para, "direct", "en-US");
    expect(en.text?.text).toContain("(Luhmann, 1984, para. 4)");
    expect(en.pandoc?.text).toContain("[@luhmann1984soziale, para. 4]");
    const range: CardExportEntry = {
      ...entry,
      card: { locator: { label: "paragraph", start: "4", end: "5", confirmed: true } },
    };
    expect(all(range, "direct", "en-US").pandoc?.text).toContain(
      "[@luhmann1984soziale, paras. 4-5]",
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
