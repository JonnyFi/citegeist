import { describe, expect, it } from "vitest";
import { cacheKey, HttpClient, keyUrl, MemoryHttpCache } from "./http.js";
import { SourceError } from "./types.js";

function harness(
  responder: (url: string, n: number) => Response | Promise<Response>,
  options: ConstructorParameters<typeof HttpClient>[0] = {},
) {
  let clock = 1_000_000;
  const calls: Array<{ url: string; at: number; headers: Headers }> = [];
  const sleeps: number[] = [];
  let active = 0;
  let maxActive = 0;
  const client = new HttpClient({
    fetch: async (url, init) => {
      active++;
      maxActive = Math.max(maxActive, active);
      calls.push({ url, at: clock, headers: new Headers(init?.headers) });
      // Simulated latency so overlapping requests would be visible.
      await new Promise((r) => setTimeout(r, 2));
      active--;
      return responder(url, calls.length);
    },
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    random: () => 0.5,
    ...options,
  });
  return { client, calls, sleeps, maxActive: () => maxActive };
}

const ok = (body = "{}") => new Response(body, { status: 200 });

describe("cache", () => {
  it("serves the second identical request from the cache", async () => {
    const h = harness(() => ok("a"));
    const first = await h.client.get({ source: "crossref", url: "https://x.test/a" });
    const second = await h.client.get({ source: "crossref", url: "https://x.test/a" });
    expect(h.calls).toHaveLength(1);
    expect(first.fromCache).toBe(false);
    expect(second).toMatchObject({ fromCache: true, body: "a" });
  });

  it("ignores mailto and API keys in the cache key", async () => {
    expect(keyUrl("https://x.test/a?mailto=me%40example.org&api_key=secret&b=1")).toBe(
      "https://x.test/a?b=1",
    );
    expect(cacheKey("s", "https://x.test/a?mailto=a")).toBe(cacheKey("s", "https://x.test/a"));
    const h = harness(() => ok("a"));
    await h.client.get({ source: "crossref", url: "https://x.test/a?mailto=one%40example.org" });
    await h.client.get({ source: "crossref", url: "https://x.test/a?mailto=two%40example.org" });
    expect(h.calls).toHaveLength(1);
  });

  it("caches 404 but not server errors", async () => {
    const h = harness((url) => new Response("", { status: url.endsWith("/missing") ? 404 : 400 }));
    await h.client.get({ source: "crossref", url: "https://x.test/missing" });
    await h.client.get({ source: "crossref", url: "https://x.test/missing" });
    expect(h.calls).toHaveLength(1);
    await h.client.get({ source: "crossref", url: "https://x.test/bad" });
    await h.client.get({ source: "crossref", url: "https://x.test/bad" });
    expect(h.calls).toHaveLength(3);
  });

  it("expires entries after the ttl", async () => {
    const cache = new MemoryHttpCache();
    const h = harness(() => ok("x"), { cache });
    await h.client.get({ source: "crossref", url: "https://x.test/a", ttlMs: 1000 });
    // Ten rate-limited requests on other URLs advance the fake clock past the ttl.
    for (let i = 0; i < 10; i++) {
      await h.client.get({ source: "crossref", url: `https://x.test/other${i}` });
    }
    await h.client.get({ source: "crossref", url: "https://x.test/a", ttlMs: 1000 });
    expect(h.calls.filter((c) => c.url === "https://x.test/a")).toHaveLength(2);
  });
});

describe("rate limits", () => {
  it("spaces arXiv requests by at least three seconds", async () => {
    const h = harness(() => ok("<feed/>"));
    await Promise.all(
      ["1", "2", "3"].map((id) =>
        h.client.get({ source: "arxiv", url: `https://export.arxiv.org/api/query?id_list=${id}` }),
      ),
    );
    const times = h.calls.map((c) => c.at);
    const gaps = times.slice(1).map((t, i) => t - (times[i] ?? 0));
    expect(gaps).toHaveLength(2);
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(3000);
  });

  it("runs one request at a time when concurrency is 1", async () => {
    const h = harness(() => ok(), { limits: { crossref: { minIntervalMs: 0, concurrency: 1 } } });
    await Promise.all(
      [1, 2, 3, 4].map((i) => h.client.get({ source: "crossref", url: `https://x.test/${i}` })),
    );
    expect(h.maxActive()).toBe(1);
  });

  it("keeps separate buckets per source", async () => {
    const h = harness(() => ok());
    await h.client.get({ source: "arxiv", url: "https://export.arxiv.org/api/query?id_list=1" });
    await h.client.get({ source: "dnb", url: "https://services.dnb.de/sru/dnb?x=1" });
    expect(h.sleeps).toEqual([]);
  });
});

describe("retries", () => {
  it("retries 503 with exponential backoff and returns the later success", async () => {
    const h = harness((_, n) => (n < 3 ? new Response("", { status: 503 }) : ok("done")));
    const res = await h.client.get({ source: "openalex", url: "https://x.test/r" });
    expect(res.body).toBe("done");
    expect(h.calls).toHaveLength(3);
    // base 1000 ms, factor 2, jitter 0.75 + 0.5 * 0.5 = 1.0
    expect(h.sleeps.filter((s) => s >= 1000)).toEqual([1000, 2000]);
  });

  it("honours Retry-After on 429", async () => {
    const h = harness((_, n) =>
      n === 1 ? new Response("", { status: 429, headers: { "retry-after": "7" } }) : ok("late"),
    );
    const res = await h.client.get({ source: "openalex", url: "https://x.test/r" });
    expect(res.body).toBe("late");
    expect(Math.max(...h.sleeps)).toBeGreaterThanOrEqual(7000);
  });

  it("returns the last response after the retries are used up", async () => {
    const h = harness(() => new Response("", { status: 503 }), { maxRetries: 2 });
    const res = await h.client.get({ source: "openalex", url: "https://x.test/r" });
    expect(res.status).toBe(503);
    expect(h.calls).toHaveLength(3);
  });

  it("wraps network errors in a SourceError", async () => {
    const h = harness(
      () => {
        throw new TypeError("fetch failed");
      },
      { maxRetries: 1 },
    );
    await expect(h.client.get({ source: "crossref", url: "https://x.test/n" })).rejects.toThrow(
      SourceError,
    );
  });
});

describe("request shape", () => {
  it("sends User-Agent and Accept", async () => {
    const h = harness(() => ok(), { userAgent: "citegeist/0.0.0 (mailto:me@example.org)" });
    await h.client.get({ source: "doi.org", url: "https://doi.org/x", accept: "application/json" });
    expect(h.calls[0]?.headers.get("user-agent")).toContain("citegeist/0.0.0");
    expect(h.calls[0]?.headers.get("accept")).toBe("application/json");
  });
});
