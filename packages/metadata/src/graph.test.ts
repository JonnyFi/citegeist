/**
 * PubMed, Unpaywall, citation graph, retraction and version sources, replayed from recorded HTTP
 * responses (fixtures/metadata/http). An unknown request throws, so nothing here goes online.
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURE_DIR } from "./fixture-cases.js";
import {
  ARXIV_PREPRINT,
  ARXIV_PUBLISHED_DOI,
  ARXIV_WITH_JOURNAL,
  CLEAN_OA_DOI,
  CLOSED_DOI,
  DATACITE_DOI,
  PMID_WITHOUT_DOI,
  PREPRINT_DOI,
  PREPRINT_OF_PUBLISHED_DOI,
  PREPRINT_PUBLISHED_DOI,
  PUBLISHED_WITH_PREPRINT_DOI,
  RETRACTED_DOI,
  RETRACTED_PMID,
  UNKNOWN_DOI,
} from "./graph-cases.js";
import { classifyUpdateType } from "./graph-types.js";
import { type FetchLike, keyUrl } from "./http.js";
import { createReplayFetch } from "./replay.js";
import { createResolver } from "./resolver.js";
import { parsePubmedXml, pubmedUrl } from "./sources/pubmed.js";
import type { MetadataConfig } from "./types.js";

const HTTP_DIR = join(FIXTURE_DIR, "http");
const NOW = Date.parse("2026-10-24T12:00:00Z");
const TEST_MAILTO = "tester@example.invalid";

function make(config: MetadataConfig = {}, fetch: FetchLike = createReplayFetch(HTTP_DIR)) {
  return createResolver({
    config: { mailto: TEST_MAILTO, ...config },
    fetch,
    now: () => NOW,
    sleep: async () => {},
  });
}

describe("PMID resolution", () => {
  it("resolves a PMID through PubMed and the DOI it names", async () => {
    const r = await make({ unpaywall: false }).resolve(`PMID: ${RETRACTED_PMID}`);
    expect(r.status).toBe("resolved");
    expect(r.identifier).toMatchObject({ kind: "pmid", value: RETRACTED_PMID });
    expect(r.fields.DOI).toBe(RETRACTED_DOI);
    expect(r.fields.title).toMatch(/Ileal-lymphoid-nodular hyperplasia/);
    expect(r.fields["container-title"]).toBeTruthy();
    expect(r.fields.ids?.pmid).toBe(RETRACTED_PMID);
    expect(r.fields.author?.[0]).toMatchObject({ family: "Wakefield" });
    // The registration agency keeps the citation fields; PubMed contributes ids.
    expect(r.provenance.title).toBe("crossref@2026-10-24");
    expect(r.provenance["ids.pmid"]).toBe("pubmed@2026-10-24");
    expect(r.records.map((x) => x.source)).toEqual(
      expect.arrayContaining(["crossref", "pubmed", "openalex"]),
    );
  });

  it("reads the retracted-publication type from PubMed", async () => {
    const r = await make({ unpaywall: false }).resolve(`PMID: ${RETRACTED_PMID}`);
    expect(r.enrichment.isRetracted).toBe(true);
  });

  it("resolves a PMID without a DOI from PubMed alone", async () => {
    const r = await make().resolve(`https://pubmed.ncbi.nlm.nih.gov/${PMID_WITHOUT_DOI}/`);
    expect(r.status).toBe("resolved");
    expect(r.records.map((x) => x.source)).toEqual(["pubmed"]);
    expect(r.fields.title).toBeTruthy();
    expect(r.fields.DOI).toBeUndefined();
    expect(r.fields.type).toBe("article-journal");
    expect(r.provenance.title).toBe("pubmed@2026-10-24");
  });

  it("reports a source error when PubMed is down", async () => {
    const down: FetchLike = async () => new Response("", { status: 500 });
    const r = await make({}, down).resolve("PMID: 32939066");
    expect(r.status).toBe("not-found");
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.source).toBe("pubmed");
  });

  it("parses full names, labelled abstracts and ORCIDs from efetch XML", () => {
    const xml = `<?xml version="1.0"?><PubmedArticleSet><PubmedArticle><MedlineCitation>
      <PMID Version="1">42</PMID><Article PubModel="Print-Electronic"><Journal><ISSN>1234-5678</ISSN>
      <JournalIssue><Volume>3</Volume><Issue>2</Issue><PubDate><Year>2020</Year><Month>Mar</Month><Day>4</Day></PubDate></JournalIssue>
      <Title>Journal of Tests</Title></Journal>
      <ArticleTitle>A <i>test</i> title.</ArticleTitle><Pagination><MedlinePgn>11-19</MedlinePgn></Pagination>
      <ELocationID EIdType="doi" ValidYN="Y">10.1000/Test.1</ELocationID>
      <Abstract><AbstractText Label="BACKGROUND">Why.</AbstractText><AbstractText Label="METHODS">How <sup>2</sup>.</AbstractText></Abstract>
      <AuthorList><Author><LastName>Muster</LastName><ForeName>Erika</ForeName><Identifier Source="ORCID">https://orcid.org/0000-0002-1825-0097</Identifier></Author>
      <Author><CollectiveName>The Test Group</CollectiveName></Author></AuthorList>
      <Language>ger</Language><PublicationTypeList><PublicationType UI="D016428">Journal Article</PublicationType></PublicationTypeList>
      </Article></MedlineCitation><PubmedData><ArticleIdList><ArticleId IdType="pubmed">42</ArticleId><ArticleId IdType="pmc">PMC99</ArticleId></ArticleIdList></PubmedData>
      </PubmedArticle></PubmedArticleSet>`;
    const rec = parsePubmedXml(xml, "42", NOW);
    expect(rec?.fields).toMatchObject({
      title: "A test title",
      issued: "2020-03-04",
      "container-title": "Journal of Tests",
      volume: "3",
      issue: "2",
      page: "11-19",
      DOI: "10.1000/test.1",
      ISSN: "1234-5678",
      language: "de",
      abstract: "BACKGROUND: Why. METHODS: How 2.",
      ids: { pmid: "42", pmcid: "PMC99" },
    });
    expect(rec?.fields.author).toEqual([
      { family: "Muster", given: "Erika", orcid: "0000-0002-1825-0097" },
      { literal: "The Test Group" },
    ]);
  });

  it("answers undefined for an empty result set", () => {
    expect(parsePubmedXml("<PubmedArticleSet></PubmedArticleSet>", "7", NOW)).toBeUndefined();
  });

  it("sends tool, email and key to NCBI and keeps them out of cache keys", () => {
    const resolver = make({ ncbiApiKey: "secret-key", ncbiTool: "citegeist-test" });
    const ctx = {
      http: resolver.http,
      config: { mailto: TEST_MAILTO, ncbiApiKey: "secret-key", ncbiTool: "citegeist-test" },
      now: () => NOW,
    };
    const url = pubmedUrl(ctx, "efetch.fcgi", { db: "pubmed", id: "1", retmode: "xml" });
    expect(url).toContain("tool=citegeist-test");
    expect(url).toContain("email=tester%40example.invalid");
    expect(url).toContain("api_key=secret-key");
    expect(keyUrl(url)).not.toMatch(/tool=|email=|api_key=/);
  });
});

describe("Unpaywall", () => {
  it("returns the open-access PDF of an open article", async () => {
    const oa = await make().findOpenAccess(CLEAN_OA_DOI);
    expect(oa).toMatchObject({ isOa: true, license: "cc-by" });
    expect(oa?.pdfUrl).toMatch(/^https:\/\/www\.nature\.com\/.+\.pdf$/);
  });

  it("returns isOa false for a closed article and nothing for a DataCite DOI", async () => {
    const resolver = make();
    expect(await resolver.findOpenAccess(CLOSED_DOI)).toEqual({ isOa: false });
    expect(await resolver.findOpenAccess(DATACITE_DOI)).toBeUndefined();
  });

  it("feeds the PDF url of a resolved DOI, ahead of OpenAlex", async () => {
    const r = await make().resolve(CLEAN_OA_DOI);
    expect(r.records.map((x) => x.source)).toContain("unpaywall");
    expect(r.enrichment.openAccess?.pdfUrl).toMatch(/nature\.com/);
    expect(r.fields.title).toBe("Array programming with NumPy");
  });

  it("trusts Unpaywall when it says closed", async () => {
    const r = await make().resolve(CLOSED_DOI);
    expect(r.enrichment.openAccess?.isOa).toBe(false);
    expect(r.enrichment.openAccess?.pdfUrl).toBeUndefined();
  });

  it("asks Unpaywall for nothing without an email or when switched off", async () => {
    const replay = createReplayFetch(HTTP_DIR);
    const noMail = createResolver({ fetch: replay, now: () => NOW, sleep: async () => {} });
    expect(await noMail.findOpenAccess(CLEAN_OA_DOI)).toBeUndefined();
    await noMail.resolve(CLEAN_OA_DOI);
    const off = make({ unpaywall: false }, replay);
    await off.resolve(CLEAN_OA_DOI);
    expect(replay.calls.filter((u) => u.includes("unpaywall"))).toEqual([]);
  });
});

describe("retraction status", () => {
  it("finds the retraction and the correction of a known retracted DOI", async () => {
    const s = await make().retractionStatus(RETRACTED_DOI);
    expect(s.known).toBe(true);
    expect(s.checkedAt).toBe("2026-10-24");
    expect(s.notices).toEqual([
      {
        kind: "correction",
        label: "Correction",
        doi: "10.1016/s0140-6736(04)15715-2",
        date: "2004-03-06",
        source: "retraction-watch",
        recordId: "17269",
      },
      {
        kind: "retraction",
        label: "Retraction",
        doi: "10.1016/s0140-6736(10)60175-4",
        date: "2010-02-06",
        source: "retraction-watch",
        recordId: "4036",
      },
    ]);
  });

  it("reports a clean article without notices", async () => {
    const s = await make().retractionStatus(CLEAN_OA_DOI);
    expect(s).toMatchObject({ known: true, notices: [], noticeFor: [] });
  });

  it("falls back to OpenAlex for a DOI Crossref does not know", async () => {
    const replay = createReplayFetch(HTTP_DIR);
    const s = await make({}, replay).retractionStatus(UNKNOWN_DOI);
    expect(s).toMatchObject({ known: false, notices: [] });
    expect(replay.calls.some((u) => u.includes("api.openalex.org"))).toBe(true);
  });

  it("never answers from the cache", async () => {
    const replay = createReplayFetch(HTTP_DIR);
    const resolver = make({}, replay);
    await resolver.retractionStatus(CLEAN_OA_DOI);
    const before = replay.calls.length;
    await resolver.retractionStatus(CLEAN_OA_DOI);
    expect(replay.calls.length - before).toBe(before);
  });

  it("maps Crossref update types, typos included", () => {
    expect(classifyUpdateType("retraction")).toBe("retraction");
    expect(classifyUpdateType("Retraction")).toBe("retraction");
    expect(classifyUpdateType("retration")).toBe("retraction");
    expect(classifyUpdateType("retracion")).toBe("retraction");
    expect(classifyUpdateType("withdrawal")).toBe("withdrawal");
    expect(classifyUpdateType("expression_of_concern")).toBe("expression-of-concern");
    for (const t of ["correction", "erratum", "corrigendum", "partial_retraction"]) {
      expect(classifyUpdateType(t)).toBe("correction");
    }
    for (const t of ["new_version", "new_edition", "68818", "", undefined]) {
      expect(classifyUpdateType(t)).toBeUndefined();
    }
  });
});

describe("citation graph sources", () => {
  it("lists the Crossref reference deposit of a DOI", async () => {
    const page = await make().crossrefReferences(RETRACTED_DOI, 10);
    expect(page?.total).toBe(26);
    expect(page?.works).toHaveLength(10);
    for (const w of page?.works ?? []) expect(w.title ?? w.raw ?? w.doi).toBeTruthy();
  });

  it("answers undefined for a DOI Crossref does not know", async () => {
    expect(await make().crossrefReferences(UNKNOWN_DOI, 10)).toBeUndefined();
  });

  it("resolves OpenAlex referenced_works in the order of the reference list", async () => {
    const page = await make().openAlexReferences({ doi: RETRACTED_DOI }, 50);
    expect(page?.total).toBe(25);
    expect(page?.works).toHaveLength(25);
    expect(page?.openalex).toMatch(/^W\d+$/);
    // The first reference is one OpenAlex lists but cannot describe: it stays as a bare id.
    expect(page?.works[0]).toEqual({ openalex: "W19804704" });
    expect(page?.works[1]).toMatchObject({
      openalex: "W40430408",
      pmid: "7010949",
      year: 1981,
      authors: "Reichelt, Hole, Hamberger et al.",
    });
  });

  it("lists citing works, most cited first, with a cursor for the next page", async () => {
    const page = await make().openAlexCiting({ doi: RETRACTED_DOI }, { limit: 5 });
    expect(page?.total).toBeGreaterThan(1000);
    expect(page?.works.map((w) => w.openalex)).toEqual([
      "W2135400982",
      "W2145914632",
      "W2769544142",
      "W2974087526",
      "W1987319584",
    ]);
    expect(page?.next).toBeTruthy();
    const counts = (page?.works ?? []).map((w) => w.citedBy ?? 0);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  it("finds the DOI of an OpenAlex work", async () => {
    expect(await make().openAlexDoi("W2135400982")).toBe("10.1016/j.jclinepi.2010.07.015");
  });
});

describe("preprint and published version", () => {
  it("reads the published DOI from the arXiv record", async () => {
    const r = await make().findVersions({ arxiv: ARXIV_WITH_JOURNAL });
    expect(r.errors).toEqual([]);
    expect(r.links).toEqual([
      { relation: "preprint-of", doi: ARXIV_PUBLISHED_DOI, source: "arxiv" },
    ]);
  });

  it("finds the arXiv preprint of a published article through OpenAlex", async () => {
    const r = await make().findVersions({ doi: ARXIV_PUBLISHED_DOI });
    expect(r.links).toEqual([
      { relation: "has-preprint", arxiv: ARXIV_WITH_JOURNAL, source: "openalex" },
    ]);
  });

  it("reads Crossref is-preprint-of on a preprint", async () => {
    const r = await make().findVersions({ doi: PREPRINT_DOI });
    expect(r.links).toEqual([
      { relation: "preprint-of", doi: PREPRINT_PUBLISHED_DOI, source: "crossref" },
    ]);
  });

  it("reads Crossref has-preprint on a published article", async () => {
    const r = await make().findVersions({ doi: PUBLISHED_WITH_PREPRINT_DOI });
    expect(r.links).toEqual([
      { relation: "has-preprint", doi: PREPRINT_OF_PUBLISHED_DOI, source: "crossref" },
    ]);
  });

  it("finds no other version for a preprint that was never published", async () => {
    const r = await make().findVersions({ arxiv: ARXIV_PREPRINT });
    expect(r.links).toEqual([]);
  });

  it("keeps the links of the sources that answered when another one fails", async () => {
    const replay = createReplayFetch(HTTP_DIR);
    const flaky: FetchLike = (url, init) =>
      url.includes("openalex.org")
        ? Promise.resolve(new Response("", { status: 500 }))
        : replay(url, init);
    const r = await make({}, flaky).findVersions({ doi: PREPRINT_DOI });
    expect(r.links).toHaveLength(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/^openalex:/);
  });
});
