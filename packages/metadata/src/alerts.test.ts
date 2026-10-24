/**
 * Alert sources, replayed from recorded HTTP responses (fixtures/metadata/http). An unknown
 * request throws, so nothing here goes online.
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AlertQuery } from "./alert-types.js";
import { FIXTURE_DIR } from "./fixture-cases.js";
import { createReplayFetch } from "./replay.js";
import { createResolver } from "./resolver.js";
import {
  arxivSearchQuery,
  openAlexAuthorFilter,
  openAlexTopicId,
  parseArxivFeed,
} from "./sources/alerts.js";

const SINCE = "2026-10-10";

function make() {
  return createResolver({
    config: { mailto: "tester@example.invalid" },
    fetch: createReplayFetch(join(FIXTURE_DIR, "http")),
    now: () => Date.parse("2026-10-24T12:00:00Z"),
    sleep: async () => {},
  });
}

describe("alert sources from recorded responses", () => {
  it("reads an arXiv category, newest first", async () => {
    const works = await make().alertWorks({
      kind: "arxiv-category",
      category: "cs.CL",
      since: SINCE,
      limit: 10,
    });
    expect(works.length).toBeGreaterThan(0);
    for (const w of works) {
      expect(w.arxiv).toMatch(/^\d{4}\.\d{4,5}$|^[a-z-]+(\.[A-Z]{2})?\/\d{7}$/);
      expect(w.title).toBeTruthy();
      expect(w.abstract).toBeTruthy();
      expect(w.published && w.published >= SINCE).toBe(true);
    }
    const dates = works.map((w) => w.published ?? "");
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it("reads an arXiv query", async () => {
    const works = await make().alertWorks({
      kind: "arxiv-query",
      query: "retrieval augmented generation",
      since: SINCE,
      limit: 10,
    });
    expect(works.length).toBeGreaterThan(0);
    expect(works[0]?.arxiv).toBeTruthy();
  });

  it.each<[string, AlertQuery]>([
    ["topic", { kind: "openalex-topic", topic: "T10181", since: SINCE, limit: 10 }],
    ["search", { kind: "openalex-search", query: "citation graph", since: SINCE, limit: 10 }],
    ["author", { kind: "author", author: "0000-0002-9322-3515", since: SINCE, limit: 10 }],
    ["citing", { kind: "cites", key: { openalex: "W2741809807" }, since: SINCE, limit: 10 }],
  ])("reads OpenAlex works for a %s", async (_name, query) => {
    const works = await make().alertWorks(query);
    expect(works.length).toBeGreaterThan(0);
    for (const w of works) {
      expect(w.openalex).toMatch(/^W\d+$/);
      expect(w.title).toBeTruthy();
      expect(w.published && w.published >= SINCE).toBe(true);
    }
    expect(works.some((w) => w.abstract)).toBe(true);
  });

  it("fails loudly on a request that was never recorded", async () => {
    await expect(
      make().alertWorks({ kind: "arxiv-category", category: "math.XX", since: SINCE, limit: 10 }),
    ).rejects.toThrow(/No recorded response/);
  });

  it("rejects a topic or author that is no OpenAlex id", async () => {
    const r = make();
    await expect(
      r.alertWorks({ kind: "openalex-topic", topic: "nlp", since: SINCE, limit: 5 }),
    ).rejects.toThrow(/no OpenAlex topic id/);
    await expect(
      r.alertWorks({ kind: "author", author: "Bengio", since: SINCE, limit: 5 }),
    ).rejects.toThrow(/no ORCID or OpenAlex author id/);
  });
});

describe("query building", () => {
  it("builds the arXiv search query", () => {
    const base = { since: SINCE, limit: 5 };
    expect(arxivSearchQuery({ ...base, kind: "arxiv-category", category: " cs.CL " })).toBe(
      "cat:cs.CL",
    );
    expect(arxivSearchQuery({ ...base, kind: "arxiv-query", query: "graph neural networks" })).toBe(
      "all:graph neural networks",
    );
    expect(
      arxivSearchQuery({ ...base, kind: "arxiv-query", query: 'ti:"graph" AND cat:cs.LG' }),
    ).toBe('ti:"graph" AND cat:cs.LG');
  });

  it("reads topic and author ids in the forms people paste", () => {
    expect(openAlexTopicId("T10181")).toBe("T10181");
    expect(openAlexTopicId("https://openalex.org/t10181")).toBe("T10181");
    expect(openAlexTopicId("nlp")).toBeUndefined();
    expect(openAlexAuthorFilter("A5086198262")).toBe("author.id:A5086198262");
    expect(openAlexAuthorFilter("https://openalex.org/A5086198262")).toBe("author.id:A5086198262");
    expect(openAlexAuthorFilter("https://orcid.org/0000-0002-9322-3515")).toBe(
      "author.orcid:0000-0002-9322-3515",
    );
    expect(openAlexAuthorFilter("Yoshua Bengio")).toBeUndefined();
  });
});

describe("parseArxivFeed", () => {
  const feed = (entries: string) =>
    `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">${entries}</feed>`;
  const entry = (id: string, published: string, extra = "") => `<entry>
    <id>http://arxiv.org/abs/${id}v2</id><published>${published}</published>
    <title>A  title
      on two lines</title><summary> An abstract. </summary>
    <author><name>Ada Lovelace</name></author><author><name>Grace Hopper</name></author>${extra}
  </entry>`;

  it("maps entries and drops the ones older than since", () => {
    const works = parseArxivFeed(
      feed(
        entry("2610.00001", "2026-10-20T10:00:00Z", "<arxiv:doi>10.1000/XYZ</arxiv:doi>") +
          entry("hep-th/9901001", "2026-10-11T10:00:00Z") +
          entry("2609.99999", "2026-10-01T10:00:00Z"),
      ),
      SINCE,
    );
    expect(works.map((w) => w.arxiv)).toEqual(["2610.00001", "hep-th/9901001"]);
    expect(works[0]).toMatchObject({
      title: "A title on two lines",
      authors: "Lovelace, Hopper",
      year: 2026,
      abstract: "An abstract.",
      published: "2026-10-20",
      doi: "10.1000/xyz",
    });
  });

  it("ignores the Error entry of a bad query and an empty feed", () => {
    expect(
      parseArxivFeed(
        feed("<entry><id>http://arxiv.org/api/errors</id><title>Error</title></entry>"),
        SINCE,
      ),
    ).toEqual([]);
    expect(parseArxivFeed(feed(""), SINCE)).toEqual([]);
  });
});
