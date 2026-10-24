/**
 * Records the HTTP fixtures of the graph, retraction, version, PubMed and Unpaywall sources.
 * Skipped unless CITEGEIST_RECORD=1 (pnpm --filter @citegeist/metadata record). The recorder
 * uses a no-reply address; mailto, email, tool and api_key are stripped from fixture keys anyway.
 */

import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { FIXTURE_DIR } from "./fixture-cases.js";
import {
  ARXIV_PREPRINT,
  ARXIV_PUBLISHED_DOI,
  ARXIV_WITH_JOURNAL,
  CLEAN_OA_DOI,
  CLOSED_DOI,
  DATACITE_DOI,
  PMID_WITHOUT_DOI,
  PREPRINT_DOI,
  PUBLISHED_WITH_PREPRINT_DOI,
  RETRACTED_DOI,
  RETRACTED_PMID,
  UNKNOWN_DOI,
} from "./graph-cases.js";
import type { FetchLike } from "./http.js";
import { createRecordingFetch, createReplayFetch, fixtureName } from "./replay.js";
import { createResolver } from "./resolver.js";

const enabled = process.env.CITEGEIST_RECORD === "1";
const log = (...args: unknown[]): void => {
  appendFileSync(
    "/tmp/citegeist-record.log",
    `${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}\n`,
  );
};

describe.skipIf(!enabled)("record graph fixtures", () => {
  it("records every graph case", async () => {
    const dir = join(FIXTURE_DIR, "http");
    const recording = createRecordingFetch(dir);
    // Requests that already have a fixture are not recorded again: other tests depend on them.
    const fetch: FetchLike = async (input, init) => {
      const accept = new Headers(init?.headers).get("accept") ?? "";
      if (existsSync(join(dir, fixtureName(input, accept)))) {
        return createReplayFetch(dir)(input, init);
      }
      return recording(input, init);
    };
    const resolver = createResolver({
      fetch,
      config: { mailto: "citegeist-fixtures@users.noreply.github.com" },
    });
    for (const pmid of [RETRACTED_PMID, PMID_WITHOUT_DOI]) {
      log("pmid", pmid, (await resolver.resolve(`PMID: ${pmid}`)).status);
    }
    for (const doi of [CLEAN_OA_DOI, CLOSED_DOI, DATACITE_DOI]) {
      log("oa", doi, await resolver.findOpenAccess(doi));
    }
    for (const doi of [RETRACTED_DOI, CLEAN_OA_DOI, UNKNOWN_DOI]) {
      const s = await resolver.retractionStatus(doi);
      log("retraction", doi, s.known, s.notices);
    }
    const refs = await resolver.crossrefReferences(RETRACTED_DOI, 50);
    log("crossref refs", refs?.total);
    const oaRefs = await resolver.openAlexReferences({ doi: RETRACTED_DOI }, 50);
    log("openalex refs", oaRefs?.total, oaRefs?.works.slice(0, 2));
    const citing = await resolver.openAlexCiting({ doi: RETRACTED_DOI }, { limit: 5 });
    log(
      "citing",
      citing?.total,
      citing?.works.map((w) => w.openalex),
    );
    const first = citing?.works.find((w) => w.openalex);
    if (first?.openalex) {
      log("doi of", first.openalex, await resolver.openAlexDoi(first.openalex));
    }
    for (const key of [
      { arxiv: ARXIV_PREPRINT },
      { arxiv: ARXIV_WITH_JOURNAL },
      { doi: ARXIV_PUBLISHED_DOI },
      { doi: PREPRINT_DOI },
      { doi: PUBLISHED_WITH_PREPRINT_DOI },
    ]) {
      log("versions", key, JSON.stringify(await resolver.findVersions(key)));
    }
  }, 300_000);
});
