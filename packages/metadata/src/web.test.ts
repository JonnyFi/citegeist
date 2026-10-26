import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectIdentifier } from "./identifiers.js";
import { extractPageMetadata, isChallengePage, parseDate, stripSiteName } from "./web.js";

const fixture = (name: string): string =>
  readFileSync(new URL(`../../../fixtures/web/${name}`, import.meta.url), "utf8");

describe("extractPageMetadata", () => {
  it("names the DOI of a publisher page and reads the Highwire tags", () => {
    const page = extractPageMetadata(
      fixture("article-citation-doi.html"),
      "https://journals.example.org/articles/numpy",
    );
    expect(page.challenge).toBe(false);
    expect(page.identifiers[0]).toMatchObject({ kind: "doi", value: "10.1038/s41586-020-2649-2" });
    expect(page.identifiers.filter((i) => i.kind === "doi")).toHaveLength(1);
    expect(page.fields).toMatchObject({
      type: "article-journal",
      title: "Array programming with NumPy",
      issued: "2020-09-16",
      "container-title": "Nature",
      volume: "585",
      issue: "7825",
      page: "357-362",
    });
    expect(page.fields.author).toEqual([
      { family: "Harris", given: "Charles R." },
      { family: "Millman", given: "K. Jarrod" },
    ]);
    expect(page.tiers.author).toBe("highwire");
  });

  it("reads Highwire tags without an identifier and decodes entities", () => {
    const page = extractPageMetadata(fixture("article-citation-only.html"));
    expect(page.identifiers).toEqual([]);
    expect(page.fields.title).toBe("Systemtheorie und Gesellschaftskritik");
    expect(page.fields["container-title"]).toBe("Beispiel Zeitschrift für Soziologie");
    expect(page.fields.issued).toBe("2018-03");
    expect(page.fields.language).toBe("de");
    expect(page.fields.author?.[1]).toEqual({ family: "Beispiel", given: "Jan-Peter" });
  });

  it("reads a Book from JSON-LD, with its ISBN", () => {
    const page = extractPageMetadata(fixture("book-jsonld.html"), "https://verlag.example.org/b");
    expect(page.identifiers).toEqual([
      expect.objectContaining({ kind: "isbn", value: "9783518587065" }),
    ]);
    expect(page.fields).toMatchObject({
      type: "book",
      title: "Die Gesellschaft der Singularitäten",
      issued: "2017-09-11",
      publisher: "Suhrkamp",
      language: "de",
      edition: "1. Auflage",
      ISBN: "9783518587065",
    });
    expect(page.fields.author).toEqual([{ family: "Reckwitz", given: "Andreas" }]);
    expect(page.tiers.title).toBe("json-ld");
  });

  it("falls back to Open Graph and strips the site name from the title", () => {
    const page = extractPageMetadata(fixture("plain-page.html"), "https://essays.example.org/slow");
    expect(page.identifiers).toEqual([]);
    expect(page.fields.title).toBe("A Manifesto for Slow Reading");
    expect(page.fields.author).toEqual([{ family: "Muster", given: "Maria" }]);
    expect(page.fields.issued).toBe("2021-05-04");
    expect(page.fields["container-title"]).toBe("Example Essays");
    expect(page.tiers.title).toBe("opengraph");
  });

  it("uses the title tag when nothing else is there", () => {
    const page = extractPageMetadata(
      "<html><head><title>Slow Reading | Example Essays</title></head><body>x</body></html>",
      "https://essays.example.org/slow",
    );
    expect(page.fields.title).toBe("Slow Reading");
    expect(page.tiers.title).toBe("html");
    expect(page.fields.author).toBeUndefined();
  });

  it("prefers Highwire over Dublin Core over JSON-LD, field by field", () => {
    const html = `<html><head>
      <meta name="dc.title" content="DC title"><meta name="dc.creator" content="Doe, Jane">
      <meta name="dc.date" content="1999-01-02">
      <meta name="citation_title" content="Highwire title">
      <script type="application/ld+json">{"@type":"Article","name":"LD title","author":{"name":"Ld Author"},"datePublished":"2000-05-05","publisher":"LD Press"}</script>
    </head></html>`;
    const page = extractPageMetadata(html);
    expect(page.fields.title).toBe("Highwire title");
    expect(page.tiers.title).toBe("highwire");
    expect(page.fields.author).toEqual([{ family: "Doe", given: "Jane" }]);
    expect(page.tiers.author).toBe("dublin-core");
    expect(page.fields.issued).toBe("1999-01-02");
    expect(page.fields.publisher).toBe("LD Press");
    expect(page.tiers.publisher).toBe("json-ld");
  });

  it("finds a DOI in Dublin Core, a JSON-LD identifier and a doi.org link", () => {
    const dc = extractPageMetadata(
      `<meta name="DC.Identifier" content="https://doi.org/10.1000/ABC.1"><title>x</title>`,
    );
    expect(dc.identifiers[0]).toMatchObject({ kind: "doi", value: "10.1000/abc.1" });
    const ld = extractPageMetadata(
      `<script type="application/ld+json">{"@type":"ScholarlyArticle","name":"T","identifier":{"@type":"PropertyValue","propertyID":"DOI","value":"10.1000/xyz"}}</script>`,
    );
    expect(ld.identifiers[0]).toMatchObject({ kind: "doi", value: "10.1000/xyz" });
    const link = extractPageMetadata(
      `<head><link rel="alternate" href="https://doi.org/10.1000/linked"><title>x</title></head>`,
    );
    expect(link.identifiers[0]).toMatchObject({ kind: "doi", value: "10.1000/linked" });
  });

  it("ignores a plain number in dc.identifier (it is not a PMID)", () => {
    const page = extractPageMetadata(`<meta name="dc.identifier" content="12345"><title>x</title>`);
    expect(page.identifiers).toEqual([]);
  });

  it("returns the DOI first, then the ISBN, arXiv id and PMID", () => {
    const page = extractPageMetadata(`<head>
      <meta name="citation_pmid" content="31000">
      <meta name="citation_arxiv_id" content="1706.03762">
      <meta name="citation_isbn" content="978-3-518-58706-5">
      <meta name="citation_doi" content="10.1000/z"><title>x</title></head>`);
    expect(page.identifiers.map((i) => i.kind)).toEqual(["doi", "isbn", "arxiv", "pmid"]);
  });

  it("survives broken JSON-LD", () => {
    const page = extractPageMetadata(
      `<script type="application/ld+json">{ not json</script><meta name="citation_title" content="T">`,
    );
    expect(page.fields.title).toBe("T");
  });
});

describe("challenge pages", () => {
  it("recognises the Cloudflare challenge SSRN serves to unknown clients", () => {
    const html = fixture("ssrn-challenge.html");
    expect(isChallengePage(html)).toBe(true);
    const page = extractPageMetadata(
      html,
      "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1462344",
    );
    expect(page.challenge).toBe(true);
    expect(page.fields).toEqual({});
  });

  it("does not take a normal page for a challenge", () => {
    expect(isChallengePage(fixture("plain-page.html"))).toBe(false);
    expect(isChallengePage(fixture("article-citation-doi.html"))).toBe(false);
  });
});

describe("SSRN addresses", () => {
  it.each([
    "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1462344",
    "https://papers.ssrn.com/abstract=1462344",
    "https://ssrn.com/abstract=1462344",
    "https://papers.ssrn.com/sol3/Delivery.cfm/SSRN_ID1462344_code1.pdf?abstractid=1462344&mirid=1",
  ])("gives the DOI of %s without asking the page", (url) => {
    expect(detectIdentifier(url)).toMatchObject({
      kind: "doi",
      value: "10.2139/ssrn.1462344",
      via: "url",
    });
  });

  it("leaves other SSRN pages alone", () => {
    expect(
      detectIdentifier("https://papers.ssrn.com/sol3/JELJOUR_Results.cfm?form_name=x")?.kind,
    ).toBe("url");
  });
});

describe("helpers", () => {
  it("parses the date shapes pages use", () => {
    expect(parseDate("2020/09/16")).toBe("2020-09-16");
    expect(parseDate("2020-09")).toBe("2020-09");
    expect(parseDate("2021-05-04T08:00:00Z")).toBe("2021-05-04");
    expect(parseDate("March 2002")).toBe("2002-03");
    expect(parseDate("Aug 1, 2000")).toBe("2000-08-01");
    expect(parseDate("16 September 2020")).toBe("2020-09-16");
    expect(parseDate("2019")).toBe("2019");
    expect(parseDate("no date")).toBeUndefined();
  });

  it("strips a site name only when it is one", () => {
    expect(stripSiteName("Title | SSRN", undefined, "https://papers.ssrn.com/x")).toBe("Title");
    expect(stripSiteName("Title - Example Essays", "Example Essays")).toBe("Title");
    expect(stripSiteName("Order - Disorder: a study", "Example Essays")).toBe(
      "Order - Disorder: a study",
    );
  });
});
