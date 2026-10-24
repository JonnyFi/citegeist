import { ItemFrontmatter } from "@citegeist/schema";
import { describe, expect, it } from "vitest";
import {
  cslToDraft,
  exportCslJson,
  finalizeDraft,
  generateCitekey,
  type ItemDraft,
  itemToCsl,
  parseBibtex,
  parseCslJson,
  parseRis,
  toBibtex,
  toRis,
} from "./index.js";
import { SAMPLE_ITEMS } from "./testing/samples.js";

/** The fields every importer and exporter maps. A round trip must keep all of them. */
const MAPPED = [
  "citekey",
  "type",
  "title",
  "author",
  "editor",
  "issued",
  "container-title",
  "volume",
  "issue",
  "page",
  "publisher",
  "publisher-place",
  "DOI",
  "ISBN",
  "ISSN",
  "URL",
  "abstract",
  "language",
  "genre",
  "edition",
  "translator",
  "tags",
  "ids",
] as const;

function project(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of MAPPED) {
    const v = source[k];
    if (v === undefined) continue;
    if ((k === "tags" || k === "ids") && (v as unknown[]).length === 0) continue;
    if (k === "ids" && Object.keys(v as object).length === 0) continue;
    out[k] = v;
  }
  return out;
}

/** A hard case: special characters, acronyms, a long author list, an unusual family name. */
const NASTY = ItemFrontmatter.parse({
  id: "01JB0000000000000000000099",
  citekey: "nasty2020rd",
  type: "article-journal",
  title: "R&D spending: 50% of #1 tools in NASA and the iPhone_era",
  author: [
    { family: "Gogh", given: "Vincent", "non-dropping-particle": "van" },
    { family: "Smith", given: "John", suffix: "Jr." },
    { literal: "Max Planck Society" },
  ],
  issued: "2020-03-04",
  "container-title": "Journal of {Odd} Things",
  page: "e12345",
  abstract: "A study with $5 and 100% effort.",
  URL: "https://example.org/a_b?c=1&d=2#frag",
  created: { at: "2026-10-23T09:00:00.000Z", by: "human" },
});

describe("BibLaTeX round trip", () => {
  const items = [...SAMPLE_ITEMS, NASTY];

  it("keeps every mapped field", () => {
    const bib = toBibtex(items);
    const parsed = parseBibtex(bib);
    expect(parsed.errors).toEqual([]);
    expect(parsed.items).toHaveLength(items.length);
    items.forEach((item, i) => {
      const back = parsed.items[i] as ItemDraft;
      const expected = project(item as unknown as Record<string, unknown>);
      // subtitle is a separate BibLaTeX field and survives as such
      if (item.subtitle) expected.subtitle = item.subtitle;
      const actual = project(back as unknown as Record<string, unknown>);
      if (back.subtitle) actual.subtitle = back.subtitle;
      expect(actual, item.citekey).toEqual(expected);
    });
  });

  it("writes the expected BibLaTeX for one entry", () => {
    const luhmann = SAMPLE_ITEMS[0];
    if (!luhmann) throw new Error("no sample");
    expect(toBibtex([luhmann])).toMatchInlineSnapshot(`
      "@book{luhmann1984soziale,
        author = {Luhmann, Niklas},
        title = {Soziale Systeme},
        subtitle = {Grundriß einer allgemeinen Theorie},
        date = {1984},
        publisher = {Suhrkamp},
        location = {Frankfurt am Main},
        isbn = {978-3-518-28266-3},
        langid = {german},
        keywords = {systemtheorie, soziologie},
      }
      "
    `);
  });

  it("leaves the Zotero key out of eprint", () => {
    const luhmann = SAMPLE_ITEMS[0];
    if (!luhmann) throw new Error("no sample");
    const bib = toBibtex([{ ...luhmann, ids: { zotero: "ABCD1234" } }]);
    expect(bib).not.toContain("eprint");
    expect(bib).not.toContain("ABCD1234");
    const withPmcid = toBibtex([{ ...luhmann, ids: { zotero: "ABCD1234", pmcid: "PMC1" } }]);
    expect(withPmcid).not.toContain("eprint");
  });

  it("round trips a second time without drift", () => {
    const once = toBibtex(parseBibtex(toBibtex(items)).items.map(toFrontmatter));
    expect(once).toBe(toBibtex(items));
  });

  it("writes classic BibTeX with year, month and journal", () => {
    const kahneman = SAMPLE_ITEMS.find((i) => i.citekey === "schafer2021digitale");
    if (!kahneman) throw new Error("no sample");
    const bib = toBibtex([kahneman], { flavor: "bibtex" });
    expect(bib).toContain("@article{schafer2021digitale,");
    expect(bib).toContain("year = {2021}");
    expect(bib).toContain("month = {jun}");
    expect(bib).toContain("journal = {Zeitschrift für Pädagogische Psychologie}");
    expect(bib).not.toContain("journaltitle");
    const back = parseBibtex(bib).items[0] as ItemDraft;
    expect(back.issued).toBe("2021-06");
  });

  it("reads typical BibTeX from other tools", () => {
    const { items: read, errors } = parseBibtex(`
      @article{Smith2020,
        author = {Smith, John and M{\\"u}ller, Anna},
        title = {{NASA} and the Moon},
        journal = {Nature},
        year = 2020,
        month = mar,
        volume = 5,
        number = 2,
        pages = {10--20},
        doi = {10.1/abc},
        keywords = {space, moon}
      }
      @phdthesis{doe2019,
        author = {Doe, Jane},
        title = {A Thesis},
        school = {University of Vienna},
        year = {2019}
      }
      @misc{notitle, author = {X, Y}}
    `);
    expect(errors).toEqual(["Entry notitle has no title and was skipped"]);
    expect(read).toHaveLength(2);
    const [a, b] = read;
    expect(a).toMatchObject({
      citekey: "Smith2020",
      type: "article-journal",
      title: "NASA and the Moon",
      issued: "2020-03",
      "container-title": "Nature",
      volume: "5",
      issue: "2",
      page: "10-20",
      DOI: "10.1/abc",
      tags: ["space", "moon"],
    });
    expect(a?.author).toEqual([
      { family: "Smith", given: "John" },
      { family: "Müller", given: "Anna" },
    ]);
    expect(b).toMatchObject({ type: "thesis", publisher: "University of Vienna", issued: 2019 });
  });

  it("maps arXiv eprints into ids", () => {
    const { items: read } = parseBibtex(
      "@misc{x, title = {T}, eprint = {2401.00001}, eprinttype = {arxiv}, year = {2024}}",
    );
    expect(read[0]?.ids).toEqual({ arxiv: "2401.00001" });
    const fm = toFrontmatter({ ...(read[0] as ItemDraft), citekey: "xx" });
    expect(toBibtex([fm])).toContain("eprint = {2401.00001}");
  });
});

describe("RIS", () => {
  it("keeps every mapped field except the subtitle split", () => {
    const text = toRis(SAMPLE_ITEMS);
    expect(text).toContain("TY  - BOOK\r\n");
    const parsed = parseRis(text);
    expect(parsed.errors).toEqual([]);
    expect(parsed.items).toHaveLength(SAMPLE_ITEMS.length);
    SAMPLE_ITEMS.forEach((item, i) => {
      const expected = project(item as unknown as Record<string, unknown>);
      if (item.subtitle) expected.title = `${item.title}: ${item.subtitle}`;
      // RIS has no id, genre or translator fields
      expected.ids = undefined;
      expected.genre = undefined;
      expected.translator = undefined;
      const actual = project(parsed.items[i] as unknown as Record<string, unknown>);
      expect(actual, item.citekey).toEqual(
        Object.fromEntries(Object.entries(expected).filter(([, v]) => v !== undefined)),
      );
    });
  });

  it("reads a file from a reference manager", () => {
    const { items } = parseRis(
      [
        "TY  - JOUR",
        "AU  - van der Berg, Jan",
        "AU  - Doe, Jane",
        "TI  - A long title that",
        "continues here",
        "JO  - Some Journal",
        "PY  - 2020///",
        "DA  - 2020/03/04/",
        "SP  - 10",
        "EP  - 20",
        "SN  - 1234-5678",
        "DO  - https://doi.org/10.1/x",
        "KW  - a",
        "KW  - b",
        "ER  - ",
      ].join("\n"),
    );
    expect(items[0]).toMatchObject({
      type: "article-journal",
      title: "A long title that continues here",
      issued: "2020-03-04",
      page: "10-20",
      ISSN: "1234-5678",
      DOI: "10.1/x",
      tags: ["a", "b"],
    });
    expect(items[0]?.author?.[0]).toEqual({
      family: "Berg",
      given: "Jan",
      "non-dropping-particle": "van der",
    });
  });
});

describe("CSL-JSON", () => {
  it("round trips every sample", () => {
    const json = exportCslJson(SAMPLE_ITEMS);
    const parsed = parseCslJson(json);
    SAMPLE_ITEMS.forEach((item, i) => {
      const expected = project(item as unknown as Record<string, unknown>);
      if (item.subtitle) expected.title = `${item.title}: ${item.subtitle}`;
      const actual = project(parsed[i] as unknown as Record<string, unknown>);
      expect(actual, item.citekey).toEqual(expected);
    });
  });

  it("uses the citekey as id and maps dates", () => {
    const csl = itemToCsl(SAMPLE_ITEMS[9] as ItemFrontmatter);
    expect(csl).toMatchObject({
      id: "schafer2021digitale",
      "citation-key": "schafer2021digitale",
      issued: { "date-parts": [[2021, 6]] },
      PMID: "12345678",
    });
  });

  it("reads Zotero style CSL-JSON", () => {
    const draft = cslToDraft({
      id: "http://zotero.org/users/1/items/ABC",
      type: "article-journal",
      title: "T",
      author: [{ family: "Doe", given: "J." }, { literal: "ACME" }, { given: "Solo" }],
      issued: { "date-parts": [["2020", "3"]] },
      volume: 5,
      language: "German",
      keyword: "a, b",
    });
    expect(draft).toMatchObject({
      citekey: "http://zotero.org/users/1/items/ABC",
      issued: "2020-03",
      volume: "5",
      tags: ["a", "b"],
    });
    expect(draft.author).toEqual([
      { family: "Doe", given: "J." },
      { literal: "ACME" },
      { literal: "Solo" },
    ]);
    expect(draft.language).toBeUndefined();
  });
});

describe("finalizeDraft", () => {
  it("turns an import into valid frontmatter with a unique citekey", () => {
    const { items } = parseBibtex(
      "@book{Weird_Key, title = {Das Kapital}, author = {Marx, Karl}, year = 1867}",
    );
    const draft = items[0] as ItemDraft;
    const key = generateCitekey(draft, new Set(["marx1867kapital"]));
    const fm = finalizeDraft(draft, key, {
      id: "01JB0000000000000000000050",
      at: "2026-10-23T10:00:00.000Z",
      provenanceTag: "bibtex",
    });
    expect(fm.citekey).toBe("marx1867kapitala");
    expect(fm.provenance.title).toBe("bibtex@2026-10-23");
    expect(fm.status).toBe("unread");
  });
});

function toFrontmatter(draft: ItemDraft): ItemFrontmatter {
  return finalizeDraft(draft, draft.citekey ?? "xx", {
    id: "01JB0000000000000000000077",
    at: "2026-10-23T09:00:00.000Z",
  });
}
