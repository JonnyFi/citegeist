import { describe, expect, it } from "vitest";
import {
  citationPdfUrls,
  findPdfLinks,
  mergeCandidates,
  orderCandidates,
  rewriteRepositoryUrl,
} from "./fulltext.js";

const UUID = "0f3766c3-5aa4-4ef9-bb6c-37ff2188a131";

describe("rewriteRepositoryUrl", () => {
  it("sends DSpace 7 /bitstreams/<uuid>/download to the REST content address", () => {
    expect(
      rewriteRepositoryUrl(`https://scholarspace.manoa.hawaii.edu/bitstreams/${UUID}/download`),
    ).toEqual({
      url: `https://scholarspace.manoa.hawaii.edu/server/api/core/bitstreams/${UUID}/content`,
      rule: "dspace7-bitstream",
    });
  });

  it("also handles /bitstreams/<uuid>, a UI path prefix and a query string", () => {
    expect(rewriteRepositoryUrl(`https://repo.example.org/bitstreams/${UUID}`)?.url).toBe(
      `https://repo.example.org/server/api/core/bitstreams/${UUID}/content`,
    );
    expect(
      rewriteRepositoryUrl(
        `http://repo.example.org/ui/bitstreams/${UUID}/download?authentication-token=x`,
      )?.url,
    ).toBe(`http://repo.example.org/server/api/core/bitstreams/${UUID}/content`);
  });

  it("sends an OJS galley viewer to the download address", () => {
    expect(
      rewriteRepositoryUrl("https://journals.example.org/index.php/j/article/view/12/34"),
    ).toEqual({
      url: "https://journals.example.org/index.php/j/article/download/12/34",
      rule: "ojs-galley",
    });
  });

  it("leaves addresses alone that already serve the file", () => {
    for (const url of [
      `https://repo.example.org/server/api/core/bitstreams/${UUID}/content`,
      "https://dspace6.example.org/bitstream/handle/123456789/45/paper.pdf?sequence=1",
      "https://dspace6.example.org/bitstream/id/1234/paper.pdf",
      "https://eprints.example.org/id/eprint/12/1/paper.pdf",
      "https://zenodo.org/records/1/files/a.pdf?download=1",
      "https://journals.example.org/article/download/12/34",
    ]) {
      expect(rewriteRepositoryUrl(url)).toBeUndefined();
    }
  });
});

describe("candidate order", () => {
  it("merges addresses that several sources name and remembers the sources", () => {
    const merged = mergeCandidates([
      {
        source: "unpaywall",
        locations: [{ url: "https://a.org/x.pdf", version: "acceptedVersion" }],
      },
      { source: "openalex", locations: ["https://a.org/x.pdf", { url: "https://b.org/y.pdf" }] },
    ]);
    expect(merged).toEqual([
      {
        url: "https://a.org/x.pdf",
        sources: ["unpaywall", "openalex"],
        version: "acceptedVersion",
      },
      { url: "https://b.org/y.pdf", sources: ["openalex"] },
    ]);
  });

  it("puts published before accepted before submitted before unknown, aggregators last in a tie", () => {
    const merged = mergeCandidates([
      {
        source: "unpaywall",
        locations: [
          { url: "https://x.org/unknown.pdf" },
          { url: "https://x.org/submitted.pdf", version: "submittedVersion" },
          { url: "https://www.researchgate.net/p.pdf", version: "publishedVersion" },
          { url: "https://x.org/accepted.pdf", version: "acceptedVersion" },
          { url: "https://x.org/published.pdf", version: "publishedVersion" },
        ],
      },
    ]);
    expect(orderCandidates(merged).map((c) => c.url)).toEqual([
      "https://x.org/published.pdf",
      "https://www.researchgate.net/p.pdf",
      "https://x.org/accepted.pdf",
      "https://x.org/submitted.pdf",
      "https://x.org/unknown.pdf",
    ]);
  });

  it("keeps the order the sources gave when rank is equal", () => {
    const merged = mergeCandidates([
      { source: "unpaywall", locations: ["https://a.org/1.pdf", "https://a.org/2.pdf"] },
      { source: "openalex", locations: ["https://b.org/3.pdf"] },
    ]);
    expect(orderCandidates(merged).map((c) => c.url)).toEqual([
      "https://a.org/1.pdf",
      "https://a.org/2.pdf",
      "https://b.org/3.pdf",
    ]);
  });
});

describe("findPdfLinks", () => {
  const base = "https://repo.example.org/handle/1/2";

  it("reads citation_pdf_url, a relative one included, before anything else", () => {
    const html = `<meta content="/files/a.pdf?x=1&amp;y=2" name="citation_pdf_url"><a href="/b.pdf">PDF</a>`;
    expect(findPdfLinks(html, base)).toEqual([
      "https://repo.example.org/files/a.pdf?x=1&y=2",
      "https://repo.example.org/b.pdf",
    ]);
  });

  it("reads <link rel=alternate type=application/pdf>", () => {
    const html = `<link rel="alternate" type="application/pdf" href="/p/1.pdf"><link rel="stylesheet" href="/s.css">`;
    expect(findPdfLinks(html, base)).toEqual(["https://repo.example.org/p/1.pdf"]);
  });

  it("takes an anchor to a .pdf or /download whose text says PDF or Download", () => {
    const html = `
      <a href="/about">About</a>
      <a href="/files/paper.pdf">Cite this</a>
      <a href="/items/9/download"><b>Download</b> full text</a>
      <a href="https://other.example.net/x.pdf">PDF</a>
      <a href="https://zenodo.org/records/1/files/a.pdf">PDF</a>`;
    expect(findPdfLinks(html, base, 5)).toEqual([
      "https://repo.example.org/items/9/download",
      "https://zenodo.org/records/1/files/a.pdf",
    ]);
  });

  it("never returns the page itself and stops at the limit", () => {
    const html = `<a href="/handle/1/2">PDF</a><a href="/1.pdf">PDF</a><a href="/2.pdf">PDF</a><a href="/3.pdf">PDF</a>`;
    expect(findPdfLinks(html, base)).toEqual([
      "https://repo.example.org/1.pdf",
      "https://repo.example.org/2.pdf",
    ]);
  });

  it("returns nothing for a page without a PDF link, and citationPdfUrls still works alone", () => {
    expect(findPdfLinks("<html><title>x</title></html>", base)).toEqual([]);
    expect(citationPdfUrls(`<meta name='citation_pdf_url' content='/a.pdf'>`, base)).toEqual([
      "https://repo.example.org/a.pdf",
    ]);
  });
});
