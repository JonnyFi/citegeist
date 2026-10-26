import { describe, expect, it } from "vitest";
import { scanClusters } from "./clusters";
import { labelForTerm, termFor } from "./locators";

const one = (text: string) => {
  const found = scanClusters(text);
  expect(found).toHaveLength(1);
  const [cluster] = found;
  if (!cluster) throw new Error("no cluster");
  return cluster;
};

describe("scanClusters", () => {
  it("reads a plain cluster and reports its bracket range", () => {
    const text = "Davor [@luhmann1984] danach";
    expect(one(text)).toEqual({ from: 6, to: 20, refs: [{ key: "luhmann1984" }], parsed: true });
    expect(text.slice(6, 20)).toBe("[@luhmann1984]");
  });

  it("reads prefix and locator with a German or English term", () => {
    expect(one("[vgl. @a2020b, S. 12]").refs).toEqual([
      { key: "a2020b", prefix: "vgl.", locator: "12", label: "page" },
    ]);
    expect(one("[see @a, pp. 12-14]").refs).toEqual([
      { key: "a", prefix: "see", locator: "12-14", label: "page" },
    ]);
    expect(one("[@a, Abs. 4]").refs[0]).toMatchObject({ locator: "4", label: "paragraph" });
    expect(one("[@a, para. 4]").refs[0]).toMatchObject({ locator: "4", label: "paragraph" });
    expect(one("[@a, Kap. 3]").refs[0]).toMatchObject({ locator: "3", label: "chapter" });
    expect(one("[@a, chap. 3]").refs[0]).toMatchObject({ locator: "3", label: "chapter" });
    expect(one("[@a, Bd. 2]").refs[0]).toMatchObject({ locator: "2", label: "volume" });
    expect(one("[@a, vol. 2]").refs[0]).toMatchObject({ locator: "2", label: "volume" });
    expect(one("[@a, § 5]").refs[0]).toMatchObject({ locator: "5", label: "section" });
  });

  it("treats a bare number or range as a page and normalizes the dash", () => {
    expect(one("[@a, 12]").refs[0]).toMatchObject({ locator: "12", label: "page" });
    expect(one("[@a, 12–14]").refs[0]).toMatchObject({ locator: "12-14", label: "page" });
    expect(one("[@a, S. 12 – 14]").refs[0]).toMatchObject({ locator: "12-14" });
    expect(one("[@a, S. 12f.]").refs[0]).toMatchObject({ locator: "12f.", label: "page" });
  });

  it("reads several citations and the suppressed author", () => {
    const c = one("[vgl. @a, S. 12; @b2020x, Abs. 4; -@c]");
    expect(c.parsed).toBe(true);
    expect(c.refs).toEqual([
      { key: "a", prefix: "vgl.", locator: "12", label: "page" },
      { key: "b2020x", locator: "4", label: "paragraph" },
      { key: "c", suppressAuthor: true },
    ]);
    expect(one("[-@a]").refs).toEqual([{ key: "a", suppressAuthor: true }]);
  });

  it("reads a braced key", () => {
    expect(one("[@{doi:10.1/x}, S. 3]").refs).toEqual([
      { key: "doi:10.1/x", locator: "3", label: "page" },
    ]);
  });

  it("finds several clusters on different lines", () => {
    const found = scanClusters("A [@a] und [@b]\n\nB [see @c, p. 3]");
    expect(found.map((c) => c.refs.map((r) => r.key))).toEqual([["a"], ["b"], ["c"]]);
  });

  it("does not treat a bare @key as a cluster", () => {
    expect(scanClusters("Nach @a2020b gilt das; siehe auch @c.")).toEqual([]);
  });

  it("marks clusters it cannot understand as unparsed", () => {
    expect(one("[@a, im Anhang]").parsed).toBe(false);
    expect(one("[@a, S. zwölf]").parsed).toBe(false);
    expect(one("[@a, S. 12, passim]").parsed).toBe(false);
    expect(one("[@a und mehr]").parsed).toBe(false);
    expect(one("[@a @b]").parsed).toBe(false);
    expect(one("[siehe [x] @a]").parsed).toBe(false);
    expect(one("[@a](https://x.org)").parsed).toBe(false);
    expect(one("[@a, S. 1; Text ohne Key]").parsed).toBe(false);
  });

  it("keeps every key of an unparsed cluster in the cluster", () => {
    const c = one("[@a, quer; @b]");
    expect(c.parsed).toBe(false);
    expect(c.refs.map((r) => r.key)).toEqual(["a", "b"]);
  });

  it("ignores code, escapes, links, frontmatter and e-mail addresses", () => {
    expect(scanClusters("`[@a]`")).toEqual([]);
    expect(scanClusters("```\n[@a]\n```")).toEqual([]);
    expect(scanClusters("\\[@a]")).toEqual([]);
    expect(scanClusters("[\\@a]")).toEqual([]);
    expect(scanClusters("---\ntitle: [@a]\n---\n")).toEqual([]);
    expect(scanClusters("[mail an x@example.org]")).toEqual([]);
    expect(scanClusters("[[wiki @a]]")).toEqual([]);
  });

  it("does not span lines", () => {
    expect(scanClusters("[@a\n, S. 3]")).toEqual([]);
  });
});

describe("locator terms", () => {
  it("maps terms in both languages, any case and number to CSL labels", () => {
    expect(labelForTerm("S.")).toBe("page");
    expect(labelForTerm("pp.")).toBe("page");
    expect(labelForTerm("ABS.")).toBe("paragraph");
    expect(labelForTerm("para.")).toBe("paragraph");
    expect(labelForTerm("Kap.")).toBe("chapter");
    expect(labelForTerm("Bde.")).toBe("volume");
    expect(labelForTerm("s. v.")).toBe("sub-verbo");
    expect(labelForTerm("nonsense")).toBeUndefined();
  });

  it("writes the term of a label in a language", () => {
    expect(termFor("page", "de", false)).toBe("S.");
    expect(termFor("page", "en", false)).toBe("p.");
    expect(termFor("page", "en-US", true)).toBe("pp.");
    expect(termFor("paragraph", "de-AT", false)).toBe("Abs.");
    expect(termFor("volume", "de", true)).toBe("Bde.");
    expect(termFor("section", "de", true)).toBe("§§");
  });
});
