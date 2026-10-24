import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  createResolver,
  type GraphLookup,
  type MetadataResolver,
  type ReferencePage,
} from "@citegeist/metadata";
import type { Actor, ItemFrontmatter } from "@citegeist/schema";
import { afterEach, describe, expect, it } from "vitest";
import { createTestEnv, type TestEnv } from "../ingest/testing.js";
import { cleanTmpDirs, itemData, STAMP } from "../test-helpers.js";
import { bindGraphOperations, type GraphService, listFlagged, retractionOf } from "./index.js";
import { markWorks } from "./marking.js";
import { scheduleLibraryChecks } from "./schedule.js";

const NOW = Date.parse("2026-10-24T12:00:00Z");
const WAKEFIELD = "10.1016/s0140-6736(97)11096-0";
const NUMPY = "10.1038/s41586-020-2649-2";
const HASH = "0123456789ab";

interface Env extends TestEnv {
  resolver: MetadataResolver;
  graph: GraphService;
}

let envs: Array<Pick<Env, "lib" | "svc" | "graph">> = [];
const stops: Array<() => void> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) stop();
  for (const e of envs) {
    e.graph.stop();
    await e.svc.close();
    await e.lib.close();
  }
  envs = [];
  cleanTmpDirs();
});

/** A library with the real ingest service and a resolver that replays the recorded responses. */
async function setup(lookup?: (resolver: MetadataResolver) => GraphLookup): Promise<Env> {
  const base = await createTestEnv();
  const resolver = createResolver({
    config: { mailto: "tester@example.invalid" },
    fetch: base.fetch,
    now: () => NOW,
    sleep: async () => {},
  });
  const graph = bindGraphOperations(base.registry, base.lib, {
    lookup: lookup ? lookup(resolver) : resolver,
    addItem: (actor, input) => base.svc.addItem(actor, input),
    queue: base.svc.queue,
  });
  const env = Object.assign(base, { resolver, graph });
  envs.push(env);
  return env;
}

function put(e: Env, citekey: string, extra: Record<string, unknown> = {}): ItemFrontmatter {
  const fm = itemData(citekey, { type: "article-journal", ...extra });
  const result = e.lib.writeItem(fm);
  expect(result.status).toBe("indexed");
  return fm;
}

const frontmatter = (e: Env, citekey: string): Record<string, unknown> =>
  e.lib.getItem(citekey).frontmatter as Record<string, unknown>;

interface Marked {
  doi?: string;
  openalex?: string;
  title?: string;
  status: "library" | "inbox" | "new";
  citekey?: string;
  addable: boolean;
}
interface Refs {
  source?: string;
  total: number;
  references: Marked[];
  counts: { library: number; inbox: number; new: number };
  errors: string[];
}

describe("graph.references", () => {
  it("marks the Crossref references as in the library, in the inbox or new", async () => {
    const e = await setup();
    put(e, "wakefield1998", { DOI: WAKEFIELD });
    put(e, "bhatt1982", { DOI: "10.1016/0009-8981(82)90018-3" });
    put(e, "fujimura1996", {
      DOI: "10.1136/gut.38.5.724",
      inbox: { by: "agent:test", why: "found it" },
    });

    const out = await e.call<Refs>("graph.references", { citekey: "wakefield1998" });
    expect(out.source).toBe("crossref");
    expect(out.total).toBe(26);
    expect(out.references).toHaveLength(26);
    expect(out.counts).toEqual({ library: 1, inbox: 1, new: 24 });

    const by = (doi: string) => out.references.find((r) => r.doi === doi);
    expect(by("10.1016/0009-8981(82)90018-3")).toMatchObject({
      status: "library",
      citekey: "bhatt1982",
    });
    expect(by("10.1136/gut.38.5.724")).toMatchObject({ status: "inbox", citekey: "fujimura1996" });
    const fresh = out.references.find((r) => r.status === "new" && r.doi);
    expect(fresh).toMatchObject({ addable: true });
    expect(fresh?.citekey).toBeUndefined();
    // A reference without any identifier is listed but cannot be added.
    const bare = out.references.find((r) => !r.doi && !r.openalex);
    expect(bare).toMatchObject({ status: "new", addable: false });
  });

  it("matches a reference without DOI by title, year and first author", async () => {
    const e = await setup();
    put(e, "wakefield1998", { DOI: WAKEFIELD });
    put(e, "asperger1961", {
      title: "Die Psychopathologie des coeliakakranken kindes.",
      author: [{ family: "Asperger", given: "Hans" }],
      issued: 1961,
    });
    const out = await e.call<Refs>("graph.references", { citekey: "wakefield1998" });
    const hit = out.references.find((r) => r.citekey === "asperger1961");
    expect(hit?.status).toBe("library");
  });

  it("prefers the reference list of the converted paper (refs.jsonl)", async () => {
    const e = await setup();
    put(e, "paper2020", {
      DOI: NUMPY,
      sources: [{ hash: HASH, kind: "pdf", filename: "paper.pdf", role: "main", added: STAMP }],
    });
    put(e, "known2019", { DOI: "10.1000/known" });
    const refs = e.lib.paths.refs("paper2020", HASH);
    mkdirSync(dirname(refs), { recursive: true });
    writeFileSync(
      refs,
      [
        {
          key: "r0",
          raw: "Known, A. (2019). X. https://doi.org/10.1000/known",
          doi: "10.1000/known",
        },
        {
          key: "r1",
          raw: "Vaswani et al. Attention is all you need. arXiv:1706.03762",
          title: "Attention is all you need",
          authors: ["Ashish Vaswani", "Noam Shazeer"],
          year: "2017",
          doi: null,
        },
        { key: "r2", raw: "Some book without identifiers", title: null, doi: null },
        "not json",
      ]
        .map((r) => (typeof r === "string" ? r : JSON.stringify(r)))
        .join("\n"),
    );
    const out = await e.call<Refs & { references: Array<Marked & Record<string, unknown>> }>(
      "graph.references",
      { citekey: "paper2020" },
    );
    expect(out.source).toBe("refs.jsonl");
    expect(out.total).toBe(3);
    expect(out.references[0]).toMatchObject({ status: "library", citekey: "known2019" });
    expect(out.references[1]).toMatchObject({
      status: "new",
      arxiv: "1706.03762",
      authors: "Vaswani, Shazeer",
      year: 2017,
      addable: true,
    });
    expect(out.references[2]).toMatchObject({ status: "new", addable: false });
  });

  it("falls back from refs.jsonl to Crossref to OpenAlex", async () => {
    const calls: string[] = [];
    const page = (works: ReferencePage["works"]): ReferencePage => ({ works, total: works.length });
    const stub = (crossref: () => Promise<ReferencePage | undefined>): GraphLookup =>
      ({
        crossrefReferences: async () => {
          calls.push("crossref");
          return crossref();
        },
        openAlexReferences: async () => {
          calls.push("openalex");
          return page([{ openalex: "W1", doi: "10.1000/a", title: "A" }]);
        },
      }) as unknown as GraphLookup;

    const empty = await setup(() => stub(async () => page([])));
    put(empty, "a2020", { DOI: "10.1000/x" });
    const viaOpenAlex = await empty.call<Refs>("graph.references", { citekey: "a2020" });
    expect(viaOpenAlex.source).toBe("openalex");
    expect(calls).toEqual(["crossref", "openalex"]);

    calls.length = 0;
    const failing = await setup(() =>
      stub(async () => {
        throw new Error("crossref: HTTP 503");
      }),
    );
    put(failing, "b2020", { DOI: "10.1000/y" });
    const afterFailure = await failing.call<Refs>("graph.references", { citekey: "b2020" });
    expect(afterFailure.source).toBe("openalex");
    expect(afterFailure.errors).toEqual(["crossref: crossref: HTTP 503"]);
  });

  it("asks for a DOI when there is nothing to look up", async () => {
    const e = await setup();
    put(e, "nodoi2020");
    await expect(e.call("graph.references", { citekey: "nodoi2020" })).rejects.toMatchObject({
      detail: { code: "NO_REFERENCE_SOURCE" },
    });
  });
});

describe("graph.citing", () => {
  it("lists citing works with the library state and a cursor for the next page", async () => {
    const e = await setup();
    put(e, "wakefield1998", { DOI: WAKEFIELD });
    put(e, "higgins2011", {
      DOI: "10.1016/j.jclinepi.2010.07.015",
      ids: { openalex: "W2135400982" },
    });
    const out = await e.call<{
      total: number;
      citing: Marked[];
      next?: string;
      counts: { library: number; inbox: number; new: number };
    }>("graph.citing", { citekey: "wakefield1998", limit: 5 });
    expect(out.total).toBeGreaterThan(1000);
    expect(out.citing).toHaveLength(5);
    expect(out.citing[0]).toMatchObject({
      openalex: "W2135400982",
      status: "library",
      citekey: "higgins2011",
    });
    expect(out.counts).toEqual({ library: 1, inbox: 0, new: 4 });
    expect(out.next).toBeTruthy();
  });
});

describe("graph.related", () => {
  it("answers both directions through one operation", async () => {
    const e = await setup();
    put(e, "wakefield1998", { DOI: WAKEFIELD });
    const refs = await e.call<Refs>("graph.references", { citekey: "wakefield1998" });
    const related = await e.call<{
      direction: string;
      source?: string;
      total: number;
      works: Marked[];
      counts: Refs["counts"];
    }>("graph.related", { citekey: "wakefield1998", direction: "references", limit: 200 });
    expect(related.direction).toBe("references");
    expect(related.source).toBe("crossref");
    expect(related.total).toBe(refs.total);
    expect(related.works).toEqual(refs.references);
    expect(related.counts).toEqual(refs.counts);

    const citing = await e.call<{ direction: string; works: Marked[]; next?: string }>(
      "graph.related",
      { citekey: "wakefield1998", direction: "citing", limit: 5 },
    );
    expect(citing.direction).toBe("citing");
    expect(citing.works).toHaveLength(5);
    expect(citing.next).toBeTruthy();
  });
});

describe("graph.addCandidates", () => {
  const added: Array<{ actor: Actor; identifier: string; target: string; why?: string }> = [];
  const fakeLookup = {
    openAlexDoi: async (id: string) => (id === "W7" ? "10.1000/seven" : undefined),
  } as unknown as GraphLookup;

  async function withFakeAdd() {
    added.length = 0;
    const base = await createTestEnv();
    const graph = bindGraphOperations(base.registry, base.lib, {
      lookup: fakeLookup,
      addItem: async (actor, input) => {
        added.push({
          actor,
          identifier: input.identifier,
          target: input.target,
          ...(input.why ? { why: input.why } : {}),
        });
        if (input.identifier.includes("dup")) {
          return { citekey: "old2020", job: "j_01JB8Z3QK7ABCDEFGH", duplicateOf: "old2020" };
        }
        if (input.identifier.includes("boom")) throw new Error("kaputt");
        return { citekey: "new2020", job: "j_01JB8Z3QK7ABCDEFGH" };
      },
    });
    envs.push({ lib: base.lib, svc: base.svc, graph });
    return base;
  }

  it("adds each candidate to the inbox with a note, once", async () => {
    const e = await withFakeAdd();
    const out = await e.call<{
      results: Array<{ identifier: string; status: string; reason?: string }>;
      added: number;
      duplicates: number;
      failed: number;
    }>(
      "graph.addCandidates",
      {
        from: "wakefield1998",
        via: "references",
        candidates: [
          { doi: "10.1000/fresh" },
          { doi: "10.1000/FRESH" },
          { arxiv: "1706.03762" },
          { openalex: "W7" },
          { openalex: "W8" },
          { doi: "10.1000/dup" },
          { doi: "10.1000/boom" },
        ],
      },
      "agent:claude-code",
    );
    expect(added.map((a) => a.identifier)).toEqual([
      "10.1000/fresh",
      "arXiv:1706.03762",
      "10.1000/seven",
      "10.1000/dup",
      "10.1000/boom",
    ]);
    expect(added.every((a) => a.target === "inbox" && a.actor === "agent:claude-code")).toBe(true);
    expect(added[0]?.why).toBe("cited by wakefield1998");
    expect(out).toMatchObject({ added: 3, duplicates: 1, failed: 2 });
    expect(out.results.filter((r) => r.status === "failed").map((r) => r.reason)).toEqual([
      "OpenAlex lists no DOI for this work, so there is nothing to look it up by",
      "Error: kaputt",
    ]);
  });

  it("runs as system for a human, so that the works wait in the inbox", async () => {
    const e = await withFakeAdd();
    await e.call("graph.addCandidates", {
      from: "wakefield1998",
      via: "citing",
      candidates: [{ doi: "10.1000/fresh" }],
    });
    expect(added[0]).toMatchObject({ actor: "system", why: "cites wakefield1998" });
  });

  it("rejects a candidate without any identifier", async () => {
    const e = await withFakeAdd();
    await expect(
      e.call("graph.addCandidates", { candidates: [{ title: "No identifier" }] }),
    ).rejects.toThrow();
  });

  it("lands recorded papers in the inbox through the real ingest pipeline", async () => {
    const e = await setup();
    const out = await e.call<{
      results: Array<{ status: string; citekey?: string; job?: string }>;
      added: number;
    }>("graph.addCandidates", {
      from: "wakefield1998",
      via: "references",
      candidates: [{ doi: NUMPY }, { arxiv: "1706.03762" }],
    });
    expect(out.added).toBe(2);
    for (const r of out.results) await e.svc.queue.waitFor(r.job ?? "");
    const numpy = e.lib.getItem(out.results[0]?.citekey ?? "").frontmatter;
    expect(numpy.DOI).toBe(NUMPY);
    expect(numpy.inbox).toMatchObject({ by: "system", why: "cited by wakefield1998" });
    const again = await e.call<{ results: Array<{ status: string; citekey?: string }> }>(
      "graph.addCandidates",
      { candidates: [{ doi: NUMPY }] },
    );
    expect(again.results[0]).toMatchObject({
      status: "duplicate",
      citekey: out.results[0]?.citekey,
    });
  });

  it("downloads the open-access PDF that Unpaywall names", async () => {
    const e = await setup();
    const out = await e.call<{ results: Array<{ citekey?: string; job?: string }> }>(
      "graph.addCandidates",
      { candidates: [{ doi: NUMPY }] },
    );
    await e.svc.queue.waitFor(out.results[0]?.job ?? "");
    expect(e.fetch.log.urls).toContain("https://www.nature.com/articles/s41586-020-2649-2.pdf");
    const fm = e.lib.getItem(out.results[0]?.citekey ?? "").frontmatter;
    expect(fm.sources[0]).toMatchObject({
      kind: "pdf",
      url: "https://www.nature.com/articles/s41586-020-2649-2.pdf",
    });
  });
});

describe("items.checkRetractions", () => {
  it("stores a retraction marker for a known retracted DOI and exposes it", async () => {
    const e = await setup();
    put(e, "wakefield1998", { DOI: WAKEFIELD });
    put(e, "harris2020", { DOI: NUMPY });
    put(e, "nodoi2020");
    put(e, "vaswani2017", { DOI: "10.48550/arxiv.1706.03762" });

    const out = await e.call<{
      checked: number;
      skipped: number;
      flagged: Array<{ citekey: string; status: string; changed: boolean; notices: unknown[] }>;
      cleared: string[];
      errors: unknown[];
    }>("items.checkRetractions", {
      citekeys: ["wakefield1998", "harris2020", "nodoi2020", "vaswani2017"],
    });
    expect(out).toMatchObject({ checked: 2, skipped: 2, cleared: [], errors: [] });
    expect(out.flagged).toHaveLength(1);
    expect(out.flagged[0]).toMatchObject({
      citekey: "wakefield1998",
      status: "retracted",
      changed: true,
    });

    const fm = frontmatter(e, "wakefield1998");
    expect(fm.retraction).toMatchObject({
      status: "retracted",
      checked: "2026-10-23",
      notices: [
        { kind: "correction", date: "2004-03-06", source: "retraction-watch" },
        { kind: "retraction", date: "2010-02-06", doi: "10.1016/s0140-6736(10)60175-4" },
      ],
    });
    expect((fm.provenance as Record<string, string>).retraction).toBe("crossref@2026-10-23");
    expect(frontmatter(e, "harris2020").retraction).toBeUndefined();

    // Exposed through items.get, the reader's banner and the library report.
    const got = await e.call<{ frontmatter: Record<string, unknown> }>("items.get", {
      citekey: "wakefield1998",
    });
    expect(retractionOf(got.frontmatter)?.status).toBe("retracted");
    expect(listFlagged(e.lib)).toEqual([
      { citekey: "wakefield1998", title: "Title of wakefield1998", status: "retracted" },
    ]);
  });

  it("leaves an unchanged marker alone and removes one that Crossref no longer lists", async () => {
    let notices: Array<Record<string, unknown>> = [
      { kind: "correction", label: "Correction", date: "2004-03-06", source: "publisher" },
    ];
    let known = true;
    const e = await setup(
      () =>
        ({
          retractionStatus: async (doi: string) => ({
            doi,
            known,
            notices,
            noticeFor: [],
            checkedAt: "2026-10-24",
          }),
        }) as unknown as GraphLookup,
    );
    put(e, "a2020", { DOI: "10.1000/a" });

    const first = await e.call<{ flagged: Array<{ status: string; changed: boolean }> }>(
      "items.checkRetractions",
      { citekeys: ["a2020"] },
    );
    expect(first.flagged).toEqual([
      expect.objectContaining({ status: "corrected", changed: true }),
    ]);
    const modified = frontmatter(e, "a2020").modified;

    const second = await e.call<{ flagged: Array<{ changed: boolean }> }>(
      "items.checkRetractions",
      { citekeys: ["a2020"] },
    );
    expect(second.flagged).toEqual([expect.objectContaining({ changed: false })]);
    expect(frontmatter(e, "a2020").modified).toEqual(modified);

    // A worse notice replaces the marker.
    notices = [...notices, { kind: "retraction", date: "2020-01-01", source: "publisher" }];
    const third = await e.call<{ flagged: Array<{ status: string; changed: boolean }> }>(
      "items.checkRetractions",
      { citekeys: ["a2020"] },
    );
    expect(third.flagged[0]).toMatchObject({ status: "retracted", changed: true });

    // A DOI no source knows says nothing: the marker stays.
    known = false;
    notices = [];
    await e.call("items.checkRetractions", { citekeys: ["a2020"] });
    expect(retractionOf(frontmatter(e, "a2020"))?.status).toBe("retracted");

    known = true;
    const cleared = await e.call<{ cleared: string[]; flagged: unknown[] }>(
      "items.checkRetractions",
      { citekeys: ["a2020"] },
    );
    expect(cleared).toMatchObject({ cleared: ["a2020"], flagged: [] });
    const fm = frontmatter(e, "a2020");
    expect(fm.retraction).toBeUndefined();
    expect((fm.provenance as Record<string, string>).retraction).toBeUndefined();
  });

  it("reports a failing lookup per item and checks the rest", async () => {
    const e = await setup(
      () =>
        ({
          retractionStatus: async (doi: string) => {
            if (doi === "10.1000/bad") throw new Error("HTTP 503");
            return { doi, known: true, notices: [], noticeFor: [], checkedAt: "2026-10-24" };
          },
        }) as unknown as GraphLookup,
    );
    put(e, "bad2020", { DOI: "10.1000/bad" });
    put(e, "good2020", { DOI: "10.1000/good" });
    const out = await e.call<{
      checked: number;
      errors: Array<{ citekey: string; message: string }>;
    }>("items.checkRetractions", { citekeys: ["bad2020", "good2020"] });
    expect(out.checked).toBe(1);
    expect(out.errors).toEqual([{ citekey: "bad2020", message: "HTTP 503" }]);
  });

  it("checks the whole library as a job when no citekeys are given", async () => {
    const e = await setup();
    put(e, "wakefield1998", { DOI: WAKEFIELD });
    put(e, "harris2020", { DOI: NUMPY });
    const out = await e.call<{ job?: string; checked: number }>("items.checkRetractions", {});
    expect(out.job).toMatch(/^j_/);
    const job = await e.svc.queue.waitFor(out.job ?? "");
    expect(job.status).toBe("succeeded");
    expect(job.result).toMatchObject({ retractions: { checked: 2, flagged: 1, changed: 1 } });
    expect(retractionOf(frontmatter(e, "wakefield1998"))?.status).toBe("retracted");
  });

  it("refuses unknown citekeys", async () => {
    const e = await setup();
    await expect(
      e.call("items.checkRetractions", { citekeys: ["nobody2020"] }),
    ).rejects.toMatchObject({ detail: { code: "ITEM_NOT_FOUND" } });
  });
});

describe("preprint and published version", () => {
  const ARXIV_ID = "1207.7214";
  const PUBLISHED = "10.1016/j.physletb.2012.08.020";

  it("links the preprint and the article when the library holds both", async () => {
    const e = await setup();
    put(e, "atlas2012arxiv", { type: "article", ids: { arxiv: ARXIV_ID } });
    put(e, "atlas2012", { DOI: PUBLISHED });

    const report = await e.graph.linkVersions("human");
    // The article is looked at first (items run in citekey order): OpenAlex lists the arXiv copy.
    expect(report.linked).toEqual([
      { preprint: "atlas2012arxiv", published: "atlas2012", source: "openalex" },
    ]);
    expect(frontmatter(e, "atlas2012arxiv").versions).toEqual([
      { item: "[[atlas2012]]", relation: "preprint-of", doi: PUBLISHED, source: "openalex" },
    ]);
    expect(frontmatter(e, "atlas2012").versions).toEqual([
      { item: "[[atlas2012arxiv]]", relation: "has-preprint", arxiv: ARXIV_ID, source: "openalex" },
    ]);
    expect((frontmatter(e, "atlas2012").provenance as Record<string, string>).versions).toBe(
      "openalex@2026-10-23",
    );

    // Idempotent.
    const again = await e.graph.linkVersions("human");
    expect(again.linked).toEqual([]);
    expect(frontmatter(e, "atlas2012").versions).toHaveLength(1);

    // The link survives a rename: items.rename rewrites the wiki link.
    await e.call("items.rename", { citekey: "atlas2012", to: "atlas2012higgs" });
    expect(frontmatter(e, "atlas2012arxiv").versions).toMatchObject([
      { item: "[[atlas2012higgs]]" },
    ]);
  });

  it("names a version the library does not hold", async () => {
    const e = await setup();
    put(e, "atlas2012arxiv", { type: "article", ids: { arxiv: ARXIV_ID } });
    const report = await e.graph.linkVersions("human");
    expect(report.linked).toEqual([]);
    expect(report.available).toEqual([
      { citekey: "atlas2012arxiv", relation: "preprint-of", doi: PUBLISHED, source: "arxiv" },
    ]);
    expect(frontmatter(e, "atlas2012arxiv").versions).toBeUndefined();
  });

  it("matches a work by its arXiv id", async () => {
    const e = await setup();
    put(e, "atlas2012arxiv", { type: "article", ids: { arxiv: ARXIV_ID } });
    const { marked } = markWorks(e.lib, [{ arxiv: ARXIV_ID }, { arxiv: "9999.99999" }]);
    expect(marked.map((m) => m.status)).toEqual(["library", "new"]);
  });
});

describe("periodic library check", () => {
  it("runs once per interval, never twice at the same time", async () => {
    const e = await setup(
      () =>
        ({
          retractionStatus: async (doi: string) => ({
            doi,
            known: true,
            notices: [],
            noticeFor: [],
            checkedAt: "2026-10-24",
          }),
          findVersions: async () => ({ links: [], errors: [] }),
        }) as unknown as GraphLookup,
    );
    put(e, "a2020", { DOI: "10.1000/a" });
    let clock = NOW;
    const checks = scheduleLibraryChecks(e.svc.queue, e.lib, e.graph.deps.lookup, {
      now: () => clock,
      firstDelayMs: 3_600_000,
    });
    stops.push(() => checks.stop());

    const first = checks.tick();
    expect(first).toMatch(/^j_/);
    expect(checks.enqueue()).toBeUndefined();
    const done = await e.svc.queue.waitFor(first ?? "");
    expect(done).toMatchObject({
      status: "succeeded",
      by: "system",
      result: { retractions: { checked: 1 }, versions: { checked: 1, linked: 0 } },
    });

    clock = Date.parse(done.updatedAt) + 6 * 24 * 3_600_000;
    expect(checks.tick()).toBeUndefined();
    clock = Date.parse(done.updatedAt) + 8 * 24 * 3_600_000;
    const next = checks.tick();
    expect(next).toMatch(/^j_/);
    await e.svc.queue.waitFor(next ?? "");
  });
});
