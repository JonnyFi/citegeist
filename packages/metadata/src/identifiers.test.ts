import { describe, expect, it } from "vitest";
import {
  detectIdentifier,
  extractFromXmp,
  extractIdentifiers,
  isValidIsbn10,
  isValidIsbn13,
  normalizeArxivId,
  normalizeDoi,
  normalizeIsbn,
  pickPrimary,
} from "./identifiers.js";

describe("DOI", () => {
  it("normalises prefixes, case and trailing punctuation", () => {
    expect(normalizeDoi("https://doi.org/10.1038/S41586-020-2649-2")).toBe(
      "10.1038/s41586-020-2649-2",
    );
    expect(normalizeDoi("doi:10.1007/s11577-025-01008-x.")).toBe("10.1007/s11577-025-01008-x");
    expect(normalizeDoi("DOI 10.1191/1478088706qp063oa")).toBe("10.1191/1478088706qp063oa");
  });

  it("keeps balanced parentheses and drops unbalanced ones", () => {
    expect(normalizeDoi("10.1016/S0140-6736(97)11096-0")).toBe("10.1016/s0140-6736(97)11096-0");
    expect(normalizeDoi("10.1016/S0140-6736(97)11096-0)")).toBe("10.1016/s0140-6736(97)11096-0");
  });

  it("decodes percent-encoded DOIs from URLs", () => {
    expect(detectIdentifier("https://doi.org/10.1016%2FS0140-6736%2897%2911096-0")).toMatchObject({
      kind: "doi",
      value: "10.1016/s0140-6736(97)11096-0",
    });
  });

  it("finds DOIs in publisher URLs", () => {
    for (const url of [
      "https://link.springer.com/article/10.1007/s11577-025-01008-x",
      "https://www.tandfonline.com/doi/full/10.1191/1478088706qp063oa?src=recsys",
      "https://onlinelibrary.wiley.com/doi/10.1111/j.1467-954X.2010.01934.x",
      "https://journals.sagepub.com/doi/pdf/10.1177/1049732305276687?download=true",
    ]) {
      expect(detectIdentifier(url)?.kind).toBe("doi");
    }
    expect(detectIdentifier("https://www.nature.com/articles/s41586-020-2649-2")?.value).toBe(
      "10.1038/s41586-020-2649-2",
    );
  });
});

describe("arXiv", () => {
  it("parses new and old style ids with versions", () => {
    expect(normalizeArxivId("1706.03762v7")).toEqual({ id: "1706.03762", version: "v7" });
    expect(normalizeArxivId("arXiv:1409.0473")).toEqual({ id: "1409.0473" });
    expect(normalizeArxivId("hep-th/9711200v3")).toEqual({ id: "hep-th/9711200", version: "v3" });
    expect(normalizeArxivId("math.GT/0309136")).toEqual({ id: "math/0309136" });
    expect(normalizeArxivId("https://arxiv.org/pdf/2101.00001v2.pdf")).toEqual({
      id: "2101.00001",
      version: "v2",
    });
  });

  it("rejects impossible ids", () => {
    expect(normalizeArxivId("1713.00001")).toBeUndefined(); // month 13
    expect(normalizeArxivId("1501.0001")).toBeUndefined(); // four digits after 1412
    expect(normalizeArxivId("1409.04731")).toBeUndefined(); // five digits before 1501
    expect(normalizeArxivId("foo/9711200")).toBeUndefined(); // unknown archive
    expect(normalizeArxivId("0601.00001")).toBeUndefined(); // before 0704
  });

  it("detects arXiv ids and URLs", () => {
    expect(detectIdentifier("arXiv:1706.03762")).toMatchObject({
      kind: "arxiv",
      value: "1706.03762",
    });
    expect(detectIdentifier("https://arxiv.org/abs/hep-th/9711200")).toMatchObject({
      kind: "arxiv",
      value: "hep-th/9711200",
      via: "url",
    });
  });
});

describe("ISBN", () => {
  it("checks ISBN-13 and ISBN-10 checksums", () => {
    expect(isValidIsbn13("9783518282663")).toBe(true);
    expect(isValidIsbn13("9783518282664")).toBe(false);
    expect(isValidIsbn10("0743203046")).toBe(true);
    expect(isValidIsbn10("080442957X")).toBe(true);
    expect(isValidIsbn10("0743203047")).toBe(false);
  });

  it("converts ISBN-10 to ISBN-13 and strips separators", () => {
    expect(normalizeIsbn("0-7432-0304-6")).toBe("9780743203043");
    expect(normalizeIsbn("978-3-518-28266-3")).toBe("9783518282663");
    expect(normalizeIsbn("978 3 518 28266 3")).toBe("9783518282663");
    expect(normalizeIsbn("0-8044-2957-x")).toBe("9780804429573");
    expect(normalizeIsbn("978-3-518-28266-4")).toBeUndefined();
  });

  it("detects labelled and bare ISBNs", () => {
    expect(detectIdentifier("ISBN 978-3-518-28266-3")).toMatchObject({
      kind: "isbn",
      value: "9783518282663",
    });
    expect(detectIdentifier("ISBN-10: 3-518-58706-4")?.value).toBe("9783518587065");
    expect(detectIdentifier("9783658317157")?.kind).toBe("isbn");
  });
});

describe("PMID and URL", () => {
  it("detects PMIDs", () => {
    expect(detectIdentifier("PMID: 32939066")).toMatchObject({ kind: "pmid", value: "32939066" });
    expect(detectIdentifier("https://pubmed.ncbi.nlm.nih.gov/16204405/")).toMatchObject({
      kind: "pmid",
      value: "16204405",
    });
  });

  it("falls back to kind url", () => {
    expect(detectIdentifier("https://example.org/some/page")).toMatchObject({
      kind: "url",
      value: "https://example.org/some/page",
    });
  });

  it("returns undefined for free text", () => {
    expect(detectIdentifier("The strength of weak ties")).toBeUndefined();
    expect(detectIdentifier("")).toBeUndefined();
  });
});

describe("extraction from PDF text", () => {
  const firstPage = `Kölner Zeitschrift für Soziologie und Sozialpsychologie (2025) 77:247-269
https://doi.org/10.1007/s11577-025-01008-x

Forschungsnotiz zu PISA 2012-2022

Received: 12 March 2025 / Accepted: 2 May 2025
ISBN 978-3-658-31716-4 (print) and PMID: 32939066
arXiv:1706.03762v7 [cs.CL] 2 Aug 2023

Literatur
Coleman, J. (1988). Social capital. https://doi.org/10.1086/228943
`;

  it("lists identifiers in reading order and ignores the reference list", () => {
    const found = extractIdentifiers(firstPage);
    expect(found.map((f) => `${f.kind}:${f.value}`)).toEqual([
      "doi:10.1007/s11577-025-01008-x",
      "isbn:9783658317164",
      "pmid:32939066",
      "arxiv:1706.03762",
    ]);
    expect(pickPrimary(found)?.value).toBe("10.1007/s11577-025-01008-x");
  });

  it("includes DOIs after the references heading when asked to", () => {
    const all = extractIdentifiers(firstPage, { stopAtReferences: false });
    expect(all.some((f) => f.value === "10.1086/228943")).toBe(true);
  });

  it("does not take arbitrary numbers for ISBNs", () => {
    expect(extractIdentifiers("Tel. 0043 1 4277 12345, order 9781234567890")).toEqual([]);
  });

  it("reads old-style arXiv stamps", () => {
    const [id] = extractIdentifiers("arXiv:hep-th/9711200v3 20 Jan 1998");
    expect(id).toMatchObject({ kind: "arxiv", value: "hep-th/9711200", version: "v3" });
  });

  it("strips trailing sentence punctuation from DOIs", () => {
    const [id] = extractIdentifiers("See doi:10.1038/nature14539, which is cited often.");
    expect(id?.value).toBe("10.1038/nature14539");
  });
});

describe("extraction from XMP", () => {
  it("reads element and attribute forms", () => {
    const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF>
      <rdf:Description prism:doi="10.1177/1049732305276687">
        <dc:identifier><rdf:Bag><rdf:li>doi:10.1177/1049732305276687</rdf:li>
        <rdf:li>urn:isbn:9783518282663</rdf:li></rdf:Bag></dc:identifier>
        <pdfx:doi>10.1177/1049732305276687</pdfx:doi>
        <prism:url>https://journals.sagepub.com/doi/10.1177/1049732305276687</prism:url>
      </rdf:Description></rdf:RDF></x:xmpmeta>`;
    const found = extractFromXmp(xmp);
    expect(found.map((f) => `${f.kind}:${f.value}`).sort()).toEqual([
      "doi:10.1177/1049732305276687",
      "isbn:9783518282663",
    ]);
  });

  it("ignores bare numbers in dc:identifier", () => {
    expect(extractFromXmp("<dc:identifier>12345678</dc:identifier>")).toEqual([]);
  });
});
