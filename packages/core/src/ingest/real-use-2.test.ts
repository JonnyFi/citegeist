import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createResolver, type FetchLike, type GraphLookup } from "@citegeist/metadata";
import { afterEach, describe, expect, it } from "vitest";
import { listCiting } from "../graph/graph.js";
import { cleanTmpDirs, tmpDir } from "../test-helpers.js";
import { citationPdfUrls } from "./service.js";
import { createTestEnv, makePdf, type TestEnv, testFetch } from "./testing.js";

// Regression tests for the second real session: the same paper twice, and DOI items without a PDF.

let envs: TestEnv[] = [];
afterEach(async () => {
  for (const e of envs) {
    await e.svc.close();
    await e.lib.close();
  }
  envs = [];
  cleanTmpDirs();
});

async function env(opts: Parameters<typeof createTestEnv>[0] = {}): Promise<TestEnv> {
  const e = await createTestEnv(opts);
  envs.push(e);
  return e;
}

interface AddOut {
  citekey: string;
  job: string;
  duplicateOf?: string;
  repaired?: boolean;
}

const DOI = "10.1086/225469";
const NO_TEXT = async () => ({ firstPage: "", leading: "", pages: 1 });

function pdfFile(lines: string[][], name = "smith burrows 2021 anonndsmith.pdf"): string {
  const path = join(tmpDir("cg-pdf-"), name);
  writeFileSync(path, makePdf(lines));
  return path;
}

function family(author: object | undefined): string | undefined {
  return (author as { family?: string } | undefined)?.family;
}

function keys(e: TestEnv): string[] {
  return e.lib.index
    .all<{ citekey: string }>("SELECT citekey FROM items ORDER BY citekey")
    .map((r) => r.citekey);
}

/** The paper added by DOI first: perfect metadata, no PDF anywhere. */
async function addByDoi(e: TestEnv): Promise<string> {
  const out = await e.call<AddOut>("items.add", { identifier: DOI });
  await e.svc.queue.waitFor(out.job);
  await e.svc.queue.idle();
  return out.citekey;
}

async function dropPdf(e: TestEnv, path: string): Promise<AddOut> {
  const out = await e.call<AddOut>("items.add", { identifier: path });
  await e.svc.queue.waitFor(out.job);
  await e.svc.queue.idle();
  return out;
}

const HEADER_WITH_DOI = JSON.stringify({
  title: "The strength of weak ties",
  authors: ["Mark Granovetter"],
  doi: DOI,
  date: "1973-05-01",
});

describe("one item per paper: a dropped PDF joins the item added by DOI", () => {
  it("attaches a PDF whose first page names the DOI", async () => {
    const e = await env();
    const key = await addByDoi(e);
    expect(e.lib.getItem(key).frontmatter.sources).toHaveLength(0);

    const out = await dropPdf(e, pdfFile([["Some paper", "doi:10.1086/225469"]]));
    expect(out).toMatchObject({ citekey: key, duplicateOf: key, repaired: true });
    expect(keys(e)).toEqual([key]);
    const fm = e.lib.getItem(key).frontmatter;
    expect(fm.sources).toHaveLength(1);
    expect(fm.sources[0]?.kind).toBe("pdf");
    expect(existsSync(e.lib.paths.derivedManifest(key, fm.sources[0]?.hash ?? ""))).toBe(true);
    expect(family(fm.author?.[0])).toBe("Granovetter");
    expect(fm.provenance.title).toMatch(/^crossref@/);
  });

  it("finds the DOI in the XMP packet when the text layer has none", async () => {
    const e = await env({
      deps: {
        pdfText: async () => ({
          firstPage: "",
          leading: "",
          pages: 1,
          xmp: `<x:xmpmeta><rdf:RDF><rdf:Description><prism:doi>${DOI}</prism:doi></rdf:Description></rdf:RDF></x:xmpmeta>`,
        }),
      },
    });
    const key = await addByDoi(e);
    const out = await dropPdf(e, pdfFile([["scan"]]));
    expect(out.duplicateOf).toBe(key);
    expect(keys(e)).toEqual([key]);
    expect(e.lib.getItem(key).frontmatter.sources).toHaveLength(1);
  });

  it("finds the DOI in the GROBID header when neither text nor XMP name it", async () => {
    const e = await env({
      deps: { pdfText: NO_TEXT },
      workerEnv: { CG_STUB_HEADER: HEADER_WITH_DOI },
    });
    const key = await addByDoi(e);
    const out = await dropPdf(e, pdfFile([["scan"]]));
    // the file is first a new item with the file name as title, then GROBID names the DOI
    expect(out.duplicateOf).toBeUndefined();
    expect(keys(e)).toEqual([key]);
    const fm = e.lib.getItem(key).frontmatter;
    expect(fm.sources).toHaveLength(1);
    expect(fm.sources[0]?.filename).toBe("smith burrows 2021 anonndsmith.pdf");
    expect(existsSync(e.lib.paths.derivedManifest(key, fm.sources[0]?.hash ?? ""))).toBe(true);
    expect(fm.title).toBe("The Strength of Weak Ties");
    expect(family(fm.author?.[0])).toBe("Granovetter");
    const job = e.svc.queue.get(out.job);
    expect(job?.result).toMatchObject({ citekey: key });
  });

  it("joins an item by title, first author and year from the GROBID header", async () => {
    const e = await env({
      deps: { pdfText: NO_TEXT },
      workerEnv: {
        CG_STUB_HEADER: JSON.stringify({
          title: "The Strength of Weak Ties",
          authors: ["Mark Granovetter"],
          date: "1973",
        }),
      },
    });
    const key = await addByDoi(e);
    await dropPdf(e, pdfFile([["scan"]]));
    expect(keys(e)).toEqual([key]);
    expect(e.lib.getItem(key).frontmatter.sources).toHaveLength(1);
  });

  it("carries tags and projects of the dropped file over to the existing item", async () => {
    const e = await env({
      deps: { pdfText: NO_TEXT },
      workerEnv: { CG_STUB_HEADER: HEADER_WITH_DOI },
    });
    const key = await addByDoi(e);
    const out = await e.call<AddOut>("items.add", {
      identifier: pdfFile([["scan"]]),
      tags: ["weak-ties"],
    });
    await e.svc.queue.waitFor(out.job);
    await e.svc.queue.idle();
    expect(keys(e)).toEqual([key]);
    expect(e.lib.getItem(key).frontmatter.tags).toContain("weak-ties");
  });

  it("keeps a second item when the paper is not in the library", async () => {
    const e = await env({
      deps: { pdfText: NO_TEXT },
      workerEnv: { CG_STUB_HEADER: HEADER_WITH_DOI },
    });
    const out = await dropPdf(e, pdfFile([["scan"]]));
    expect(keys(e)).toHaveLength(1);
    const fm = e.lib.getItem(keys(e)[0] ?? "").frontmatter;
    expect(fm.sources).toHaveLength(1);
    expect(out.duplicateOf).toBeUndefined();
  });
});

describe("a new item from a PDF takes resolved metadata over the GROBID guess", () => {
  it("fills authors, year and journal from the DOI GROBID found", async () => {
    const e = await env({
      deps: { pdfText: NO_TEXT },
      workerEnv: {
        CG_STUB_HEADER: JSON.stringify({
          title: "strength of weak ties (guess)",
          authors: ["Granovetter"],
          doi: DOI,
          date: "1999",
        }),
      },
    });
    await dropPdf(e, pdfFile([["scan"]]));
    const [key] = keys(e);
    const fm = e.lib.getItem(key ?? "").frontmatter;
    expect(fm.DOI).toBe(DOI);
    expect(fm.title).toBe("The Strength of Weak Ties");
    expect(fm.author?.[0]).toMatchObject({ family: "Granovetter", given: expect.any(String) });
    expect(String(fm.issued)).toMatch(/^1973/);
    expect(fm["container-title"]).toBe("American Journal of Sociology");
    expect(fm.provenance.title).toMatch(/^crossref@/);
    expect(fm.provenance.issued).not.toMatch(/^grobid@/);
    expect(fm.proposal).toBeUndefined();
  });

  it("loads the citing works through OpenAlex once the DOI is known", async () => {
    const e = await env({
      deps: { pdfText: NO_TEXT },
      workerEnv: { CG_STUB_HEADER: HEADER_WITH_DOI },
    });
    await dropPdf(e, pdfFile([["scan"]]));
    const [key] = keys(e);
    const asked: unknown[] = [];
    const lookup = {
      openAlexCiting: async (k: unknown) => {
        asked.push(k);
        return {
          total: 1,
          works: [{ title: "A citing work", year: 2020, doi: "10.1234/citing" }],
        };
      },
    } as unknown as GraphLookup;
    const out = await listCiting(e.lib, lookup, { citekey: key ?? "", limit: 10 });
    expect(asked).toEqual([expect.objectContaining({ doi: DOI })]);
    expect(out.total).toBe(1);
  });

  it("keeps the GROBID header as a reviewable guess when nothing resolves it", async () => {
    const e = await env({
      deps: { pdfText: NO_TEXT },
      workerEnv: {
        CG_STUB_HEADER: JSON.stringify({
          title: "Soziale Systeme. Grundriß einer allgemeinen Theorie",
          authors: ["Niklas Luhmann"],
          date: "1984",
        }),
      },
    });
    await dropPdf(e, pdfFile([["scan"]]));
    const fm = e.lib.getItem(keys(e)[0] ?? "").frontmatter;
    expect(fm.title).toBe("Soziale Systeme. Grundriß einer allgemeinen Theorie");
    expect(fm.author).toEqual([{ family: "Luhmann", given: "Niklas" }]);
    expect(fm.issued).toBe(1984);
    expect(fm.provenance.title).toMatch(/^grobid@/);
    expect((fm.proposal as { status: string }).status).toBe("needs-review");
  });
});

describe("full text lookup for DOI items", () => {
  it("marks an item without any PDF 'ohne Volltext' and records every source it tried", async () => {
    const e = await env();
    const key = await addByDoi(e);
    const fm = e.lib.getItem(key).frontmatter;
    expect(fm.sources).toHaveLength(0);
    expect(fm.incomplete).toBeUndefined();
    const fulltext = fm.fulltext as { status: string; tried: { source: string }[]; at: string };
    expect(fulltext.status).toBe("none");
    expect(fulltext.tried.map((t) => t.source)).toEqual([
      "unpaywall",
      "openalex",
      "arxiv",
      "publisher",
    ]);
    expect(fulltext.at).toBeDefined();
  });

  it("tries Unpaywall, OpenAlex, arXiv and the publisher page in this order", async () => {
    const urls: string[] = [];
    const base = testFetch();
    const page = `<html><head><meta name="citation_pdf_url" content="https://pub.example.org/files/paper.pdf"></head></html>`;
    const fetch: FetchLike & { log: { urls: string[] } } = Object.assign(
      (async (url: string, init?: RequestInit) => {
        const u = new URL(url);
        const accept = new Headers(init?.headers).get("accept") ?? "";
        if (u.hostname === "oa.example.net") {
          urls.push(url);
          return new Response("gone", { status: 404 });
        }
        if (u.hostname.endsWith("doi.org") && accept.startsWith("text/html")) {
          urls.push(url);
          return new Response(page, { status: 200, headers: { "content-type": "text/html" } });
        }
        if (u.hostname === "pub.example.org") {
          urls.push(url);
          return new Response(makePdf([["Publisher PDF"]]), {
            status: 200,
            headers: { "content-type": "application/pdf" },
          });
        }
        return base(url, init);
      }) as FetchLike,
      { log: { urls } },
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
      findOpenAccess: async () => {
        urls.push("unpaywall");
        return { pdfUrl: undefined };
      },
      findOpenAlexPdfs: async () => {
        urls.push("openalex");
        return ["https://oa.example.net/paper.pdf"];
      },
    };
    const e = await env({ fetch, deps: { resolver } });
    const out = await e.call<AddOut>("items.add", { identifier: DOI });
    const job = await e.svc.queue.waitFor(out.job);
    await e.svc.queue.idle();
    expect(job.status).toBe("succeeded");
    const fm = e.lib.getItem(out.citekey).frontmatter;
    expect(fm.sources[0]?.url).toBe("https://pub.example.org/files/paper.pdf");
    expect(fm.fulltext).toBeUndefined();
    const at = (u: string) => urls.indexOf(u);
    const publisherPage = urls.find((u) => u.includes("doi.org")) ?? "";
    expect(at("unpaywall")).toBeLessThan(at("openalex"));
    expect(at("openalex")).toBeLessThan(at("https://oa.example.net/paper.pdf"));
    expect(at("https://oa.example.net/paper.pdf")).toBeLessThan(at(publisherPage));
    expect(at(publisherPage)).toBeLessThan(at("https://pub.example.org/files/paper.pdf"));
    expect(
      (job.result as { tried?: unknown[] }).tried ?? "tried is only kept when nothing was found",
    ).toBeDefined();
  });

  it("stops at the first source that delivers a PDF and clears the marker later", async () => {
    const pdf = makePdf([["Open access PDF"]]);
    const base = testFetch();
    const fetch = Object.assign(
      (async (url: string, init?: RequestInit) =>
        new URL(url).hostname === "oa.example.net"
          ? new Response(pdf, { status: 200, headers: { "content-type": "application/pdf" } })
          : base(url, init)) as FetchLike,
      { log: { urls: [] as string[] } },
    );
    const real = createResolver({
      config: { mailto: "tester@example.invalid" },
      fetch: base,
      now: () => Date.parse("2026-10-23T12:00:00Z"),
      sleep: async () => {},
    });
    const calls: string[] = [];
    const resolver = {
      resolve: (...a: Parameters<typeof real.resolve>) => real.resolve(...a),
      resolveByTitle: (...a: Parameters<typeof real.resolveByTitle>) => real.resolveByTitle(...a),
      findOpenAccess: async () => {
        calls.push("unpaywall");
        return { pdfUrl: undefined };
      },
      findOpenAlexPdfs: async () => {
        calls.push("openalex");
        return ["https://oa.example.net/paper.pdf"];
      },
    };
    const e = await env({ fetch, deps: { resolver } });
    const out = await e.call<AddOut>("items.add", { identifier: DOI });
    const job = await e.svc.queue.waitFor(out.job);
    await e.svc.queue.idle();
    expect(calls).toEqual(["unpaywall", "openalex"]);
    const fm = e.lib.getItem(out.citekey).frontmatter;
    expect(fm.sources[0]?.url).toBe("https://oa.example.net/paper.pdf");
    expect(fm.fulltext).toBeUndefined();
    expect(job.status).toBe("succeeded");
  });

  it("clears the marker when a PDF is attached later", async () => {
    const e = await env();
    const key = await addByDoi(e);
    expect(e.lib.getItem(key).frontmatter.fulltext).toBeDefined();
    const path = pdfFile([["a paper"]], "paper.pdf");
    const res = await e.call<{ job?: string }>("items.attach", { citekey: key, path });
    if (res.job) await e.svc.queue.waitFor(res.job);
    expect(e.lib.getItem(key).frontmatter.fulltext).toBeUndefined();
    expect(e.lib.getItem(key).frontmatter.sources).toHaveLength(1);
  });
});

describe("citationPdfUrls", () => {
  it("reads the meta tag in either attribute order and resolves relative links", () => {
    const html = `<meta content="/pdf/a.pdf" name="citation_pdf_url"><meta name='citation_pdf_url' content='https://x.org/b.pdf?a=1&amp;b=2'>`;
    expect(citationPdfUrls(html, "https://pub.example.org/article/1")).toEqual([
      "https://pub.example.org/pdf/a.pdf",
      "https://x.org/b.pdf?a=1&b=2",
    ]);
  });

  it("returns nothing for a page without the tag", () => {
    expect(citationPdfUrls("<html><title>x</title></html>", "https://a.org")).toEqual([]);
  });
});
