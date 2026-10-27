import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createResolver, type FetchLike, type PdfLocation } from "@citegeist/metadata";
import { afterEach, describe, expect, it } from "vitest";
import { cleanTmpDirs, itemData } from "../test-helpers.js";
import { createTestEnv, makePdf, type TestEnv, testFetch } from "./testing.js";

// items.findFulltext: the full text cascade for one item that has no file, on request. The web is
// a table of answers (the recorded Unpaywall and DSpace pages of fixtures/fulltext, plus a small
// PDF), so the same item can fail first and succeed after the table changes.

const dir = fileURLToPath(new URL("../../../../fixtures/fulltext/", import.meta.url));
const read = (name: string): string => readFileSync(`${dir}${name}`, "utf8");

const DOI = "10.1086/225469";
const UUID = "0f3766c3-5aa4-4ef9-bb6c-37ff2188a131";
const HOST = "https://scholarspace.manoa.hawaii.edu";
const DOWNLOAD = `${HOST}/bitstreams/${UUID}/download`;
const CONTENT = `${HOST}/server/api/core/bitstreams/${UUID}/content`;

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
const pdf = (): Answer => () =>
  new Response(makePdf([["Open access PDF"]]), {
    status: 200,
    headers: { "content-type": "application/pdf" },
  });
const html =
  (body: string): Answer =>
  () =>
    new Response(body, { status: 200, headers: { "content-type": "text/html" } });

interface Result {
  citekey: string;
  found: boolean;
  tried: { source: string; outcome: string; url?: string; detail?: string }[];
  job?: string;
  alreadyHadFile?: boolean;
}

async function setup() {
  /** What the web answers, by exact address. Anything else is a 404. */
  const web: Record<string, Answer> = {};
  let locations: PdfLocation[] = [];
  const requested: string[] = [];
  const base = testFetch();
  const fetch: FetchLike & { log: { urls: string[] } } = Object.assign(
    (async (url: string, init?: RequestInit) => {
      const answer = web[url];
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
    findOpenAccess: async () => ({ pdfLocations: locations }),
    findOpenAlexPdfs: async () => [],
  };
  const e = await createTestEnv({ fetch, deps: { resolver } });
  envs.push(e);
  const add = await e.call<{ citekey: string; job: string }>("items.add", { identifier: DOI });
  await e.svc.queue.waitFor(add.job);
  await e.svc.queue.idle();
  return {
    e,
    citekey: add.citekey,
    web,
    requested,
    setLocations: (l: PdfLocation[]) => {
      locations = l;
    },
    find: (citekey: string) => e.call<Result>("items.findFulltext", { citekey }),
    fm: (citekey: string) => e.lib.getItem(citekey).frontmatter,
  };
}

describe("items.findFulltext", () => {
  it("reports no free full text, records every address tried and changes nothing else", async () => {
    const t = await setup();
    t.web[DOWNLOAD] = html(read("scholarspace-spa.html"));
    t.web[CONTENT] = () => new Response("no", { status: 404 });
    t.setLocations([{ url: DOWNLOAD, version: "publishedVersion", hostType: "repository" }]);
    t.requested.length = 0;

    const before = t.fm(t.citekey);
    expect(before.fulltext?.status).toBe("missing");
    const out = await t.find(t.citekey);

    expect(out.found).toBe(false);
    expect(out.job).toBeUndefined();
    expect(out.tried.filter((a) => a.url).map((a) => a.url)).toEqual(
      expect.arrayContaining([CONTENT, DOWNLOAD]),
    );
    const after = t.fm(t.citekey);
    expect(after.sources).toHaveLength(0);
    expect(after.fulltext?.status).toBe("missing");
    expect(after.fulltext?.tried).toEqual(out.tried);
    expect(after.incomplete).toBeUndefined();
    expect(t.requested[0]).toBe(CONTENT);
  });

  it("attaches and converts the PDF when a retry finds one, and clears the missing marker", async () => {
    const t = await setup();
    expect(t.fm(t.citekey).fulltext?.status).toBe("missing");

    t.setLocations([{ url: DOWNLOAD, version: "publishedVersion", hostType: "repository" }]);
    t.web[DOWNLOAD] = html(read("scholarspace-spa.html"));
    t.web[CONTENT] = pdf();
    const out = await t.find(t.citekey);

    expect(out.found).toBe(true);
    expect(out.tried.at(-1)).toMatchObject({ outcome: "ok", url: CONTENT });
    expect(out.job).toBeDefined();
    await t.e.svc.queue.waitFor(out.job as string);
    await t.e.svc.queue.idle();
    const fm = t.fm(t.citekey);
    expect(fm.sources).toHaveLength(1);
    expect(fm.sources[0]?.url).toBe(CONTENT);
    expect(fm.fulltext).toBeUndefined();
    expect(t.e.svc.hasWorkingSource(t.citekey)).toBe(true);

    // a second call has nothing to look for and sends no request
    t.requested.length = 0;
    const again = await t.find(t.citekey);
    expect(again).toMatchObject({ found: true, alreadyHadFile: true, tried: [] });
    expect(t.requested).toEqual([]);
  });

  it("looks only at the item it is called for", async () => {
    const t = await setup();
    t.e.lib.writeItem(itemData("other1984", { DOI: "10.1000/other" }));
    t.web[CONTENT] = pdf();
    t.setLocations([{ url: CONTENT }]);
    await t.find(t.citekey);
    await t.e.svc.queue.idle();
    expect(t.fm("other1984").sources).toHaveLength(0);
    expect(t.fm("other1984").fulltext).toBeUndefined();
    expect(t.requested.every((u) => !u.includes("other"))).toBe(true);
  });

  it("asks for a DOI when the item has none", async () => {
    const t = await setup();
    t.e.lib.writeItem(itemData("nodoi1984"));
    await expect(t.find("nodoi1984")).rejects.toThrow(/FULLTEXT_NEEDS_DOI/);
    expect(t.requested).toEqual([]);
  });

  it("refuses an unknown citekey", async () => {
    const t = await setup();
    await expect(t.find("zzzz")).rejects.toThrow(/ITEM_NOT_FOUND/);
  });
});
