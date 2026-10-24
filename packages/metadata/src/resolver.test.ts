/**
 * Acceptance: 20 identifiers resolve to the expected fields by replaying recorded HTTP responses
 * (fixtures/metadata/http). Nothing here touches the network; an unknown request throws.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ItemFrontmatter } from "@citegeist/schema";
import { describe, expect, it } from "vitest";
import { CASES, FIXTURE_DIR, OL_FALLBACK_ISBNS } from "./fixture-cases.js";
import type { FetchLike } from "./http.js";
import { createReplayFetch } from "./replay.js";
import { createResolver, type ResolveResult } from "./resolver.js";
import type { MetadataConfig } from "./types.js";

const HTTP_DIR = join(FIXTURE_DIR, "http");
const NOW = Date.parse("2026-10-23T12:00:00Z");
const TEST_MAILTO = "tester@example.invalid";

function resolver(config: MetadataConfig = {}, fetch: FetchLike = createReplayFetch(HTTP_DIR)) {
  return createResolver({
    config: { mailto: TEST_MAILTO, unpaywall: false, ...config },
    fetch,
    now: () => NOW,
    sleep: async () => {},
  });
}

/** Per-case checks beyond the exact field comparison. */
const EXTRA: Record<string, (r: ResolveResult) => void> = {
  "Nature article with many authors": (r) => {
    const authors = r.fields.author ?? [];
    expect(authors).toHaveLength(26);
    expect(authors[0]).toMatchObject({ family: "Harris", given: "Charles R." });
    // Crossref has 9 ORCIDs for this paper, OpenAlex adds more.
    expect(authors.filter((a) => "orcid" in a && a.orcid).length).toBeGreaterThan(9);
    expect(r.enrichment.topics?.length).toBeGreaterThan(0);
    expect(r.enrichment.references?.[0]).toMatch(/^W\d+$/);
  },
  "Taylor and Francis article, abstract only in OpenAlex": (r) => {
    expect(r.fields.abstract).toMatch(/^Thematic analysis is a poorly demarcated/);
    expect(r.fields.author).toMatchObject([
      { family: "Braun", given: "Virginia", orcid: "0000-0002-3435-091X" },
      { family: "Clarke", given: "Victoria" },
    ]);
  },
  "German-language sociology article": (r) => {
    expect(r.fields.title).toMatch(/^Forschungsnotiz zu PISA 2012–2022/);
    expect(r.fields.abstract).toMatch(/^Angesichts/);
    const authors = r.fields.author ?? [];
    expect(authors).toHaveLength(4);
    // Crossref names one ORCID, OpenAlex the other three.
    expect(authors.every((a) => "orcid" in a && a.orcid)).toBe(true);
  },
  "Book chapter gets editors from the parent book": (r) => {
    expect(r.fields.author).toMatchObject([{ family: "Bogusz", given: "Tanja" }]);
    expect(r.records.map((x) => x.source)).toContain("crossref");
    // The parent only contributes editors and place, never title or pages.
    expect(r.fields.title).not.toBe("Handbuch Theorien der Soziologie");
  },
  "Retracted Lancet article without abstract": (r) => {
    expect(r.fields.title).toMatch(/^RETRACTED:/);
    expect(r.fields.abstract).toBeUndefined();
    expect(r.enrichment.isRetracted).toBe(true);
  },
  "Political science article with capitalised author names": (r) => {
    expect(r.fields.author?.[0]).toMatchObject({ family: "Fearon", given: "James D." });
  },
  "DataCite DOI of an arXiv preprint": (r) => {
    expect(r.fields.ids?.arxiv).toBe("1706.03762");
    expect(r.fields.author).toHaveLength(8);
    expect(r.enrichment.openAccess?.pdfUrl).toBe("https://arxiv.org/pdf/1706.03762");
  },
  "mEDRA DOI with HTML entities": (r) => {
    expect(r.fields["publisher-place"]).toBeUndefined(); // "IT" is a country code
    expect(JSON.stringify(r.fields)).not.toMatch(/&#\d+;/);
  },
  "EU Publications Office DOI with corporate author": (r) => {
    expect(r.fields["publisher-place"]).toBeUndefined();
    expect(r.fields.title).toMatch(/^Highlights report 2024/);
  },
  "arXiv id, new style": (r) => {
    expect(r.enrichment.arxivVersion).toBe("v7");
    expect(r.enrichment.arxivCategories).toContain("cs.CL");
    expect(r.fields.author).toHaveLength(8);
  },
  "arXiv id, old style with published DOI": (r) => {
    expect(r.enrichment.journalRef).toBe("Adv.Theor.Math.Phys.2:231-252,1998");
    expect(r.enrichment.publishedDoi).toBe("10.1023/a:1026654312961");
    expect(r.fields.ids?.arxiv).toBe("hep-th/9711200");
    expect(r.fields.author).toMatchObject([{ family: "Maldacena" }]);
  },
  "German ISBN-13 from DNB, Luhmann": (r) => {
    expect(r.fields.subtitle).toMatch(/^Grundriss/);
    expect(r.enrichment.tocUrl).toMatch(/^https?:\/\/d-nb\.info\/\d+\/04$/);
    expect(r.records.map((x) => x.source).sort()).toEqual(["dnb", "k10plus"]);
  },
  "Edited volume, all editors from K10plus": (r) => {
    expect(r.fields.author).toBeUndefined();
    expect(r.provenance.editor).toBe("k10plus@2026-10-23");
  },
  "ISBN-10 input, non-German book from K10plus": (r) => {
    // No DNB request for a non-German ISBN.
    expect(r.records.map((x) => x.source)).toEqual(["k10plus"]);
  },
};

describe("20 fixture identifiers", () => {
  it("covers 20 distinct inputs", () => {
    expect(CASES).toHaveLength(20);
    expect(new Set(CASES.map((c) => c.input)).size).toBe(20);
  });

  for (const c of CASES) {
    it(`${c.name} (${c.input})`, async () => {
      const result = await resolver().resolve(c.input);
      expect(result.errors).toEqual([]);
      expect(result.status).toBe("resolved");
      for (const [key, value] of Object.entries(c.expect)) {
        expect(result.fields[key as keyof typeof result.fields], key).toEqual(value);
      }
      for (const [key, source] of Object.entries(c.from ?? {})) {
        expect(result.provenance[key], `provenance ${key}`).toBe(`${source}@2026-10-23`);
      }
      EXTRA[c.name]?.(result);

      // The merged record must be a valid item once the library fills id, citekey and stamps.
      const item = ItemFrontmatter.safeParse({
        ...result.fields,
        id: "01JB0000000000000000000000",
        citekey: "test2026",
        created: { at: "2026-10-23T12:00:00Z", by: "system" },
        provenance: result.provenance,
      });
      expect(item.error?.issues ?? []).toEqual([]);
    });
  }
});

describe("source selection", () => {
  it("falls back to Open Library when the catalogues are skipped", async () => {
    for (const isbn of OL_FALLBACK_ISBNS) {
      const r = await resolver({ isbnSources: ["openlibrary"] }).resolve(isbn);
      expect(r.status).toBe("resolved");
      expect(r.records.map((x) => x.source)).toEqual(["openlibrary"]);
      expect(r.fields).toMatchObject({
        type: "book",
        title: "Bowling Alone",
        ISBN: "9780743203043",
        publisher: "Simon & Schuster",
        issued: "2001",
      });
      expect(r.fields.author).toEqual([{ family: "Putnam", given: "Robert D." }]);
      expect(r.provenance.title).toBe("openlibrary@2026-10-23");
    }
  });

  it("asks both DNB and K10plus for a German ISBN", async () => {
    const replay = createReplayFetch(HTTP_DIR);
    await resolver({}, replay).resolve("9783518587065");
    expect(replay.calls.some((u) => u.includes("services.dnb.de"))).toBe(true);
    expect(replay.calls.some((u) => u.includes("sru.k10plus.de"))).toBe(true);
    expect(replay.calls.some((u) => u.includes("openlibrary.org"))).toBe(false);
  });

  it("uses doi.org only after Crossref says 404", async () => {
    const replay = createReplayFetch(HTTP_DIR);
    await resolver({}, replay).resolve("10.1086/225469");
    expect(replay.calls.some((u) => u.startsWith("https://doi.org/"))).toBe(false);
    const replay2 = createReplayFetch(HTTP_DIR);
    await resolver({}, replay2).resolve("10.5281/zenodo.12490189");
    expect(replay2.calls.some((u) => u.startsWith("https://doi.org/"))).toBe(true);
  });

  it("skips OpenAlex when disabled", async () => {
    const replay = createReplayFetch(HTTP_DIR);
    const r = await resolver({ openalex: false }, replay).resolve("10.1038/s41586-020-2649-2");
    expect(replay.calls.some((u) => u.includes("openalex.org"))).toBe(false);
    expect(r.fields.ids).toBeUndefined();
    expect(r.fields.abstract).toMatch(/^Array programming provides/);
    expect(r.provenance["author.orcid"]).toBe("crossref@2026-10-23");
  });

  it("does not follow the published DOI of an arXiv record when disabled", async () => {
    const r = await resolver({ followPublishedDoi: false }).resolve("arXiv:hep-th/9711200");
    expect(r.fields.DOI).toBe("10.48550/arxiv.hep-th/9711200");
    expect(r.enrichment.publishedDoi).toBe("10.1023/a:1026654312961");
  });
});

describe("configuration", () => {
  it("sends the configured mailto and OpenAlex key, and never records them", async () => {
    const replay = createReplayFetch(HTTP_DIR);
    const seen: string[] = [];
    const agents: string[] = [];
    const spy: FetchLike = (url, init) => {
      seen.push(url);
      agents.push(new Headers(init?.headers).get("user-agent") ?? "");
      return replay(url, init);
    };
    await resolver({ openalexApiKey: "key-123" }, spy).resolve("10.1086/225469");
    const crossref = seen.find((u) => u.includes("api.crossref.org"));
    const openalex = seen.find((u) => u.includes("api.openalex.org"));
    expect(crossref).toContain(`mailto=${encodeURIComponent(TEST_MAILTO)}`);
    expect(openalex).toContain("api_key=key-123");
    expect(agents[0]).toContain(`mailto:${TEST_MAILTO}`);
    for (const u of replay.calls) expect(u).not.toMatch(/mailto|api_key/);
  });

  it("sends no mailto when none is configured", async () => {
    const seen: string[] = [];
    const replay = createReplayFetch(HTTP_DIR);
    const spy: FetchLike = (url, init) => {
      seen.push(url);
      return replay(url, init);
    };
    const r = createResolver({ fetch: spy, now: () => NOW, sleep: async () => {} });
    await r.resolve("10.1086/225469");
    expect(seen.join("\n")).not.toMatch(/mailto/);
  });
});

describe("failures", () => {
  const status =
    (code: number): FetchLike =>
    async () =>
      new Response("", { status: code });

  it("reports not-found when Crossref and doi.org both answer 404", async () => {
    const r = await resolver({}, status(404)).resolve("10.9999/nothing");
    expect(r.status).toBe("not-found");
    expect(r.records).toEqual([]);
  });

  it("returns the registration agency record when OpenAlex is down", async () => {
    const replay = createReplayFetch(HTTP_DIR);
    const flaky: FetchLike = (url, init) =>
      url.includes("openalex.org")
        ? Promise.resolve(new Response("", { status: 500 }))
        : replay(url, init);
    const r = await resolver({}, flaky).resolve("10.1086/225469");
    expect(r.status).toBe("resolved");
    expect(r.fields.title).toBe("The Strength of Weak Ties");
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.source).toBe("openalex");
  });

  it("says which kinds are not resolvable yet", async () => {
    for (const input of ["https://example.org/page", "just some words"]) {
      const r = await resolver({}, status(500)).resolve(input);
      expect(r.status).toBe("unsupported");
      expect(r.errors).toHaveLength(1);
    }
  });

  it("lets user values win over every source", async () => {
    const r = await resolver().resolve("10.1086/225469", {
      user: { title: "My own title", volume: "99" },
    });
    expect(r.fields.title).toBe("My own title");
    expect(r.fields.volume).toBe("99");
    expect(r.fields.page).toBe("1360-1380");
    expect(r.provenance.title).toBe("user@2026-10-23");
  });
});

describe("fixtures hygiene", () => {
  const files = readdirSync(HTTP_DIR).filter((f) => f.endsWith(".json"));

  it("has recorded responses", () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it("contains no request identity and no personal address", () => {
    for (const f of files) {
      const text = readFileSync(join(HTTP_DIR, f), "utf8");
      const rec = JSON.parse(text) as { url: string };
      expect(rec.url, f).not.toMatch(/[?&](mailto|email|api_key)=/);
      expect(text, f).not.toMatch(/jonnyfischer|jhf@|mailto=/i);
    }
  });
});
