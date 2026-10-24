import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GraphLookup, VersionResult } from "@citegeist/metadata";
import { afterEach, describe, expect, it } from "vitest";
import { GraphService } from "../graph/index.js";
import { Library } from "../library.js";
import { cleanTmpDirs, itemData, tmpDir } from "../test-helpers.js";
import {
  checkPreprints,
  describePreprints,
  type PreprintVersionTools,
  type RawPreprint,
  RECHECK_MS,
} from "./preprints.js";

const ARXIV = "1207.7214";
const PUBLISHED = "10.1016/j.physletb.2012.08.020";
const NOW = new Date("2026-10-24T12:00:00Z");

const libs: Library[] = [];
afterEach(async () => {
  for (const lib of libs.splice(0)) await lib.close();
  cleanTmpDirs();
});

async function library(): Promise<Library> {
  const lib = await Library.init(tmpDir("cg-pre-"), {
    localBase: tmpDir("cg-pre-local-"),
    watch: false,
  });
  libs.push(lib);
  return lib;
}

const raw = (over: Partial<RawPreprint> = {}): RawPreprint => ({
  id: `arxiv:${ARXIV}`,
  title: "Observation of a new particle",
  doi: `10.48550/arxiv.${ARXIV}`,
  arxiv_id: ARXIV,
  origins: ["run:r1"],
  ...over,
});

/** Tools with a scripted `findVersions`; `resolved` lists the DOIs the metadata resolver finds. */
function tools(
  lib: Library,
  version: (key: { doi?: string; arxiv?: string }) => VersionResult,
  resolved: Record<string, { venue: string; issued: number }> = {},
): PreprintVersionTools & { calls: number } {
  const lookup = {
    findVersions: async (key: { doi?: string; arxiv?: string }) => {
      out.calls++;
      return version(key);
    },
  } as unknown as GraphLookup;
  const graph = new GraphService(lib, {
    lookup,
    addItem: () => Promise.reject(new Error("not used")),
  });
  const out = {
    calls: 0,
    lookup,
    link: (actor: "human", citekeys: string[]) => graph.linkVersions(actor, citekeys),
    resolve: async (doi: string) => {
      const hit = resolved[doi];
      return hit
        ? {
            status: "resolved" as const,
            fields: { DOI: doi, "container-title": hit.venue, issued: hit.issued },
          }
        : { status: "not-found" as const, fields: {} };
    },
  };
  return out;
}

const names = (lib: Library) =>
  existsSync(join(lib.paths.litsearchWatchesDir, "preprint-checks.json"));
const cache = (lib: Library): Record<string, unknown> =>
  JSON.parse(readFileSync(join(lib.paths.litsearchWatchesDir, "preprint-checks.json"), "utf8"));
const opts = (force: boolean, now = NOW) => ({ force, now });

describe("published versions of tracked preprints", () => {
  it("reads the relation from the library graph when the library holds both versions", async () => {
    // protects: one source of truth, a preprint the library links to its article shows that article, from the graph
    // fails_when: the preprint tab keeps its own copy of the relation, or ignores the graph link
    // no_claim: which sources find the link (that is covered by the graph tests)
    const lib = await library();
    lib.writeItem(itemData("atlas2012arxiv", { type: "article", ids: { arxiv: ARXIV } }));
    lib.writeItem(
      itemData("atlas2012", {
        type: "article-journal",
        DOI: PUBLISHED,
        "container-title": "Physics Letters B",
        issued: 2012,
      }),
    );
    const t = tools(lib, (key) => ({
      links: key.arxiv ? [{ relation: "preprint-of", doi: PUBLISHED, source: "arxiv" }] : [],
      errors: [],
    }));
    const result = await checkPreprints(lib, t, "human", [raw()], opts(true));
    expect(result).toMatchObject({ checked: 1, published: [`arxiv:${ARXIV}`], errors: [] });
    const { preprints, lastCheck } = describePreprints(lib, [raw()]);
    expect(preprints[0]).toMatchObject({
      status: "published",
      published: { doi: PUBLISHED, venue: "Physics Letters B", year: 2012 },
    });
    expect(lastCheck).toBe(NOW.toISOString());
    // The cache holds no copy of the relation.
    expect(cache(lib)[`arxiv:${ARXIV}`]).toEqual({ checked: NOW.toISOString() });
  });

  it("looks up a preprint outside the library with the same detection and keeps the result", async () => {
    // protects: tracked preprints that are not library items still get "inzwischen erschienen in ..."
    // fails_when: the lookup is not findVersions, an unresolvable DOI counts as published, or a recent check is repeated
    // no_claim: the network sources behind findVersions
    const lib = await library();
    const t = tools(
      lib,
      () => ({ links: [{ relation: "preprint-of", doi: PUBLISHED, source: "arxiv" }], errors: [] }),
      { [PUBLISHED]: { venue: "Physics Letters B", issued: 2012 } },
    );
    const result = await checkPreprints(lib, t, "human", [raw()], opts(false));
    expect(result.published).toEqual([`arxiv:${ARXIV}`]);
    const { preprints, lastCheck } = describePreprints(lib, [raw()]);
    expect(preprints[0]).toMatchObject({
      status: "published",
      published: { doi: PUBLISHED, venue: "Physics Letters B", year: 2012 },
      checked: NOW.toISOString(),
    });
    expect(lastCheck).toBe(NOW.toISOString());
    // A published preprint is not looked up again; neither is one checked a day ago.
    await checkPreprints(
      lib,
      t,
      "human",
      [raw()],
      opts(false, new Date(NOW.getTime() + RECHECK_MS)),
    );
    expect(t.calls).toBe(1);
  });

  it("does not count a DOI the resolver cannot find", async () => {
    // protects: a wrong DOI in one source (OpenAlex merges works) does not mark a preprint as published
    // fails_when: a link without a resolvable DOI turns the preprint into a published one
    // no_claim: DOIs that resolve to an unrelated work
    const lib = await library();
    const t = tools(lib, () => ({
      links: [{ relation: "preprint-of", doi: "10.1000/junk", source: "openalex" }],
      errors: [],
    }));
    const result = await checkPreprints(lib, t, "human", [raw()], opts(true));
    expect(result).toMatchObject({ checked: 1, published: [] });
    expect(describePreprints(lib, [raw()]).preprints[0]).toMatchObject({ status: "preprint" });
  });

  it("keeps the published version of a library preprint whose article the library lacks", async () => {
    // protects: a preprint in the library with an article outside it still shows the article
    // fails_when: linkVersions' "available" version is dropped for library preprints
    // no_claim: adding the article to the library
    const lib = await library();
    lib.writeItem(itemData("atlas2012arxiv", { type: "article", ids: { arxiv: ARXIV } }));
    const t = tools(
      lib,
      () => ({ links: [{ relation: "preprint-of", doi: PUBLISHED, source: "arxiv" }], errors: [] }),
      { [PUBLISHED]: { venue: "Physics Letters B", issued: 2012 } },
    );
    const result = await checkPreprints(lib, t, "human", [raw()], opts(true));
    expect(result.published).toEqual([`arxiv:${ARXIV}`]);
    expect(describePreprints(lib, [raw()]).preprints[0]).toMatchObject({
      status: "published",
      published: { doi: PUBLISHED },
    });
  });

  it("checks again later when a source failed, and reports the failure", async () => {
    // protects: a rate-limited source does not mark a preprint as checked
    // fails_when: an error with no link sets "checked", so the preprint waits a week for the next try
    // no_claim: the retry policy of the HTTP layer
    const lib = await library();
    const failing = tools(lib, () => ({ links: [], errors: ["crossref: HTTP 503"] }));
    const result = await checkPreprints(lib, failing, "human", [raw()], opts(false));
    expect(result.errors).toEqual([{ id: `arxiv:${ARXIV}`, message: "crossref: HTTP 503" }]);
    expect(names(lib)).toBe(true);
    expect(describePreprints(lib, [raw()]).lastCheck).toBeUndefined();
    const healthy = tools(lib, () => ({ links: [], errors: [] }));
    await checkPreprints(lib, healthy, "human", [raw()], opts(false));
    expect(healthy.calls).toBe(1);
  });

  it("shows OpenReview acceptance only while nothing is published", async () => {
    // protects: the accepted group survives; a published version wins over an acceptance
    // fails_when: an accepted preprint with a DOI stays in the accepted group
    // no_claim: how preprints.py finds the OpenReview decision
    const lib = await library();
    const accepted = raw({ openreview: { status: "accepted", venue: "ICLR 2026" } });
    expect(describePreprints(lib, [accepted]).preprints[0]).toMatchObject({
      status: "accepted",
      acceptedAt: "ICLR 2026",
    });
    const t = tools(
      lib,
      () => ({ links: [{ relation: "preprint-of", doi: PUBLISHED, source: "arxiv" }], errors: [] }),
      { [PUBLISHED]: { venue: "Physics Letters B", issued: 2012 } },
    );
    await checkPreprints(lib, t, "human", [accepted], opts(true));
    const [only] = describePreprints(lib, [accepted]).preprints;
    expect(only?.status).toBe("published");
    expect(only?.acceptedAt).toBeUndefined();
  });
});
