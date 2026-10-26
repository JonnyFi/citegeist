import { describe, expect, it } from "vitest";
import { citedKeys, scanCitations, TextFrontmatter } from "./texts.js";

const keys = (text: string) => scanCitations(text).map((c) => c.key);

describe("scanCitations", () => {
  it("finds a bracketed citation with a locator", () => {
    expect(keys("Das ist belegt [@luhmann1984soziale, S. 12].")).toEqual(["luhmann1984soziale"]);
  });

  it("finds every key of a cluster with prefix, suffix and suppressed author", () => {
    expect(keys("[vgl. @a2020x, S. 3; -@b2021y; @c2022z und passim]")).toEqual([
      "a2020x",
      "b2021y",
      "c2022z",
    ]);
  });

  it("finds in-text citations and braced keys", () => {
    expect(keys("Nach @luhmann1984soziale gilt das. Siehe @{odd key/with:chars}.")).toEqual([
      "luhmann1984soziale",
      "odd key/with:chars",
    ]);
  });

  it("returns offsets that point at the key", () => {
    const text = "Satz [@gillespie2018custodians, S. 5] Ende.";
    const [ref] = scanCitations(text);
    expect(ref && text.slice(ref.from, ref.to)).toBe("gillespie2018custodians");
    const braced = "x @{a b} y";
    const [b] = scanCitations(braced);
    expect(b && braced.slice(b.from, b.to)).toBe("a b");
  });

  it("leaves trailing sentence punctuation out of the key", () => {
    expect(keys("So Luhmann [@luhmann1984soziale]. Und @foo2020bar, danach @baz2021qux.")).toEqual([
      "luhmann1984soziale",
      "foo2020bar",
      "baz2021qux",
    ]);
    expect(keys("@a2020b.")).toEqual(["a2020b"]);
  });

  it("keeps internal punctuation of a key", () => {
    expect(keys("@doe:2020.part-1")).toEqual(["doe:2020.part-1"]);
  });

  it("ignores e-mail addresses and escaped at signs", () => {
    expect(keys("Schreib an alex@example.com oder \\@nobody.")).toEqual([]);
  });

  it("ignores the frontmatter, code, comments, links and wiki links", () => {
    const text = [
      "---",
      "title: Kapitel 2",
      "author: '@someone'",
      "---",
      "",
      "Inline `[@in-code]` und [Link](https://x.org/@user) und https://example.org/@bare.",
      "<!-- [@commented] -->",
      "Siehe [[luhmann1984soziale]] und [[a@b|Alias]].",
      "",
      "```js",
      "const x = '@fenced';",
      "```",
      "",
      "~~~",
      "@tilde",
      "~~~",
      "",
      "Echt [@real2020key].",
    ].join("\n");
    expect(keys(text)).toEqual(["real2020key"]);
  });

  it("reports the offsets in the original text after blanking", () => {
    const text = "`code` [@a2020b]";
    const [ref] = scanCitations(text);
    expect(ref && text.slice(ref.from, ref.to)).toBe("a2020b");
  });

  it("lists each key once, in order of first appearance", () => {
    expect(citedKeys("[@b2020x] [@a2021y] [@b2020x, S. 2] @a2021y")).toEqual(["b2020x", "a2021y"]);
  });

  it("handles an unterminated fence without throwing", () => {
    expect(keys("vorher [@a2020b]\n\n```\n@verloren")).toEqual(["a2020b"]);
  });
});

describe("TextFrontmatter", () => {
  it("needs a title and takes optional style, language and stamp", () => {
    expect(() => TextFrontmatter.parse({})).toThrow();
    const fm = TextFrontmatter.parse({
      title: "Kapitel 2",
      style: "apa",
      lang: "de-DE",
      created: { at: "2026-10-24T10:00:00Z", by: "human" },
    });
    expect(fm.style).toBe("apa");
    expect(TextFrontmatter.parse({ title: "Nur Titel" })).toEqual({ title: "Nur Titel" });
  });
});
