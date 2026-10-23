/**
 * Records the HTTP fixtures once. Skipped unless CITEGEIST_RECORD=1 (pnpm --filter
 * @citegeist/metadata record). CI never runs this: it needs the network.
 *
 * No mailto is configured while recording, so Crossref sees the anonymous pool and no personal
 * address can end up in a fixture. Parameters like mailto are stripped from fixture keys anyway.
 */

import { join } from "node:path";
import { describe, it } from "vitest";
import {
  ALL_INPUTS,
  FIXTURE_DIR,
  LUHMANN_QUERY,
  LUHMANN_SHORT_QUERY,
  OL_FALLBACK_ISBNS,
  TRAP_QUERIES,
} from "./fixture-cases.js";
import { createRecordingFetch } from "./replay.js";
import { createResolver } from "./resolver.js";

const enabled = process.env.CITEGEIST_RECORD === "1";

describe.skipIf(!enabled)("record fixtures", () => {
  it("records every fixture case", async () => {
    const resolver = createResolver({
      fetch: createRecordingFetch(join(FIXTURE_DIR, "http")),
    });
    for (const input of ALL_INPUTS) {
      const result = await resolver.resolve(input);
      console.log(input, result.status, result.errors);
    }
    for (const isbn of OL_FALLBACK_ISBNS) {
      const forced = createResolver({
        fetch: createRecordingFetch(join(FIXTURE_DIR, "http")),
        config: { isbnSources: ["openlibrary"] },
      });
      await forced.resolve(isbn);
    }
    for (const q of [LUHMANN_QUERY, LUHMANN_SHORT_QUERY, ...TRAP_QUERIES]) {
      await resolver.resolveByTitle(q);
    }
  }, 600_000);
});
