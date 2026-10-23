import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ItemFrontmatter, Job } from "@citegeist/schema";
import { Block, DerivedManifest, Pages } from "@citegeist/schema";
import { afterEach, describe, expect, it } from "vitest";
import { cleanTmpDirs, tmpDir } from "../test-helpers.js";
import { createTestEnv, makePdf, type TestEnv, testFetch } from "./testing.js";

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
}

async function add(
  e: TestEnv,
  identifier: string,
  extra: Record<string, unknown> = {},
  actor = "human",
) {
  const out = await e.call<AddOut>("items.add", { identifier, ...extra }, actor as never);
  const job = await e.svc.queue.waitFor(out.job);
  return { ...out, jobState: job };
}

function pdfFile(lines: string[][]): string {
  const path = join(tmpDir("cg-pdf-"), "paper.pdf");
  writeFileSync(path, makePdf(lines));
  return path;
}

function item(e: TestEnv, citekey: string): ItemFrontmatter {
  return e.lib.getItem(citekey).frontmatter;
}

/** Everything the pipeline promises for a converted source. */
function expectConverted(e: TestEnv, citekey: string, hash: string): void {
  const dir = e.lib.paths.derivedDir(citekey, hash);
  for (const f of [
    "manifest.json",
    "blocks.jsonl",
    "doc.md",
    "idmap.json",
    "refs.jsonl",
    "doc.html",
  ]) {
    expect(existsSync(join(dir, f)), f).toBe(true);
  }
  expect(
    DerivedManifest.safeParse(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"))).success,
  ).toBe(true);
  for (const line of readFileSync(join(dir, "blocks.jsonl"), "utf8").trim().split("\n")) {
    expect(Block.safeParse(JSON.parse(line)).success).toBe(true);
  }
  expect(readdirSync(join(dir, "..")).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  const indexed = e.lib.index.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM blocks WHERE citekey = ? AND source = ?",
    citekey,
    hash,
  );
  expect(indexed?.n).toBe(9);
}

describe("items.add by DOI", () => {
  it("creates a complete item folder with the open-access PDF converted", async () => {
    const e = await env();
    const out = await add(e, "10.1038/s41586-020-2649-2");
    expect(out.duplicateOf).toBeUndefined();
    expect(out.citekey).toBe("harris2020array");
    expect(out.jobState.status).toBe("succeeded");

    const fm = item(e, out.citekey);
    expect(fm.title).toBe("Array programming with NumPy");
    expect(fm.type).toBe("article-journal");
    expect(fm.DOI).toBe("10.1038/s41586-020-2649-2");
    expect(fm.inbox).toBeUndefined();
    expect(fm.created.by).toBe("human");
    expect(fm.provenance.title).toMatch(/^crossref@/);
    expect(fm.ids.openalex).toBeDefined();
    expect(fm.sources).toHaveLength(1);
    const source = fm.sources[0];
    expect(source?.kind).toBe("pdf");
    expect(source?.pages).toBe(3);
    expect(source?.url).toBe("https://www.nature.com/articles/s41586-020-2649-2.pdf");
    expect(existsSync(e.lib.paths.sourceFile(out.citekey, source?.hash ?? "", "pdf"))).toBe(true);
    expectConverted(e, out.citekey, source?.hash ?? "");

    const pages = Pages.parse(
      JSON.parse(readFileSync(e.lib.paths.pages(out.citekey, source?.hash ?? ""), "utf8")),
    );
    expect(pages.pages.map((p) => p.label)).toEqual(["10", "11", "12"]);
    expect(e.lib.status().problems).toEqual([]);

    const job = await e.call<Job>("jobs.get", { job: out.job });
    expect(job.kind).toBe("ingest");
    expect(job.status).toBe("succeeded");
    const children = e.svc.queue.children(out.job);
    expect(children.map((c) => c.kind)).toEqual(["convert"]);
    expect(children[0]?.status).toBe("succeeded");
    const listed = await e.call<{ jobs: Job[] }>("jobs.list", { status: "succeeded" });
    expect(listed.jobs.map((j) => j.id)).toContain(out.job);
  });
});

describe("items.add by arXiv id", () => {
  it("fetches arXiv HTML and PDF and converts both", async () => {
    const e = await env();
    const out = await add(e, "arXiv:1706.03762");
    expect(out.citekey).toBe("vaswani2017attention");
    expect(out.jobState.status).toBe("succeeded");
    const fm = item(e, out.citekey);
    expect(fm.title).toBe("Attention Is All You Need");
    expect(fm.ids.arxiv).toBe("1706.03762");
    expect(fm.sources.map((s) => s.kind).sort()).toEqual(["arxiv-html", "pdf"]);
    for (const s of fm.sources) expectConverted(e, out.citekey, s.hash);
    const html = fm.sources.find((s) => s.kind === "arxiv-html");
    const manifest = DerivedManifest.parse(
      JSON.parse(readFileSync(e.lib.paths.derivedManifest(out.citekey, html?.hash ?? ""), "utf8")),
    );
    expect(manifest.path).toBe("arxiv");
    expect(e.fetch.log.urls).toEqual([
      "https://arxiv.org/html/1706.03762",
      "https://arxiv.org/pdf/1706.03762",
    ]);
  });
});

describe("items.add by local PDF", () => {
  it("reads the DOI from the first pages and resolves it", async () => {
    const e = await env();
    const path = pdfFile([
      [
        "Array programming with NumPy",
        "Charles R. Harris et al.",
        "https://doi.org/10.1038/s41586-020-2649-2",
      ],
    ]);
    const out = await add(e, path);
    expect(out.citekey).toBe("harris2020array");
    const fm = item(e, out.citekey);
    expect(fm.DOI).toBe("10.1038/s41586-020-2649-2");
    expect(fm.proposal).toBeUndefined();
    expect(fm.sources).toHaveLength(1);
    expect(fm.sources[0]?.filename).toBe("paper.pdf");
    expect(fm.sources[0]?.url).toBeUndefined();
    // the local file is the source, the open-access copy is not fetched in addition
    expect(e.fetch.log.urls).toEqual([]);
    expect(out.jobState.status).toBe("succeeded");
    expectConverted(e, out.citekey, fm.sources[0]?.hash ?? "");
  });

  it("matches a PDF without identifier by its title", async () => {
    const e = await env();
    const path = pdfFile([
      ["The Strength of Weak Ties", "Granovetter", "American Journal of Sociology 78 (6)", "1973"],
    ]);
    const out = await add(e, path);
    const fm = item(e, out.citekey);
    expect(fm.title).toBe("The Strength of Weak Ties");
    expect(fm.DOI).toBe("10.1086/225469");
    expect(fm.type).toBe("article-journal");
    expect(fm.proposal).toBeUndefined();
    expect(out.citekey).toBe("granovetter1973strength");
    expectConverted(e, out.citekey, fm.sources[0]?.hash ?? "");
  });

  it("asks for review when the page does not say what kind of work it is", async () => {
    const e = await env();
    const out = await add(e, pdfFile([["The Strength of Weak Ties", "Granovetter", "1973"]]));
    const fm = item(e, out.citekey);
    expect(fm.DOI).toBeUndefined();
    const proposal = fm.proposal as { reason: string; candidates: { DOI: string | null }[] };
    expect(proposal.reason).toContain("review");
    expect(proposal.candidates[0]?.DOI).toBe("10.1086/225469");
  });

  it("keeps a proposal flag when the title match is not confident", async () => {
    const e = await env();
    const path = pdfFile([
      ["Soziale Systeme. Grundriß einer allgemeinen Theorie", "Niklas Luhmann", "1984"],
    ]);
    const out = await add(e, path);
    const fm = item(e, out.citekey);
    expect(fm.title).toBe("Soziale Systeme. Grundriß einer allgemeinen Theorie");
    expect(fm.author).toEqual([{ family: "Luhmann", given: "Niklas" }]);
    expect(fm.issued).toBe(1984);
    expect(fm.DOI).toBeUndefined();
    expect(fm.provenance.title).toMatch(/^pdf-text@/);
    const proposal = fm.proposal as { status: string; reason: string; candidates: unknown[] };
    expect(proposal.status).toBe("needs-review");
    expect(proposal.reason).toContain("reject");
    expect(out.citekey).toBe("luhmann1984soziale");
    expect(fm.sources).toHaveLength(1);
    expect(out.jobState.status).toBe("succeeded");
  });

  it("uses the file name when the PDF has no readable text", async () => {
    const e = await env();
    const dir = tmpDir("cg-pdf-");
    const path = join(dir, "scan_of_something.pdf");
    writeFileSync(path, "%PDF-1.4\nnot really a pdf\n");
    const out = await add(e, path);
    const fm = item(e, out.citekey);
    expect(fm.title).toBe("scan of something");
    expect((fm.proposal as { reason: string }).reason).toContain("no text layer");
  });
});

describe("other inputs", () => {
  it("adds a book by ISBN without a source file", async () => {
    const e = await env();
    const out = await add(e, "ISBN 978-3-518-28266-3");
    expect(out.citekey).toBe("luhmann1987soziale");
    const fm = item(e, out.citekey);
    expect(fm.ISBN).toBe("9783518282663");
    expect(fm.sources).toEqual([]);
    expect(out.jobState.status).toBe("succeeded");
    expect((out.jobState.result as { sources: number }).sources).toBe(0);
  });

  it("adds a BibTeX entry and keeps its key", async () => {
    const e = await env();
    const out = await add(
      e,
      "@book{luhmann_gesellschaft, title={Die Gesellschaft der Gesellschaft}, author={Luhmann, Niklas}, year={1997}, publisher={Suhrkamp}}",
    );
    expect(out.citekey).toBe("luhmann_gesellschaft");
    const fm = item(e, out.citekey);
    expect(fm.title).toBe("Die Gesellschaft der Gesellschaft");
    expect(fm.provenance.title).toMatch(/^bibtex@/);
  });

  it("adds a web page from a URL", async () => {
    const e = await env();
    const out = await add(e, "https://example.org/essay");
    const fm = item(e, out.citekey);
    expect(fm.type).toBe("webpage");
    expect(fm.title).toBe("An Example Page");
    expect(fm.URL).toBe("https://example.org/essay");
    expect(fm.sources[0]?.kind).toBe("web");
    expectConverted(e, out.citekey, fm.sources[0]?.hash ?? "");
  });

  it("says what to do for identifiers it cannot resolve", async () => {
    const e = await env();
    await expect(
      e.call("items.add", { identifier: "not an identifier at all" }),
    ).rejects.toMatchObject({
      detail: { code: "INVALID_IDENTIFIER" },
    });
    await expect(e.call("items.add", { identifier: "PMID: 16204405" })).rejects.toMatchObject({
      detail: { code: "IDENTIFIER_UNSUPPORTED" },
    });
    await expect(
      e.call("items.add", { identifier: "/nonexistent/file.pdf" }),
    ).rejects.toMatchObject({
      detail: { code: "FILE_NOT_FOUND" },
    });
  });
});

describe("D7: inbox and library", () => {
  it("lands an agent add in the inbox with its origin", async () => {
    const e = await env();
    const out = await add(e, "10.1086/225469", { why: "cited by the Grok thread" }, "agent:grok");
    const fm = item(e, out.citekey);
    expect(fm.inbox).toEqual({ by: "agent:grok", why: "cited by the Grok thread", job: out.job });
    expect(fm.created.by).toBe("agent:grok");
    expect(e.lib.listItems({ inbox: true, limit: 10 }).items.map((i) => i.citekey)).toEqual([
      out.citekey,
    ]);
  });

  it("skips the inbox for an agent with target library", async () => {
    const e = await env();
    const out = await add(e, "10.1086/225469", { target: "library" }, "agent:grok");
    expect(item(e, out.citekey).inbox).toBeUndefined();
    expect(e.lib.listItems({ inbox: true, limit: 10 }).items).toEqual([]);
  });

  it("lands a human add in the library even with the default target", async () => {
    const e = await env();
    const out = await add(e, "10.1086/225469", { target: "inbox" }, "human");
    expect(item(e, out.citekey).inbox).toBeUndefined();
  });

  it("accepts and rejects inbox items", async () => {
    const e = await env();
    const a = await add(e, "10.1086/225469", {}, "agent:grok");
    const b = await add(e, "ISBN 978-3-518-28266-3", {}, "agent:grok");
    await e.call("inbox.accept", { citekeys: [a.citekey] });
    expect(item(e, a.citekey).inbox).toBeUndefined();
    expect(item(e, a.citekey).modified?.by).toBe("human");
    await e.call("inbox.reject", { citekeys: [b.citekey] });
    expect(() => e.lib.getItem(b.citekey)).toThrow();
    expect(existsSync(join(e.root, ".trash"))).toBe(true);
    expect(readdirSync(join(e.root, ".trash"))[0]).toMatch(new RegExp(`^${b.citekey}-`));
    await expect(e.call("inbox.reject", { citekeys: [a.citekey] })).rejects.toMatchObject({
      detail: { code: "NOT_IN_INBOX" },
    });
  });
});

describe("duplicates", () => {
  it("returns duplicateOf for the same DOI in any notation, without new work", async () => {
    const e = await env();
    const first = await add(e, "10.1086/225469");
    const again = await e.call<AddOut>("items.add", {
      identifier: "https://doi.org/10.1086/225469",
    });
    expect(again.duplicateOf).toBe(first.citekey);
    expect(again.citekey).toBe(first.citekey);
    const job = await e.call<Job>("jobs.get", { job: again.job });
    expect(job.status).toBe("succeeded");
    expect(e.lib.listItems({ limit: 10 }).items).toHaveLength(1);
  });

  it("detects the same arXiv paper through its id", async () => {
    const e = await env();
    const first = await add(e, "arXiv:1706.03762");
    const again = await e.call<AddOut>("items.add", {
      identifier: "https://arxiv.org/abs/1706.03762v5",
    });
    expect(again.duplicateOf).toBe(first.citekey);
  });

  it("detects the same ISBN and the same file", async () => {
    const e = await env();
    const book = await add(e, "9783518282663");
    expect(
      (await e.call<AddOut>("items.add", { identifier: "ISBN 978-3-518-28266-3" })).duplicateOf,
    ).toBe(book.citekey);
    const path = pdfFile([["The Strength of Weak Ties", "Granovetter", "1973"]]);
    const paper = await add(e, path);
    const again = await e.call<AddOut>("items.add", { identifier: path });
    expect(again.duplicateOf).toBe(paper.citekey);
  });

  it("detects the same title, year and first author without any identifier", async () => {
    const e = await env();
    const first = await add(
      e,
      "@book{a, title={Soziale Systeme}, author={Luhmann, Niklas}, year={1984}}",
    );
    const other = await e.call<AddOut>("items.add", {
      identifier:
        "@book{b, title={Soziale  Systeme}, author={Niklas Luhmann}, year={1984}, publisher={Suhrkamp}}",
    });
    expect(other.duplicateOf).toBe(first.citekey);
    const different = await e.call<AddOut>("items.add", {
      identifier: "@book{c, title={Soziale Systeme}, author={Luhmann, Niklas}, year={1985}}",
    });
    expect(different.duplicateOf).toBeUndefined();
  });

  it("moves an inbox item into the library when a human adds it again", async () => {
    const e = await env();
    const queued = await add(e, "10.1086/225469", {}, "agent:grok");
    expect(item(e, queued.citekey).inbox).toBeDefined();
    const again = await e.call<AddOut>("items.add", { identifier: "10.1086/225469" });
    expect(again.duplicateOf).toBe(queued.citekey);
    expect(item(e, queued.citekey).inbox).toBeUndefined();
  });

  it("gives a second item with the same author and year a new citekey", async () => {
    const e = await env();
    const a = await add(
      e,
      "@article{x1, title={Weak Ties Revisited}, author={Granovetter, Mark}, year={1973}}",
    );
    const b = await add(
      e,
      "@article{x2, title={Weak Ties Again}, author={Granovetter, Mark}, year={1973}}",
    );
    expect([a.citekey, b.citekey]).toEqual(["x1", "x2"]);
    const c = await add(
      e,
      "@article{, title={Weak Ties Once More}, author={Granovetter, Mark}, year={1973}}",
    );
    const d = await add(
      e,
      "@article{, title={Weak Ties Thrice}, author={Granovetter, Mark}, year={1973}}",
    );
    expect(c.citekey).toBe("granovetter1973weak");
    expect(d.citekey).toBe("granovetter1973weaka");
  });
});

describe("retries", () => {
  it("retries the conversion after the worker crashed once", async () => {
    const crash = join(tmpDir("cg-crash-"), "crashed");
    const e = await env({ workerEnv: { CG_STUB_CRASH_ONCE: crash } });
    const out = await add(e, "10.1038/s41586-020-2649-2");
    expect(existsSync(crash)).toBe(true);
    expect(out.jobState.status).toBe("succeeded");
    const convert = e.svc.queue.children(out.job)[0];
    expect(convert?.status).toBe("succeeded");
    expect(convert?.attempts).toBe(2);
    expectConverted(e, out.citekey, item(e, out.citekey).sources[0]?.hash ?? "");
  });

  it("retries a failed download and adds each source once", async () => {
    const base = testFetch();
    let failures = 0;
    const flaky = Object.assign(
      async (url: string, init?: RequestInit) => {
        if (url === "https://arxiv.org/pdf/1706.03762" && failures < 2) {
          failures++;
          return new Response("", { status: 503 });
        }
        return base(url, init);
      },
      { log: base.log },
    );
    const e = await env({ fetch: flaky });
    const out = await add(e, "arXiv:1706.03762");
    expect(failures).toBe(2);
    expect(out.jobState.status).toBe("succeeded");
    expect(out.jobState.attempts).toBe(3);
    const fm = item(e, out.citekey);
    expect(fm.sources.map((s) => s.kind).sort()).toEqual(["arxiv-html", "pdf"]);
  });

  it("fails permanently when the worker rejects the file, and keeps the item", async () => {
    const e = await env({ workerEnv: { CG_STUB_FAIL: "1" } });
    const path = pdfFile([["The Strength of Weak Ties", "Granovetter", "1973"]]);
    const out = await add(e, path);
    expect(out.jobState.status).toBe("failed");
    expect(out.jobState.error?.code).toBe("CONVERT_FAILED");
    expect(out.jobState.attempts).toBe(1);
    expect(item(e, out.citekey).sources).toHaveLength(1);
    // the item can be converted again once the cause is fixed
    const retry = await e.call<{ job: string }>("documents.convert", {
      citekey: out.citekey,
      force: true,
    });
    expect((await e.svc.queue.waitFor(retry.job)).status).toBe("failed");
  });
});
