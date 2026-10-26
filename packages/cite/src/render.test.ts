import { describe, expect, it } from "vitest";
import { BUNDLED_STYLES, renderBibliography, renderCitation } from "./index.js";
import { SAMPLE_ITEMS } from "./testing/samples.js";

const LOCALES = ["de-DE", "en-US"] as const;

describe("golden: 10 items x 3 styles x 2 locales", () => {
  for (const style of BUNDLED_STYLES) {
    for (const locale of LOCALES) {
      it(`${style} ${locale}`, async () => {
        const lines: string[] = [];
        for (const item of SAMPLE_ITEMS) {
          const cite = renderCitation(
            SAMPLE_ITEMS,
            [{ citekey: item.citekey, locator: "31", label: "page" }],
            { style, locale },
          );
          const bib = renderBibliography(SAMPLE_ITEMS, [item.citekey], { style, locale });
          lines.push(`${item.citekey}\n  cite: ${cite}\n  bib:  ${bib}`);
        }
        await expect(`${lines.join("\n")}\n`).toMatchFileSnapshot(
          `./__golden__/${style}.${locale}.txt`,
        );
      });
    }
  }
});

describe("locators", () => {
  const luhmann = "luhmann1984soziale";
  const cite = (locale: string, extra: Record<string, string> = {}, style = "apa") =>
    renderCitation(SAMPLE_ITEMS, [{ citekey: luhmann, locator: "31", ...extra }], {
      style,
      locale,
    });

  it("renders a page locator in German", () => {
    expect(cite("de-DE")).toBe("(Luhmann, 1984, S. 31)");
  });

  it("renders a page locator in English", () => {
    expect(cite("en-US")).toBe("(Luhmann, 1984, p. 31)");
  });

  it("keeps a prefix", () => {
    expect(cite("de-DE", { prefix: "vgl." })).toBe("(vgl. Luhmann, 1984, S. 31)");
  });

  it("uses the label for other locators", () => {
    expect(cite("de-DE", { label: "chapter", locator: "3" })).toBe("(Luhmann, 1984, Kapitel 3)");
    expect(cite("en-US", { label: "chapter", locator: "3" })).toBe("(Luhmann, 1984, Chapter 3)");
  });

  it("renders page ranges", () => {
    expect(cite("de-DE", { locator: "31-33" })).toBe("(Luhmann, 1984, S. 31–33)");
    expect(cite("en-US", { locator: "31-33" })).toBe("(Luhmann, 1984, pp. 31–33)");
  });

  it("renders the Chicago author-date form", () => {
    expect(cite("en-US", {}, "chicago-author-date")).toBe("(Luhmann 1984, 31)");
  });

  it("renders a paragraph locator in each bundled style", () => {
    // What every style and locale makes of {label: "paragraph"}; the style decides the wording.
    const rows = BUNDLED_STYLES.flatMap((style) =>
      LOCALES.map(
        (locale) =>
          `${style} ${locale}: ${cite(locale, { label: "paragraph", locator: "4" }, style)}  |  ${cite(
            locale,
            { label: "paragraph", locator: "4-5" },
            style,
          )}`,
      ),
    );
    expect(rows).toEqual([
      "apa de-DE: (Luhmann, 1984, Abs. 4)  |  (Luhmann, 1984, Abs. 4–5)",
      "apa en-US: (Luhmann, 1984, para. 4)  |  (Luhmann, 1984, paras. 4–5)",
      "chicago-author-date de-DE: (Luhmann 1984, Abs. 4)  |  (Luhmann 1984, Abs. 4–5)",
      "chicago-author-date en-US: (Luhmann 1984, para. 4)  |  (Luhmann 1984, paras. 4–5)",
      "deutsche-gesellschaft-fur-psychologie de-DE: (Luhmann, 1984, Abs. 4)  |  (Luhmann, 1984, Abs. 4–5)",
      "deutsche-gesellschaft-fur-psychologie en-US: (Luhmann, 1984, para. 4)  |  (Luhmann, 1984, paras. 4–5)",
    ]);
  });

  it("falls back to the language of an unbundled locale", () => {
    expect(cite("de-AT")).toBe("(Luhmann, 1984, S. 31)");
  });

  it("combines several works in one cluster", () => {
    const out = renderCitation(
      SAMPLE_ITEMS,
      [{ citekey: "luhmann1984soziale", locator: "31" }, { citekey: "foucault1976uberwachen" }],
      { style: "apa", locale: "de-DE" },
    );
    expect(out).toBe("(Foucault, 1976; Luhmann, 1984, S. 31)");
  });

  it("renders html with markup", () => {
    const out = renderBibliography(SAMPLE_ITEMS, ["luhmann1984soziale"], {
      style: "apa",
      locale: "de-DE",
      format: "html",
    });
    expect(out).toContain("<i>Soziale Systeme");
  });

  it("throws on an unknown citekey and an unknown style", () => {
    expect(() => renderCitation(SAMPLE_ITEMS, [{ citekey: "nope" }])).toThrow(/CITE_UNKNOWN_ITEM/);
    expect(() => renderCitation(SAMPLE_ITEMS, [{ citekey: luhmann }], { style: "zzz" })).toThrow(
      /CITE_UNKNOWN_STYLE/,
    );
  });
});
