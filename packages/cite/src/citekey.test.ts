import { Citekey } from "@citegeist/schema";
import { describe, expect, it } from "vitest";
import {
  asciiFold,
  baseCitekey,
  DEFAULT_CITEKEY_FORMULA,
  disambiguateCitekey,
  generateCitekey,
} from "./citekey.js";
import { SAMPLE_ITEMS } from "./testing/samples.js";

describe("asciiFold", () => {
  it("folds accents and ligatures", () => {
    expect(asciiFold("Müller Çelik Ørsted Straße Łódź")).toBe("Muller Celik Orsted Strasse Lodz");
  });
});

describe("citekey formula", () => {
  it("matches the library default", () => {
    expect(DEFAULT_CITEKEY_FORMULA).toBe("auth.lower + year + shorttitle(1,0)");
  });

  it("generates first author, year and first significant title word", () => {
    const keys = SAMPLE_ITEMS.map((i) => baseCitekey(i));
    expect(keys).toEqual([
      "luhmann1984soziale",
      "kahneman1979prospect",
      "bourdieu1983okonomisches",
      "vaswani2017attention",
      "muller2019lernen",
      "world2022global",
      "bundesministerium2023digitalisierung",
      "foucault1976uberwachen",
      "humboldt1836verschiedenheit",
      "schafer2021digitale",
    ]);
  });

  it("only produces valid Citekeys", () => {
    for (const item of SAMPLE_ITEMS)
      expect(Citekey.safeParse(baseCitekey(item)).success).toBe(true);
  });

  it("skips German and English stop words", () => {
    expect(baseCitekey({ title: "Die Entstehung der Moderne", issued: 2000 })).toBe(
      "anon2000entstehung",
    );
    expect(baseCitekey({ title: "The Rise of Networks", issued: 2000 })).toBe("anon2000rise");
  });

  it("uses the part of the title before a colon", () => {
    expect(
      baseCitekey({
        title: "Of the nature: Rise",
        author: [{ family: "O'Brien" }],
        issued: "2020-03-04",
      }),
    ).toBe("obrien2020nature");
  });

  it("falls back to the editor and to nd", () => {
    expect(baseCitekey({ title: "Handbuch", editor: [{ family: "Meier" }] })).toBe(
      "meierndhandbuch",
    );
  });

  it("supports shorttitle(n,m), veryshorttitle and literals", () => {
    const item = {
      title: "Social systems and their environments",
      author: [{ family: "Luhmann" }],
      issued: 1984,
    };
    expect(baseCitekey(item, "auth + year + shorttitle(2,0)")).toBe("luhmann1984socialsystems");
    expect(baseCitekey(item, "auth + year + shorttitle(1,1)")).toBe("luhmann1984systems");
    expect(baseCitekey(item, 'auth + "_" + year + veryshorttitle')).toBe("luhmann_1984social");
  });

  it("rejects broken formulas", () => {
    const item = { title: "T" };
    expect(() => baseCitekey(item, "auth + nonsense")).toThrow(/CITEKEY_BAD_FORMULA/);
    expect(() => baseCitekey(item, "")).toThrow(/CITEKEY_BAD_FORMULA/);
    expect(() => baseCitekey(item, "auth.shout")).toThrow(/CITEKEY_BAD_FORMULA/);
  });
});

describe("disambiguation", () => {
  it("returns the base key when it is free", () => {
    expect(disambiguateCitekey("luhmann1984soziale", new Set())).toBe("luhmann1984soziale");
  });

  it("appends a, b, c against existing keys", () => {
    const existing = new Set<string>();
    const item = SAMPLE_ITEMS[0];
    if (!item) throw new Error("no sample");
    const keys = [1, 2, 3, 4].map(() => {
      const k = generateCitekey(item, existing);
      existing.add(k);
      return k;
    });
    expect(keys).toEqual([
      "luhmann1984soziale",
      "luhmann1984sozialea",
      "luhmann1984sozialeb",
      "luhmann1984sozialec",
    ]);
  });

  it("is deterministic and fills gaps", () => {
    const existing = new Set(["k", "ka", "kc"]);
    expect(disambiguateCitekey("k", existing)).toBe("kb");
    expect(disambiguateCitekey("k", existing)).toBe("kb");
  });

  it("continues with aa after z", () => {
    const existing = new Set(["k"]);
    for (const c of "abcdefghijklmnopqrstuvwxyz") existing.add(`k${c}`);
    expect(disambiguateCitekey("k", existing)).toBe("kaa");
  });
});
