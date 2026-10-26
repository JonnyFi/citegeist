import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FetchLike } from "@citegeist/metadata";
import { CitegeistError } from "@citegeist/schema";
import { afterEach, describe, expect, it } from "vitest";
import { cleanTmpDirs, tmpDir } from "../test-helpers.js";
import { createTestEnv, makePdf, type RemoteLog, type TestEnv, testFetch } from "./testing.js";
import { type ConvertWorker, createStubWorker } from "./worker.js";

// Regression tests for the first real chat session (issues #34, #35, #36).

let envs: TestEnv[] = [];
afterEach(async () => {
  for (const e of envs) {
    await e.svc.close();
    await e.lib.close();
  }
  envs = [];
  cleanTmpDirs();
});

const WALL_HTML = readFileSync(
  new URL("../../../../fixtures/web/demos.co.uk_aloneagain.pdf.html", import.meta.url),
  "utf8",
);
const URL_PDF = "https://demos.co.uk/wp-content/uploads/files/aloneagain.pdf";

/** First page of Bauman's "Alone Again" as the PDF text layer gives it. */
const BAUMAN = [["Alone Again", "Ethics After Certainty", "Zygmunt Bauman", "DEMOS 2005"]];

interface Seen {
  url: string;
  headers: Record<string, string>;
  redirect?: string;
}

/** The test network plus fixed answers for some URLs. Remembers how each request was made. */
function network(
  routes: Record<string, () => Response>,
): FetchLike & { log: RemoteLog; seen: Seen[] } {
  const base = testFetch();
  const seen: Seen[] = [];
  const fn: FetchLike = async (url, init) => {
    const route = routes[url];
    if (route) {
      seen.push({
        url,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        ...(init?.redirect ? { redirect: init.redirect } : {}),
      });
      return route();
    }
    return base(url, init);
  };
  return Object.assign(fn, { log: base.log, seen });
}

/** A worker that fails its first `failures` conversions, then works like the stub. */
function flakyWorker(failures: number): ConvertWorker {
  const real = createStubWorker();
  let left = failures;
  return {
    convert: async (params, opts) => {
      if (left > 0) {
        left--;
        throw new CitegeistError({
          code: "CONVERT_FAILED",
          message: "WEB_NO_CONTENT: no article text found",
          fix: "none",
          recovery: "fix-and-retry",
        });
      }
      return real.convert(params, opts);
    },
    health: () => real.health(),
    close: () => real.close(),
  };
}

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

function pdfFile(name: string, pages: string[][]): string {
  const path = join(tmpDir("cg-pdf-"), name);
  writeFileSync(path, makePdf(pages));
  return path;
}

describe("fetching a URL that names a file", () => {
  it("adds a PDF behind a .pdf URL as a PDF, whatever the content type says", async () => {
    const net = network({
      [URL_PDF]: () =>
        new Response(makePdf(BAUMAN), { status: 200, headers: { "content-type": "text/html" } }),
    });
    const e = await env({ fetch: net });
    const out = await e.call<AddOut>("items.add", { identifier: URL_PDF });
    const job = await e.svc.queue.waitFor(out.job);
    expect(job.status).toBe("succeeded");
    const fm = e.lib.getItem(
      job.result ? (job.result as { citekey: string }).citekey : out.citekey,
    ).frontmatter;
    expect(fm.sources).toHaveLength(1);
    expect(fm.sources[0]?.kind).toBe("pdf");
    expect(fm.sources[0]?.url).toBe(URL_PDF);
    expect(fm.title).toBe("Alone Again");
    expect(fm.author).toEqual([{ family: "Bauman", given: "Zygmunt" }]);
    expect(fm.issued).toBe(2005);
    expect(fm.type).not.toBe("webpage");
    expect(fm.incomplete).toBeUndefined();
  });

  it("asks like a browser and follows redirects", async () => {
    const net = network({ [URL_PDF]: () => new Response(makePdf(BAUMAN), { status: 200 }) });
    const e = await env({ fetch: net });
    await e.call<AddOut>("items.add", { identifier: URL_PDF });
    const request = net.seen[0];
    expect(request?.redirect).toBe("follow");
    expect(request?.headers["user-agent"]).toMatch(/^Mozilla\/5\.0 .*Chrome\//);
    expect(request?.headers.accept).toContain("application/pdf");
    expect(request?.headers.accept).toContain("text/html");
  });

  it("refuses a .pdf URL that answers with a page, and creates no item", async () => {
    const net = network({
      [URL_PDF]: () =>
        new Response(WALL_HTML, {
          status: 200,
          headers: { "content-type": "text/html; charset=UTF-8" },
        }),
    });
    const e = await env({ fetch: net });
    const err = await e.call("items.add", { identifier: URL_PDF }).catch((x: unknown) => x);
    expect(err).toBeInstanceOf(CitegeistError);
    const detail = (err as CitegeistError).detail;
    expect(detail.code).toBe("URL_RETURNED_HTML");
    expect(detail.fix).toMatch(/Download the file/);
    expect(detail.fix).toContain("local path");
    expect(e.lib.listItems({ limit: 10 }).items).toEqual([]);
  });

  it("still adds a normal page that answers with HTML", async () => {
    const e = await env();
    const out = await e.call<AddOut>("items.add", { identifier: "https://example.org/essay" });
    expect(e.lib.getItem(out.citekey).frontmatter.title).toBe("An Example Page");
  });

  it("never takes the domain as the title of a page without one", async () => {
    const url = "https://example.org/essays/on-loneliness";
    const net = network({
      [url]: () =>
        new Response("<html><body>Text</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    });
    const e = await env({ fetch: net });
    const out = await e.call<AddOut>("items.add", { identifier: url });
    const fm = e.lib.getItem(out.citekey).frontmatter;
    expect(fm.title).toBe("on loneliness");
    expect(fm.title).not.toContain("example.org");
    expect((fm.proposal as { status: string }).status).toBe("needs-review");
  });

  it("refuses a local .pdf that is a saved web page", async () => {
    const e = await env();
    const path = join(tmpDir("cg-pdf-"), "paper.pdf");
    writeFileSync(path, WALL_HTML);
    const err = await e.call("items.add", { identifier: path }).catch((x: unknown) => x);
    expect((err as CitegeistError).detail.code).toBe("FILE_IS_HTML");
  });
});

describe("a failed ingest leaves a marked item, and better data renames a placeholder key", () => {
  it("marks the item incomplete in the file, items.list and the problem list", async () => {
    const e = await env({ deps: { worker: flakyWorker(1) } });
    const out = await e.call<AddOut>("items.add", {
      identifier: pdfFile("scan_of_something.pdf", [["x"]]),
    });
    const job = await e.svc.queue.waitFor(out.job);
    expect(job.status).toBe("failed");

    const fm = e.lib.getItem(out.citekey).frontmatter;
    expect(fm.incomplete?.code).toBe("CONVERT_FAILED");
    expect(fm.incomplete?.job).toBeDefined();
    const listed = e.lib.listItems({ limit: 10 }).items[0];
    expect(listed?.incomplete).toBe(true);
    expect(listed?.incompleteReason).toContain("CONVERT_FAILED");
    const problems = e.lib.status().problems;
    expect(problems.map((p) => p.code)).toContain("ITEM_INCOMPLETE");
    expect(fm.title).not.toMatch(/\.(com|org|uk)$/);
  });

  it("clears the flag when a conversion succeeds later", async () => {
    const e = await env({ deps: { worker: flakyWorker(1) } });
    const out = await e.call<AddOut>("items.add", {
      identifier: pdfFile("scan_of_something.pdf", [["x"]]),
    });
    await e.svc.queue.waitFor(out.job);
    const retry = await e.call<{ job: string }>("documents.convert", {
      citekey: out.citekey,
      force: true,
    });
    expect((await e.svc.queue.waitFor(retry.job)).status).toBe("succeeded");
    expect(e.lib.getItem(out.citekey).frontmatter.incomplete).toBeUndefined();
    expect(e.lib.status().problems).toEqual([]);
  });

  it("reads the first page after a repair and replaces the placeholder citekey", async () => {
    const e = await env({ deps: { worker: flakyWorker(1) } });
    const out = await e.call<AddOut>("items.add", {
      identifier: pdfFile("scan_of_something.pdf", [["x"]]),
    });
    await e.svc.queue.waitFor(out.job);
    expect(out.citekey).toBe("anonndscan");

    const attached = await e.call<{ job: string }>("items.attach", {
      citekey: out.citekey,
      path: pdfFile("aloneagain.pdf", BAUMAN),
    });
    const done = await e.svc.queue.waitFor(attached.job);
    expect(done.status).toBe("succeeded");
    expect((done.result as { renamed?: { to: string } }).renamed?.to).toBe("bauman2005alone");

    const fm = e.lib.getItem("bauman2005alone").frontmatter;
    expect(fm.title).toBe("Alone Again");
    expect(fm.author).toEqual([{ family: "Bauman", given: "Zygmunt" }]);
    expect(fm.issued).toBe(2005);
    expect(fm.incomplete).toBeUndefined();
    expect(fm.sources.map((s) => s.kind)).toEqual(["pdf"]);
    expect(e.lib.index.get("SELECT 1 FROM items WHERE citekey = ?", "anonndscan")).toBeUndefined();
  });

  it("lets the AI task read the first page when one is configured", async () => {
    const calls: unknown[] = [];
    const ai = {
      run: async (task: string, input: unknown) => {
        calls.push([task, input]);
        const none = null;
        return {
          output: {
            type: none,
            title: {
              proposal: true,
              value: "Alone Again",
              confidence: "high",
              evidence: "Alone Again",
            },
            author: {
              proposal: true,
              value: [{ family: "Bauman", given: "Zygmunt" }],
              confidence: "high",
              evidence: "Zygmunt Bauman",
            },
            issued: { proposal: true, value: "2005", confidence: "medium", evidence: "2005" },
            "container-title": none,
            volume: none,
            issue: none,
            page: none,
            publisher: none,
            DOI: none,
            abstract: none,
            language: none,
          },
          stamp: { by: "mock", at: "2026-10-24T00:00:00.000Z", language: "en" },
          promptVersion: 1,
          ms: 1,
        };
      },
    } as never;
    const e = await env({ deps: { worker: flakyWorker(1), ai } });
    const out = await e.call<AddOut>("items.add", {
      identifier: pdfFile("scan_of_something.pdf", [["x"]]),
    });
    await e.svc.queue.waitFor(out.job);
    const attached = await e.call<{ job: string }>("items.attach", {
      citekey: out.citekey,
      path: pdfFile("aloneagain.pdf", BAUMAN),
    });
    await e.svc.queue.waitFor(attached.job);
    expect(calls).toHaveLength(1);
    expect((calls[0] as [string])[0]).toBe("metadata.fromFirstPage");
    const fm = e.lib.getItem("bauman2005alone").frontmatter;
    expect(fm.provenance.title).toMatch(/^ai-first-page@/);
  });

  it("keeps the placeholder citekey when a note already cites the item", async () => {
    const e = await env({ deps: { worker: flakyWorker(1) } });
    const out = await e.call<AddOut>("items.add", {
      identifier: pdfFile("scan_of_something.pdf", [["x"]]),
    });
    await e.svc.queue.waitFor(out.job);
    await e.call("notes.create", { title: "Loneliness", body: `See [[${out.citekey}]].` });

    const attached = await e.call<{ job: string }>("items.attach", {
      citekey: out.citekey,
      path: pdfFile("aloneagain.pdf", BAUMAN),
    });
    await e.svc.queue.waitFor(attached.job);
    const fm = e.lib.getItem(out.citekey).frontmatter;
    expect(fm.citekey).toBe("anonndscan");
    expect(fm.title).toBe("Alone Again");
    expect(fm.author).toEqual([{ family: "Bauman", given: "Zygmunt" }]);
  });

  it("does not touch the metadata a person wrote", async () => {
    const e = await env({ deps: { worker: flakyWorker(1) } });
    const out = await e.call<AddOut>("items.add", {
      identifier: pdfFile("scan_of_something.pdf", [["x"]]),
    });
    await e.svc.queue.waitFor(out.job);
    await e.call("items.update", { citekey: out.citekey, patch: { title: "My own title" } });
    const attached = await e.call<{ job: string }>("items.attach", {
      citekey: out.citekey,
      path: pdfFile("aloneagain.pdf", BAUMAN),
    });
    await e.svc.queue.waitFor(attached.job);
    expect(e.lib.getItem(out.citekey).frontmatter.title).toBe("My own title");
  });
});

describe("duplicates", () => {
  it("attaches the file and converts when the matched item has no working source", async () => {
    const e = await env({ deps: { worker: flakyWorker(1) } });
    const path = pdfFile("paper.pdf", [["The Strength of Weak Ties", "Granovetter", "1973"]]);
    const first = await e.call<AddOut>("items.add", { identifier: path });
    expect((await e.svc.queue.waitFor(first.job)).status).toBe("failed");
    expect(e.lib.getItem(first.citekey).frontmatter.incomplete).toBeDefined();

    // The same file again: before the fix this was dropped as a duplicate of the broken item.
    const again = await e.call<AddOut>("items.add", { identifier: path });
    expect(again.duplicateOf).toBe(first.citekey);
    expect(again.repaired).toBe(true);
    expect((await e.svc.queue.waitFor(again.job)).status).toBe("succeeded");
    const fm = e.lib.getItem(first.citekey).frontmatter;
    expect(fm.incomplete).toBeUndefined();
    expect(fm.sources).toHaveLength(1);
    expect(e.lib.listItems({ limit: 10 }).items).toHaveLength(1);
  });

  it("replaces a source that never converted by the new file", async () => {
    const e = await env({ deps: { worker: flakyWorker(1) } });
    const first = await e.call<AddOut>("items.add", {
      identifier: pdfFile("scan_of_something.pdf", [["x"]]),
    });
    await e.svc.queue.waitFor(first.job);
    const brokenHash = e.lib.getItem(first.citekey).frontmatter.sources[0]?.hash;

    // A new file attached to the broken item takes the place of the source that never converted.
    const attached = await e.call<{ job: string; source: string }>("items.attach", {
      citekey: first.citekey,
      path: pdfFile("other.pdf", [["Another try"]]),
    });
    await e.svc.queue.waitFor(attached.job);
    // The first page named the work, so the placeholder key is gone; find the item again.
    const citekey = e.lib.listItems({ limit: 10 }).items[0]?.citekey ?? "";
    const sources = e.lib.getItem(citekey).frontmatter.sources;
    expect(sources.map((s) => s.hash)).toEqual([attached.source]);
    expect(sources[0]?.hash).not.toBe(brokenHash);
  });

  it("does not repair an item whose conversion is still running", async () => {
    const e = await env();
    const path = pdfFile("paper.pdf", [["The Strength of Weak Ties", "Granovetter", "1973"]]);
    const first = await e.call<AddOut>("items.add", { identifier: path });
    const again = await e.call<AddOut>("items.add", { identifier: path });
    expect(again.duplicateOf).toBe(first.citekey);
    expect(again.repaired).toBeUndefined();
  });

  it("matches on a strong identifier, or on full title, year and first author", async () => {
    const e = await env();
    const first = await e.call<AddOut>("items.add", {
      identifier: "@book{a, title={Soziale Systeme}, author={Luhmann, Niklas}, year={1984}}",
    });
    // Same title, but no year and no author: not the same work.
    const bare = await e.call<AddOut>("items.add", {
      identifier: "@misc{b, title={Soziale Systeme}}",
    });
    expect(bare.duplicateOf).toBeUndefined();
    // Same title and author, other year.
    const otherYear = await e.call<AddOut>("items.add", {
      identifier: "@book{c, title={Soziale Systeme}, author={Luhmann, Niklas}, year={1987}}",
    });
    expect(otherYear.duplicateOf).toBeUndefined();
    // Same title, year and author: the same work.
    const same = await e.call<AddOut>("items.add", {
      identifier: "@book{d, title={Soziale Systeme}, author={Luhmann, Niklas}, year={1984}}",
    });
    expect(same.duplicateOf).toBe(first.citekey);
  });

  it("does not treat a PDF without author and year as a duplicate of a title-only item", async () => {
    const e = await env();
    await e.call<AddOut>("items.add", { identifier: "@misc{x, title={Alone Again}}" });
    const out = await e.call<AddOut>("items.add", {
      identifier: pdfFile("aloneagain.pdf", BAUMAN),
    });
    expect(out.duplicateOf).toBeUndefined();
  });
});

describe("items.trash by an agent", () => {
  const BIB = "@book{k, title={Trash target}, author={Nobody, Nina}, year={2001}}";

  it("lets an agent trash what an agent added, and records who did it", async () => {
    const e = await env();
    const out = await e.call<AddOut>("items.add", { identifier: BIB }, "agent:grok");
    await e.svc.queue.waitFor(out.job);
    await e.call("items.trash", { citekey: out.citekey }, "agent:claude-code");
    expect(e.lib.index.get("SELECT 1 FROM items WHERE citekey = ?", out.citekey)).toBeUndefined();
    const trash = join(e.root, ".trash");
    const dir = readdirSync(trash).find((d) => d.startsWith(`${out.citekey}-`)) ?? "";
    const record = JSON.parse(readFileSync(join(trash, dir, "trashed.json"), "utf8")) as {
      by: string;
    };
    expect(record.by).toBe("agent:claude-code");
  });

  it("refuses an item the user added, but lets the user trash it", async () => {
    const e = await env();
    const out = await e.call<AddOut>("items.add", { identifier: BIB });
    await e.svc.queue.waitFor(out.job);
    const err = await e
      .call("items.trash", { citekey: out.citekey }, "agent:claude-code")
      .catch((x: unknown) => x);
    expect((err as CitegeistError).detail.code).toBe("TRASH_NOT_ALLOWED");
    expect((err as CitegeistError).detail.recovery).toBe("ask-human");
    await e.call("items.trash", { citekey: out.citekey });
  });

  it("refuses an item that a note already cites", async () => {
    const e = await env();
    const out = await e.call<AddOut>(
      "items.add",
      { identifier: BIB, target: "library" },
      "agent:grok",
    );
    await e.svc.queue.waitFor(out.job);
    await e.call("notes.create", { title: "Cites it", body: `See [[${out.citekey}]].` });
    const err = await e
      .call("items.trash", { citekey: out.citekey }, "agent:grok")
      .catch((x: unknown) => x);
    expect((err as CitegeistError).detail.code).toBe("TRASH_NOT_ALLOWED");
  });

  it("lets an agent trash an incomplete item the user added, once nothing cites it", async () => {
    const e = await env({ deps: { worker: flakyWorker(1) } });
    const out = await e.call<AddOut>("items.add", {
      identifier: pdfFile("scan_of_something.pdf", [["x"]]),
    });
    await e.svc.queue.waitFor(out.job);
    await e.call("items.trash", { citekey: out.citekey }, "agent:claude-code");
    expect(e.lib.listItems({ limit: 10 }).items).toEqual([]);
  });
});
