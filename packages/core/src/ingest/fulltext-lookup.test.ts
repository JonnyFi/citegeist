import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createResolver,
  type FetchLike,
  mapUnpaywall,
  openAccessPdfLocations,
  type PdfLocation,
} from "@citegeist/metadata";
import { afterEach, describe, expect, it } from "vitest";
import { cleanTmpDirs } from "../test-helpers.js";
import { createTestEnv, makePdf, type TestEnv, testFetch } from "./testing.js";

// The full text lookup against recorded answers (fixtures/fulltext): HICSS 2025, whose open-access
// location is a DSpace 7 repository that answers a viewer address with an HTML application.

const dir = fileURLToPath(new URL("../../../../fixtures/fulltext/", import.meta.url));
const read = (name: string): string => readFileSync(`${dir}${name}`, "utf8");
const json = (name: string): Record<string, unknown> => JSON.parse(read(name));

const DOI = "10.1086/225469";
const UUID = "0f3766c3-5aa4-4ef9-bb6c-37ff2188a131";
const HOST = "https://scholarspace.manoa.hawaii.edu";
const DOWNLOAD = `${HOST}/bitstreams/${UUID}/download`;
const CONTENT = `${HOST}/server/api/core/bitstreams/${UUID}/content`;
const AISEL = "https://aisel.aisnet.org/context/hicss-58/article/1739/viewcontent/download.pdf";

let envs: TestEnv[] = [];
afterEach(async () => {
  for (const e of envs) {
    await e.svc.close();
    await e.lib.close();
  }
  envs = [];
  cleanTmpDirs();
});

type Answer = () => Response;
const html =
  (body: string, status = 200): Answer =>
  () =>
    new Response(body, { status, headers: { "content-type": "text/html" } });
const pdf = (): Answer => () =>
  new Response(makePdf([["Open access PDF"]]), {
    status: 200,
    headers: { "content-type": "application/pdf" },
  });
const status =
  (code: number): Answer =>
  () =>
    new Response("no", { status: code });

interface Setup {
  /** What the web answers, by exact address. Anything else is a 404. */
  web: Record<string, Answer>;
  unpaywall?: PdfLocation[] | undefined;
  openalex?: PdfLocation[] | undefined;
  /** Answer of the doi.org landing page. */
  landing?: Answer;
}

async function lookup(setup: Setup) {
  const requested: string[] = [];
  const base = testFetch();
  const fetch: FetchLike & { log: { urls: string[] } } = Object.assign(
    (async (url: string, init?: RequestInit) => {
      const accept = new Headers(init?.headers).get("accept") ?? "";
      if (new URL(url).hostname.endsWith("doi.org") && accept.startsWith("text/html")) {
        requested.push(url);
        return (setup.landing ?? status(404))();
      }
      const answer = setup.web[url];
      if (answer) {
        requested.push(url);
        return answer();
      }
      if (/^https?:\/\/(arxiv\.org|api\.|doi\.org|www\.nature\.com|example\.org)/.test(url)) {
        return base(url, init);
      }
      requested.push(url);
      return new Response("not found", { status: 404 });
    }) as FetchLike,
    { log: { urls: [] as string[] } },
  );
  const real = createResolver({
    config: { mailto: "tester@example.invalid" },
    fetch: base,
    now: () => Date.parse("2026-10-23T12:00:00Z"),
    sleep: async () => {},
  });
  const resolver = {
    resolve: (...a: Parameters<typeof real.resolve>) => real.resolve(...a),
    resolveByTitle: (...a: Parameters<typeof real.resolveByTitle>) => real.resolveByTitle(...a),
    findOpenAccess: async () => ({ pdfLocations: setup.unpaywall ?? [] }),
    findOpenAlexPdfs: async () => setup.openalex ?? [],
  };
  const e = await createTestEnv({ fetch, deps: { resolver } });
  envs.push(e);
  const out = await e.call<{ citekey: string; job: string }>("items.add", { identifier: DOI });
  await e.svc.queue.waitFor(out.job);
  await e.svc.queue.idle();
  const fm = e.lib.getItem(out.citekey).frontmatter;
  return { fm, requested, tried: fm.fulltext?.tried ?? [], e, citekey: out.citekey };
}

const unpaywallHicss = mapUnpaywall(json("unpaywall-hicss2025.json")).openAccess?.pdfLocations;
const openalexHicss = openAccessPdfLocations(json("openalex-hicss2025.json"));

describe("full text lookup: repository viewer addresses", () => {
  it("fetches the DSpace 7 file from the REST address when /download is an HTML application", async () => {
    const r = await lookup({
      web: { [DOWNLOAD]: html(read("scholarspace-spa.html")), [CONTENT]: pdf() },
      unpaywall: [{ url: DOWNLOAD, version: "publishedVersion", hostType: "repository" }],
      openalex: [{ url: DOWNLOAD, version: "publishedVersion", hostType: "repository" }],
    });
    expect(r.fm.sources).toHaveLength(1);
    expect(r.fm.sources[0]?.url).toBe(CONTENT);
    expect(r.fm.fulltext).toBeUndefined();
    // The rewritten address is the first request; the viewer address is never needed.
    expect(r.requested).toEqual([CONTENT]);
  });

  it("falls back to the original address when the rewritten one fails, and says so", async () => {
    const r = await lookup({
      web: { [CONTENT]: status(404), [DOWNLOAD]: html(read("scholarspace-spa.html")) },
      openalex: [{ url: DOWNLOAD }],
    });
    expect(r.fm.sources).toHaveLength(0);
    expect(r.requested.slice(0, 2)).toEqual([CONTENT, DOWNLOAD]);
    expect(r.tried.filter((t) => t.url && t.source !== "publisher")).toEqual([
      {
        source: "openalex",
        outcome: "none",
        url: CONTENT,
        detail:
          "scholarspace.manoa.hawaii.edu: HTTP 404 (named by openalex; rewritten by dspace7-bitstream)",
      },
      {
        source: "openalex",
        outcome: "none",
        url: DOWNLOAD,
        detail: "scholarspace.manoa.hawaii.edu: html-no-link (named by openalex)",
      },
    ]);
  });
});

describe("full text lookup: HTML instead of a PDF", () => {
  const PAGE = "https://repo.example.org/handle/1/2";

  it("follows the citation_pdf_url of a landing page once", async () => {
    const FILE = "https://repo.example.org/files/vaast-2025.pdf?download=1&v=2";
    const r = await lookup({
      web: { [PAGE]: html(read("landing-citation-pdf.html")), [FILE]: pdf() },
      openalex: [{ url: PAGE }],
    });
    expect(r.fm.sources[0]?.url).toBe(FILE);
    expect(r.requested).toEqual([PAGE, FILE]);
  });

  it("follows an anchor on the same site, not one to a foreign host", async () => {
    const FILE = "https://repo.example.org/bitstream/handle/123/45/paper.pdf?sequence=1";
    const r = await lookup({
      web: { [PAGE]: html(read("landing-anchor-only.html")), [FILE]: pdf() },
      openalex: [{ url: PAGE }],
    });
    expect(r.fm.sources[0]?.url).toBe(FILE);
    expect(r.requested).toEqual([PAGE, FILE]);
  });

  it("does not search the page a link leads to (one level only)", async () => {
    const FILE = "https://repo.example.org/files/vaast-2025.pdf?download=1&v=2";
    const r = await lookup({
      web: {
        [PAGE]: html(read("landing-citation-pdf.html")),
        [FILE]: html(read("landing-citation-pdf.html")),
      },
      openalex: [{ url: PAGE }],
    });
    expect(r.fm.sources).toHaveLength(0);
    expect(r.tried.filter((t) => t.url && t.source !== "publisher").map((t) => t.detail)).toEqual([
      "repo.example.org: html, 1 PDF link(s) found in the page (named by openalex)",
      "repo.example.org: html-no-link (link in the page of repo.example.org)",
    ]);
  });

  it("reads the publisher landing page when no source named a location", async () => {
    const FILE = "https://repo.example.org/files/landing.pdf";
    const r = await lookup({
      web: { [FILE]: pdf() },
      landing: html(`<html><head><meta name="citation_pdf_url" content="${FILE}"></head></html>`),
    });
    expect(r.fm.sources[0]?.url).toBe(FILE);
    expect(r.fm.fulltext).toBeUndefined();
  });
});

describe("full text lookup: blocked locations and the attempt log", () => {
  it("asks the best recorded HICSS location once although both sources name it", async () => {
    const r = await lookup({
      web: { [AISEL]: status(403), [CONTENT]: pdf() },
      unpaywall: unpaywallHicss,
      openalex: openalexHicss,
    });
    expect(r.fm.sources[0]?.url).toBe(CONTENT);
    // OpenAlex marks the conference copy as the publisher's, Unpaywall as a repository: both are
    // the published version, so the order the sources gave decides. The best location comes first.
    expect(r.requested).toEqual([CONTENT]);
  });

  it("goes to the next location when the first is blocked", async () => {
    const r = await lookup({
      web: { [AISEL]: status(403), [CONTENT]: pdf() },
      openalex: [
        { url: AISEL, version: "publishedVersion" },
        { url: DOWNLOAD, version: "acceptedVersion" },
      ],
    });
    expect(r.requested).toEqual([AISEL, CONTENT]);
    expect(r.fm.sources[0]?.url).toBe(CONTENT);
    expect(r.fm.fulltext).toBeUndefined();
  });

  it("logs one entry per address with host, outcome and the source that named it", async () => {
    const r = await lookup({
      web: {
        [AISEL]: status(403),
        [CONTENT]: status(404),
        [DOWNLOAD]: html(read("scholarspace-spa.html")),
      },
      unpaywall: [{ url: DOWNLOAD, version: "publishedVersion" }],
      openalex: [
        { url: DOWNLOAD, version: "publishedVersion" },
        { url: AISEL, version: "acceptedVersion" },
      ],
    });
    expect(r.fm.fulltext?.status).toBe("missing");
    expect(r.tried.filter((t) => t.url && t.source !== "publisher")).toEqual([
      {
        source: "unpaywall",
        outcome: "none",
        url: CONTENT,
        detail:
          "scholarspace.manoa.hawaii.edu: HTTP 404 (named by unpaywall, openalex; rewritten by dspace7-bitstream)",
      },
      {
        source: "unpaywall",
        outcome: "none",
        url: DOWNLOAD,
        detail: "scholarspace.manoa.hawaii.edu: html-no-link (named by unpaywall, openalex)",
      },
      {
        source: "openalex",
        outcome: "none",
        url: AISEL,
        detail: "aisel.aisnet.org: blocked (HTTP 403) (named by openalex)",
      },
    ]);
    // Both sources had locations, so neither reports "no PDF location".
    expect(r.tried.some((t) => t.detail === "no PDF location")).toBe(false);
    expect(r.tried.map((t) => t.source)).toEqual(
      expect.arrayContaining(["unpaywall", "openalex", "arxiv", "publisher"]),
    );
  });

  it("says 'no PDF location' for a source that named none", async () => {
    const r = await lookup({ web: {}, openalex: [{ url: AISEL }] });
    expect(r.tried.find((t) => t.source === "unpaywall")).toEqual({
      source: "unpaywall",
      outcome: "none",
      detail: "no PDF location",
    });
    expect(r.tried.find((t) => t.source === "openalex")?.detail).toBe(
      "aisel.aisnet.org: HTTP 404 (named by openalex)",
    );
  });

  it("tries at most six locations and logs the rest as not tried", async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ url: `https://h${i}.example.org/p.pdf` }));
    const r = await lookup({ web: {}, openalex: many });
    const withUrl = r.tried.filter((t) => t.url?.endsWith("/p.pdf"));
    expect(withUrl).toHaveLength(9);
    expect(r.requested.filter((u) => u.endsWith("/p.pdf"))).toHaveLength(6);
    expect(withUrl.slice(6).every((t) => t.detail?.includes("not tried, limit of 6"))).toBe(true);
  });
});

describe("full text lookup: retry for an item that has none", () => {
  it("items.add with the citekey and the DOI runs the lookup again", async () => {
    const web: Record<string, Answer> = { [CONTENT]: status(404) };
    const r = await lookup({ web, openalex: [{ url: DOWNLOAD }] });
    expect(r.fm.fulltext?.status).toBe("missing");
    web[CONTENT] = pdf();
    const again = await r.e.call<{ job: string }>("items.add", {
      identifier: DOI,
      citekey: r.citekey,
    });
    await r.e.svc.queue.waitFor(again.job);
    await r.e.svc.queue.idle();
    const fm = r.e.lib.getItem(r.citekey).frontmatter;
    expect(fm.sources[0]?.url).toBe(CONTENT);
    expect(fm.fulltext).toBeUndefined();
  });
});
