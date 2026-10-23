import { Provenance } from "@citegeist/schema";
import { describe, expect, it } from "vitest";
import { mergeRecords } from "./merge.js";
import type { MetadataFields, SourceName, SourceRecord } from "./types.js";

function rec(
  source: SourceName,
  fields: MetadataFields,
  extra: Partial<SourceRecord> = {},
): SourceRecord {
  return { source, recordId: "x", fetchedAt: "2026-10-23", fields, ...extra };
}

describe("citation fields", () => {
  it("lets the registration agency beat OpenAlex and the catalogues", () => {
    const merged = mergeRecords([
      rec("openalex", { title: "Wrong Title", issued: 2025, type: "article" }),
      rec("dnb", { title: "Dnb Title", issued: "1999", type: "book" }),
      rec("crossref", { title: "Right Title", issued: "1984", type: "article-journal" }),
    ]);
    expect(merged.fields).toMatchObject({
      title: "Right Title",
      issued: "1984",
      type: "article-journal",
    });
    expect(merged.provenance.title).toBe("crossref@2026-10-23");
  });

  it("falls back to arXiv, then catalogues, then OpenAlex", () => {
    const merged = mergeRecords([
      rec("openalex", { title: "C", language: "en" }),
      rec("arxiv", { title: "A" }),
      rec("dnb", { title: "B", publisher: "Suhrkamp" }),
    ]);
    expect(merged.fields.title).toBe("A");
    expect(merged.fields.publisher).toBe("Suhrkamp");
    expect(merged.fields.language).toBe("en");
  });

  it("takes the subtitle only from the record that supplied the title", () => {
    const merged = mergeRecords([
      rec("crossref", { title: "Soziale Systeme: Grundriss" }),
      rec("dnb", { title: "Soziale Systeme", subtitle: "Grundriss" }),
    ]);
    expect(merged.fields.title).toBe("Soziale Systeme: Grundriss");
    expect(merged.fields.subtitle).toBeUndefined();
  });

  it("does not attach an arXiv URL to the published article", () => {
    const merged = mergeRecords([
      rec("crossref", { DOI: "10.1000/published", title: "T" }),
      rec("arxiv", { URL: "https://arxiv.org/abs/1", DOI: "10.48550/arxiv.1", title: "T" }),
    ]);
    expect(merged.fields.URL).toBeUndefined();
    expect(merged.fields.DOI).toBe("10.1000/published");
  });
});

describe("authors and ORCIDs", () => {
  it("keeps the agency's authors and fills ORCIDs from OpenAlex", () => {
    const merged = mergeRecords([
      rec("crossref", {
        author: [
          { family: "Harris", given: "Charles R." },
          { family: "van der Walt", given: "Stéfan J.", orcid: "0000-0001-9276-1234" },
          { family: "Smith", given: "Anna" },
        ],
      }),
      rec("openalex", {
        author: [
          { family: "Harris", given: "Charles R.", orcid: "0000-0002-1111-2222" },
          { family: "van der Walt", given: "Stéfan J.", orcid: "0000-0009-9999-9999" },
          { family: "Smyth", given: "Anna", orcid: "0000-0003-3333-4444" },
        ],
      }),
    ]);
    const authors = merged.fields.author ?? [];
    expect(authors.map((a) => ("orcid" in a ? a.orcid : undefined))).toEqual([
      "0000-0002-1111-2222",
      "0000-0001-9276-1234", // Crossref value is not replaced
      undefined, // different surname: no guess
    ]);
    expect(merged.provenance.author).toBe("crossref@2026-10-23");
    expect(merged.provenance["author.orcid"]).toBe("openalex@2026-10-23");
  });

  it("uses OpenAlex authors only when nobody else has any", () => {
    const merged = mergeRecords([rec("openalex", { author: [{ family: "Only", given: "O." }] })]);
    expect(merged.fields.author).toEqual([{ family: "Only", given: "O." }]);
  });

  it("prefers the most complete editor list inside the catalogue tier", () => {
    const merged = mergeRecords([
      rec("dnb", { editor: [{ family: "Delitz", given: "Heike" }] }),
      rec("k10plus", {
        editor: [
          { family: "Delitz", given: "Heike" },
          { family: "Müller", given: "Julian" },
          { family: "Seyfert", given: "Robert" },
        ],
      }),
    ]);
    expect(merged.fields.editor).toHaveLength(3);
    expect(merged.provenance.editor).toBe("k10plus@2026-10-23");
  });
});

describe("abstracts", () => {
  it("comes from whichever source has one", () => {
    const merged = mergeRecords([
      rec("crossref", { title: "T" }),
      rec("openalex", { abstract: "From OpenAlex." }),
    ]);
    expect(merged.fields.abstract).toBe("From OpenAlex.");
    expect(merged.provenance.abstract).toBe("openalex@2026-10-23");
  });

  it("prefers Crossref over OpenAlex when both exist", () => {
    const merged = mergeRecords([
      rec("openalex", { abstract: "B" }),
      rec("crossref", { abstract: "A" }),
    ]);
    expect(merged.fields.abstract).toBe("A");
  });
});

describe("user values", () => {
  it("always win and are marked in the provenance", () => {
    const merged = mergeRecords(
      [rec("crossref", { title: "Crossref Title", subtitle: "Sub", issued: "2020" })],
      {
        user: { title: "My Title", ids: { zotero: "ABC" } },
        today: "2026-10-24",
      },
    );
    expect(merged.fields.title).toBe("My Title");
    expect(merged.fields.subtitle).toBeUndefined();
    expect(merged.fields.issued).toBe("2020");
    expect(merged.fields.ids).toEqual({ zotero: "ABC" });
    expect(merged.provenance.title).toBe("user@2026-10-24");
    expect(merged.provenance["ids.zotero"]).toBe("user@2026-10-24");
  });
});

describe("provenance format", () => {
  it("matches the ItemFrontmatter provenance pattern", () => {
    const merged = mergeRecords(
      [
        rec("crossref", { title: "T", DOI: "10.1/x", ids: { openalex: "W1" } }),
        rec("doi.org", { title: "T2" }),
      ],
      { user: { volume: "3" }, today: "2026-10-24" },
    );
    expect(() => Provenance.parse(merged.provenance)).not.toThrow();
  });
});

describe("enrichment", () => {
  it("collects topics from OpenAlex and ORs the retraction flag", () => {
    const merged = mergeRecords([
      rec("crossref", { title: "T" }, { enrichment: { isRetracted: true } }),
      rec(
        "openalex",
        { title: "T" },
        { enrichment: { topics: ["Sociology"], isRetracted: false } },
      ),
    ]);
    expect(merged.enrichment).toEqual({ isRetracted: true, topics: ["Sociology"] });
  });
});
