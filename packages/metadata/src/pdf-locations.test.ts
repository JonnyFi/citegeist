import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openAccessPdfLocations, openAccessPdfUrls } from "./sources/openalex.js";
import { mapUnpaywall, unpaywallPdfLocations } from "./sources/unpaywall.js";

const dir = fileURLToPath(new URL("../../../fixtures/fulltext/", import.meta.url));
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(`${dir}${name}`, "utf8")) as Record<string, unknown>;

const DOWNLOAD =
  "https://scholarspace.manoa.hawaii.edu/bitstreams/0f3766c3-5aa4-4ef9-bb6c-37ff2188a131/download";
const AISEL = "https://aisel.aisnet.org/context/hicss-58/article/1739/viewcontent/download.pdf";

describe("OpenAlex PDF locations", () => {
  const work = fixture("openalex-hicss2025.json");

  it("lists best, primary and all other locations once, with version and host type", () => {
    expect(openAccessPdfLocations(work)).toEqual([
      { url: DOWNLOAD, version: "publishedVersion", hostType: "repository" },
      { url: AISEL, version: "publishedVersion", hostType: "publisher" },
    ]);
  });

  it("keeps the url list for callers that only want addresses", () => {
    expect(openAccessPdfUrls(work)).toEqual([DOWNLOAD, AISEL]);
  });

  it("adds open_access.oa_url when no location names it, and skips closed locations", () => {
    const loc = openAccessPdfLocations({
      best_oa_location: null,
      locations: [{ is_oa: false, pdf_url: "https://closed.example.org/a.pdf" }],
      open_access: { is_oa: true, oa_url: "https://repo.example.org/record/1" },
    });
    expect(loc).toEqual([{ url: "https://repo.example.org/record/1" }]);
  });
});

describe("Unpaywall PDF locations", () => {
  const body = fixture("unpaywall-hicss2025.json");

  it("lists the best location and every oa_location with a PDF address once", () => {
    expect(unpaywallPdfLocations(body)).toEqual([
      { url: DOWNLOAD, version: "publishedVersion", hostType: "repository" },
      { url: AISEL, version: "publishedVersion", hostType: "repository" },
    ]);
  });

  it("puts them on the enrichment next to the single best pdfUrl", () => {
    const oa = mapUnpaywall(body).openAccess;
    expect(oa?.pdfUrl).toBe(DOWNLOAD);
    expect(oa?.pdfLocations?.map((l) => l.url)).toEqual([DOWNLOAD, AISEL]);
  });
});
