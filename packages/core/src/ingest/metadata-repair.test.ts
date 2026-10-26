import { readFileSync } from "node:fs";
import type { FetchLike } from "@citegeist/metadata";
import { afterEach, describe, expect, it } from "vitest";
import { cleanTmpDirs } from "../test-helpers.js";
import { createTestEnv, type RemoteLog, type TestEnv, testFetch } from "./testing.js";

// Items that arrive without authors or year, and how they get repaired (the real case: papers
// added by URL, then added again by DOI or ISBN, which made a second item).

let envs: TestEnv[] = [];
afterEach(async () => {
  for (const e of envs) {
    await e.svc.close();
    await e.lib.close();
  }
  envs = [];
  cleanTmpDirs();
});

const page = (name: string): string =>
  readFileSync(new URL(`../../../../fixtures/web/${name}`, import.meta.url), "utf8");

const NUMPY_DOI = "10.1038/s41586-020-2649-2";
const SSRN_DOI = "10.2139/ssrn.1462344";
const RECKWITZ_ISBN = "9783518587065";

const ok = (body: string): Response =>
  new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

interface Net {
  /** Pages by URL. */
  pages: Record<string, () => Response>;
  /** While true, everything that is not a page fails like a network that is down. */
  offline: boolean;
  requested: string[];
}

function network(pages: Net["pages"]): FetchLike & { log: RemoteLog; net: Net } {
  const base = testFetch();
  const net: Net = { pages, offline: false, requested: [] };
  const fn: FetchLike = async (url, init) => {
    const route = net.pages[url];
    if (route) {
      net.requested.push(url);
      return route();
    }
    if (net.offline) throw new TypeError("fetch failed");
    return base(url, init);
  };
  return Object.assign(fn, { log: base.log, net });
}

async function env(pages: Net["pages"]): Promise<{ e: TestEnv; net: Net }> {
  const fetch = network(pages);
  const e = await createTestEnv({ fetch });
  envs.push(e);
  return { e, net: fetch.net };
}

interface AddOut {
  citekey: string;
  job: string;
  duplicateOf?: string;
  enriched?: string[];
  suggestedCitekey?: string;
}

async function add(e: TestEnv, identifier: string, extra: object = {}, actor = "human") {
  const out = await e.call<AddOut>("items.add", { identifier, ...extra }, actor as never);
  const job = await e.svc.queue.waitFor(out.job);
  return { out, job };
}

const THIN_PAGE =
  "<html><head><title>Array programming with NumPy | Example Essays</title></head><body>Text</body></html>";

describe("web pages as a source of metadata", () => {
  it("resolves the DOI a publisher page names and takes the record of the sources", async () => {
    const { e } = await env({
      "https://journals.example.org/articles/numpy": () => ok(page("article-citation-doi.html")),
    });
    const { out } = await add(e, "https://journals.example.org/articles/numpy");
    const fm = e.lib.getItem(out.citekey).frontmatter;
    expect(fm.DOI).toBe(NUMPY_DOI);
    expect(fm.type).toBe("article-journal");
    expect(fm.author?.length).toBeGreaterThan(10);
    expect(fm.provenance.title).toMatch(/^crossref@/);
  });

  it("reads Highwire tags when the page names no identifier", async () => {
    const { e } = await env({
      "https://journals.example.org/articles/systems": () => ok(page("article-citation-only.html")),
    });
    const { out } = await add(e, "https://journals.example.org/articles/systems");
    const fm = e.lib.getItem(out.citekey).frontmatter;
    expect(fm.title).toBe("Systemtheorie und Gesellschaftskritik");
    expect(fm.author).toEqual([
      { family: "Muster", given: "Anna" },
      { family: "Beispiel", given: "Jan-Peter" },
    ]);
    expect(fm.issued).toBe("2018-03");
    expect(fm["container-title"]).toBe("Beispiel Zeitschrift für Soziologie");
    expect(fm.type).toBe("article-journal");
    expect(fm.provenance.author).toMatch(/^web@/);
    expect(fm.citekey).toMatch(/^muster2018/);
    expect(fm.proposal).toBeUndefined();
  });

  it("resolves the ISBN of a book page through the normal sources", async () => {
    const { e } = await env({ "https://verlag.example.org/b": () => ok(page("book-jsonld.html")) });
    const { out } = await add(e, "https://verlag.example.org/b");
    const fm = e.lib.getItem(out.citekey).frontmatter;
    expect(fm.ISBN).toBe(RECKWITZ_ISBN);
    expect(fm.provenance.title).not.toMatch(/^web@/);
    expect(fm.author?.[0]).toMatchObject({ family: "Reckwitz" });
  });

  it("keeps the page's own record when the sources do not answer for its ISBN", async () => {
    const html = page("book-jsonld.html").replace("978-3-518-58706-5", "978-3-16-148410-0");
    const { e } = await env({ "https://verlag.example.org/b": () => ok(html) });
    const { out } = await add(e, "https://verlag.example.org/b");
    const fm = e.lib.getItem(out.citekey).frontmatter;
    expect(fm.ISBN).toBe("9783161484100");
    expect(fm.type).toBe("book");
    expect(fm.author).toEqual([{ family: "Reckwitz", given: "Andreas" }]);
    expect(fm.publisher).toBe("Suhrkamp");
    expect(fm.provenance.title).toMatch(/^web@/);
  });

  it("takes author, date and title from Open Graph tags of a plain page", async () => {
    const { e } = await env({
      "https://plain.example.org/manifesto": () => ok(page("plain-page.html")),
    });
    const { out } = await add(e, "https://plain.example.org/manifesto");
    const fm = e.lib.getItem(out.citekey).frontmatter;
    expect(fm.type).toBe("webpage");
    expect(fm.title).toBe("A Manifesto for Slow Reading");
    expect(fm.author).toEqual([{ family: "Muster", given: "Maria" }]);
    expect(fm.issued).toBe("2021-05-04");
    expect(fm["container-title"]).toBe("Example Essays");
    expect(fm.URL).toBe("https://plain.example.org/manifesto");
  });

  it("derives the DOI of an SSRN address and never opens the page that blocks programs", async () => {
    const url = "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1462344";
    const { e, net } = await env({
      [url]: () => new Response(page("ssrn-challenge.html"), { status: 403 }),
    });
    const { out } = await add(e, url);
    expect(net.requested).toEqual([]);
    const fm = e.lib.getItem(out.citekey).frontmatter;
    expect(fm.DOI).toBe(SSRN_DOI);
    expect(fm.author?.[0]).toMatchObject({ family: "Troutt" });
    expect(fm.issued).toBe("2009");
    expect(fm.citekey).toMatch(/^troutt2009/);
  });

  it("makes no item from a bot challenge that answers 200", async () => {
    const url = "https://bot.example.org/paper";
    const { e } = await env({ [url]: () => ok(page("ssrn-challenge.html")) });
    await expect(e.call("items.add", { identifier: url })).rejects.toMatchObject({
      detail: { code: "URL_BOT_CHALLENGE" },
    });
    expect(e.lib.index.all("SELECT citekey FROM items")).toEqual([]);
  });

  it("names the DOI route when a site turns the fetcher away with 403", async () => {
    const url = "https://blocked.example.org/paper";
    const { e } = await env({ [url]: () => new Response("no", { status: 403 }) });
    await expect(e.call("items.add", { identifier: url })).rejects.toMatchObject({
      detail: { code: "URL_UNREACHABLE", fix: expect.stringContaining("DOI") },
    });
  });
});

describe("the same work added twice", () => {
  it("URL first, DOI second: the second add enriches the first item", async () => {
    const { e } = await env({ "https://essays.example.org/np": () => ok(THIN_PAGE) });
    const first = await add(e, "https://essays.example.org/np");
    const before = e.lib.getItem(first.out.citekey).frontmatter;
    expect(before.author).toBeUndefined();
    expect(before.issued).toBeUndefined();
    expect(before.citekey).toMatch(/^anonnd/);

    const second = await add(e, NUMPY_DOI);
    expect(second.out.duplicateOf).toBe(first.out.citekey);
    expect(second.out.citekey).toBe(first.out.citekey);
    expect(second.out.enriched).toEqual(expect.arrayContaining(["author", "issued", "DOI"]));
    expect(second.out.suggestedCitekey).toMatch(/^harris2020/);

    const after = e.lib.getItem(first.out.citekey).frontmatter;
    expect(after.DOI).toBe(NUMPY_DOI);
    expect(after.author?.[0]).toMatchObject({ family: "Harris" });
    expect(after.type).toBe("article-journal");
    expect(after.proposal).toBeUndefined();
    expect(after.citekey).toBe(before.citekey);
    expect(e.lib.index.all("SELECT citekey FROM items")).toHaveLength(1);

    // A third add finds the finished item and changes nothing.
    const third = await add(e, NUMPY_DOI);
    expect(third.out.duplicateOf).toBe(first.out.citekey);
    expect(third.out.enriched).toBeUndefined();
  });

  it("does not take a generic title for the same work", async () => {
    const { e } = await env({
      "https://essays.example.org/a": () =>
        ok("<html><head><title>Introduction | Example Essays</title></head></html>"),
    });
    await add(e, "https://essays.example.org/a");
    const second = await add(e, NUMPY_DOI);
    expect(second.out.duplicateOf).toBeUndefined();
    expect(e.lib.index.all("SELECT citekey FROM items")).toHaveLength(2);
  });

  it("does not merge into an item that has an author and year of its own", async () => {
    const { e } = await env({});
    const first = await add(
      e,
      "@article{x, title={Array programming with NumPy}, author={Doe, Jane}, year={1999}}",
    );
    const second = await add(e, NUMPY_DOI);
    expect(second.out.duplicateOf).toBeUndefined();
    expect(second.out.citekey).not.toBe(first.out.citekey);
  });

  it("URL first, ISBN second: an item the page gave an ISBN but no record takes it", async () => {
    const html = `<html><head><title>Die Gesellschaft der Singularitäten | Verlag</title>
      <meta name="citation_isbn" content="978-3-518-58706-5"></head></html>`;
    const { e, net } = await env({ "https://verlag.example.org/b": () => ok(html) });
    net.offline = true;
    const first = await add(e, "https://verlag.example.org/b");
    const before = e.lib.getItem(first.out.citekey).frontmatter;
    expect(before.ISBN).toBe(RECKWITZ_ISBN);
    expect(before.author).toBeUndefined();

    net.offline = false;
    const second = await add(e, RECKWITZ_ISBN);
    expect(second.out.duplicateOf).toBe(first.out.citekey);
    expect(second.out.enriched).toEqual(expect.arrayContaining(["author", "issued"]));
    expect(e.lib.getItem(first.out.citekey).frontmatter.author?.[0]).toMatchObject({
      family: "Reckwitz",
    });
    expect(e.lib.index.all("SELECT citekey FROM items")).toHaveLength(1);
  });

  it("recognises the landing page of the DOI as the address of an existing item", async () => {
    const { e } = await env({});
    const first = await add(
      e,
      `@misc{old, title={Notes on arrays}, url={https://doi.org/${NUMPY_DOI}}}`,
    );
    const second = await add(e, NUMPY_DOI);
    expect(second.out.duplicateOf).toBe(first.out.citekey);
    expect(second.out.enriched).toContain("DOI");
    expect(e.lib.index.all("SELECT citekey FROM items")).toHaveLength(1);
  });

  it("recognises an item whose address contains the DOI", async () => {
    const { e } = await env({});
    const first = await add(
      e,
      `@misc{old, title={Notes on arrays}, url={https://publisher.example.org/doi/${NUMPY_DOI}}}`,
    );
    const second = await add(e, NUMPY_DOI);
    expect(second.out.duplicateOf).toBe(first.out.citekey);
  });
});

describe("adding an identifier to an existing item", () => {
  async function thinItem(e: TestEnv): Promise<string> {
    return (await add(e, "https://essays.example.org/np")).out.citekey;
  }
  const pages = { "https://essays.example.org/np": () => ok(THIN_PAGE) };

  it("add_item with a citekey stores the identifier and looks the item up", async () => {
    const { e } = await env(pages);
    const citekey = await thinItem(e);
    const { out, job } = await add(e, NUMPY_DOI, { citekey }, "agent:claude-code");
    expect(out.citekey).toBe(citekey);
    expect(out.duplicateOf).toBeUndefined();
    expect(out.enriched).toEqual(expect.arrayContaining(["author", "issued"]));
    expect(out.suggestedCitekey).toMatch(/^harris2020/);
    expect(job.status).toBe("succeeded");
    const fm = e.lib.getItem(citekey).frontmatter;
    expect(fm.DOI).toBe(NUMPY_DOI);
    // the identifier came from the agent, the rest from the sources
    expect(fm.provenance.DOI).toMatch(/^agent:claude-code@/);
    expect(fm.provenance.author).toMatch(/^crossref@/);
    expect(fm.citekey).toBe(citekey);
  });

  it("keeps what the agent or a person edited when the item is looked up again", async () => {
    const { e } = await env(pages);
    const citekey = await thinItem(e);
    await add(e, NUMPY_DOI, { citekey }, "agent:claude-code");
    await e.call("items.update", { citekey, patch: { title: "My title" } }, "human");
    const again = await e.call<{ changed: string[] }>("items.resolve", { citekey });
    expect(again.changed).not.toContain("title");
    expect(again.changed).not.toContain("DOI");
    expect(e.lib.getItem(citekey).frontmatter.title).toBe("My title");
  });

  it("stores nothing when the lookup fails", async () => {
    const { e } = await env(pages);
    const citekey = await thinItem(e);
    await expect(
      e.call("items.add", { identifier: "10.1234/does.not.exist", citekey }),
    ).rejects.toBeInstanceOf(Error);
    expect(e.lib.getItem(citekey).frontmatter.DOI).toBeUndefined();
  });

  it("refuses an identifier that another item has, and says which", async () => {
    const { e } = await env(pages);
    const citekey = await thinItem(e);
    const other = (await add(e, NUMPY_DOI)).out;
    expect(other.duplicateOf).toBe(citekey);
    // the same work is one item now; a second item with that DOI would be a manual duplicate
    const second = (await add(e, SSRN_DOI)).out.citekey;
    await expect(e.call("items.add", { identifier: SSRN_DOI, citekey })).rejects.toMatchObject({
      detail: { code: "IDENTIFIER_IN_USE", context: { duplicateOf: second } },
    });
  });

  it("items.resolve with an identifier takes a URL as well", async () => {
    const { e } = await env({
      ...pages,
      "https://journals.example.org/articles/systems": () => ok(page("article-citation-only.html")),
    });
    const citekey = await thinItem(e);
    const out = await e.call<{ changed: string[] }>("items.resolve", {
      citekey,
      identifier: "https://journals.example.org/articles/systems",
    });
    expect(out.changed).toEqual(expect.arrayContaining(["author", "issued"]));
    const fm = e.lib.getItem(citekey).frontmatter;
    expect(fm.author?.[0]).toMatchObject({ family: "Muster" });
    expect(fm.URL).toBe("https://journals.example.org/articles/systems");
    expect(fm.provenance.URL).toMatch(/^human@/);
  });

  it("says what is wrong with an input that is no identifier", async () => {
    const { e } = await env(pages);
    const citekey = await thinItem(e);
    await expect(
      e.call("items.resolve", { citekey, identifier: "not an identifier" }),
    ).rejects.toMatchObject({ detail: { code: "INVALID_IDENTIFIER" } });
  });

  it("is not available to a research job", async () => {
    const { e } = await env(pages);
    const citekey = await thinItem(e);
    await expect(
      e.registry.call(
        "items.add",
        { actor: "agent:research", egress: "scholarly" },
        {
          identifier: NUMPY_DOI,
          citekey,
        },
      ),
    ).rejects.toMatchObject({ detail: { code: "RESEARCH_REPAIR_FORBIDDEN" } });
  });
});

describe("editing metadata by hand (items.update)", () => {
  const pages = { "https://essays.example.org/np": () => ok(THIN_PAGE) };

  it("offers a new citekey when a placeholder gets author and year, and renames nothing", async () => {
    const { e } = await env(pages);
    const citekey = (await add(e, "https://essays.example.org/np")).out.citekey;
    const half = await e.call<{ suggestedCitekey?: string }>("items.update", {
      citekey,
      patch: { author: [{ family: "Harris", given: "Charles" }] },
    });
    expect(half.suggestedCitekey).toBeUndefined();
    const out = await e.call<{ suggestedCitekey?: string }>("items.update", {
      citekey,
      patch: { issued: 2020 },
    });
    expect(out.suggestedCitekey).toMatch(/^harris2020/);
    expect(e.lib.getItem(citekey).frontmatter.citekey).toBe(citekey);
    const fm = e.lib.getItem(citekey).frontmatter;
    expect(fm.provenance.author).toMatch(/^human@/);
    expect(fm.proposal).toBeUndefined();
    await e.call("items.rename", { citekey, to: out.suggestedCitekey });
    expect(e.lib.getItem(out.suggestedCitekey as string).frontmatter.title).toContain("NumPy");
  });

  it("offers nothing for an item that has a real citekey", async () => {
    const { e } = await env({});
    const citekey = (await add(e, NUMPY_DOI)).out.citekey;
    const out = await e.call<{ suggestedCitekey?: string }>("items.update", {
      citekey,
      patch: { issued: 2021 },
    });
    expect(out.suggestedCitekey).toBeUndefined();
  });

  it("checks DOI, ISBN and URL and says what is wrong", async () => {
    const { e } = await env(pages);
    const citekey = (await add(e, "https://essays.example.org/np")).out.citekey;
    await expect(
      e.call("items.update", { citekey, patch: { DOI: "doi is not here" } }),
    ).rejects.toMatchObject({
      detail: { code: "INVALID_PATCH", message: expect.stringContaining("not a DOI") },
    });
    await expect(
      e.call("items.update", { citekey, patch: { ISBN: "978-3-518-58706-4" } }),
    ).rejects.toMatchObject({
      detail: { code: "INVALID_PATCH", message: expect.stringContaining("ISBN") },
    });
    await expect(
      e.call("items.update", { citekey, patch: { URL: "ftp://x" } }),
    ).rejects.toMatchObject({ detail: { code: "INVALID_PATCH" } });
    const ok1 = await e.call<{ frontmatter: { DOI?: string; ISBN?: string } }>("items.update", {
      citekey,
      patch: { DOI: "https://doi.org/10.1000/ABC", ISBN: "978-3-518-58706-5, 0-7432-0304-6" },
    });
    expect(ok1.frontmatter.DOI).toBe("10.1000/abc");
    expect(ok1.frontmatter.ISBN).toBe("978-3-518-58706-5, 0-7432-0304-6");
  });
});
