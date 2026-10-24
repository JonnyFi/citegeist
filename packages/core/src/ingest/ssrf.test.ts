import type { FetchLike } from "@citegeist/metadata";
import { afterEach, describe, expect, it } from "vitest";
import { cleanTmpDirs } from "../test-helpers.js";
import { createTestEnv, type RemoteLog, type TestEnv, testFetch } from "./testing.js";

// M5: downloads that an agent starts only reach public servers. Every hop is checked, a name that
// resolves to a private address is refused, and the body is read with a size limit.

let envs: TestEnv[] = [];
afterEach(async () => {
  for (const e of envs) {
    await e.svc.close();
    await e.lib.close();
  }
  envs = [];
  cleanTmpDirs();
});

const PAGE = "<html><head><title>A Public Page</title></head><body>Text</body></html>";
const FORBIDDEN = { detail: { code: "URL_NOT_PUBLIC" } };

/** A network with a few hosts: redirects, a page and a big file. Records what was requested. */
function network(): FetchLike & { log: RemoteLog } {
  const log: RemoteLog = { urls: [] };
  const base = testFetch(log);
  const fn: FetchLike = async (url, init) => {
    const u = new URL(url);
    if (u.hostname === "short.example.net") {
      log.urls.push(url);
      const to = u.searchParams.get("to") ?? "";
      return new Response(null, { status: 302, headers: { location: to } });
    }
    if (u.hostname === "pages.example.net") {
      log.urls.push(url);
      return new Response(PAGE, { status: 200, headers: { "content-type": "text/html" } });
    }
    if (u.hostname === "big.example.net") {
      log.urls.push(url);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let i = 0; i < 20; i++) controller.enqueue(new Uint8Array(1024));
          controller.close();
        },
      });
      // No content-length: only the stream limit can stop it.
      return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    }
    if (u.hostname === "127.0.0.1" || u.hostname === "169.254.169.254") {
      log.urls.push(url);
      return new Response(PAGE, { status: 200, headers: { "content-type": "text/html" } });
    }
    return base(url, init);
  };
  return Object.assign(fn, { log });
}

async function env(deps: Parameters<typeof createTestEnv>[0] = {}): Promise<TestEnv> {
  const fetch = network();
  const e = await createTestEnv({ fetch, ...deps });
  envs.push(e);
  return e;
}

describe("downloads of agents", () => {
  it("refuses an address on this Mac or a private network without a request", async () => {
    const e = await env();
    for (const identifier of [
      "http://127.0.0.1:8080/secret.html",
      "http://169.254.169.254/latest/meta-data/",
      "http://localhost/x",
      "http://192.168.1.10/index.html",
      "http://[::1]/x",
    ]) {
      await expect(e.call("items.add", { identifier }, "agent:grok")).rejects.toMatchObject(
        FORBIDDEN,
      );
    }
    expect(e.fetch.log.urls).toEqual([]);
  });

  it("refuses a redirect from a public page to a private address", async () => {
    const e = await env();
    const to = encodeURIComponent("http://169.254.169.254/latest/meta-data/");
    await expect(
      e.call("items.add", { identifier: `https://short.example.net/r?to=${to}` }, "agent:grok"),
    ).rejects.toMatchObject(FORBIDDEN);
    // The public hop was requested, the metadata address was not.
    expect(e.fetch.log.urls).toEqual([`https://short.example.net/r?to=${to}`]);
  });

  it("follows a redirect between public pages", async () => {
    const e = await env();
    const to = encodeURIComponent("https://pages.example.net/paper");
    const out = await e.call<{ citekey: string }>(
      "items.add",
      { identifier: `https://short.example.net/r?to=${to}` },
      "agent:grok",
    );
    expect(out.citekey).toBeTruthy();
    expect(e.fetch.log.urls).toContain("https://pages.example.net/paper");
  });

  it("refuses a public name that resolves to a private address", async () => {
    const e = await env({
      deps: {
        resolveHost: async (host) =>
          host === "rebind.example.net" ? ["10.1.2.3"] : ["93.184.216.34"],
      },
    });
    await expect(
      e.call("items.add", { identifier: "https://rebind.example.net/x" }, "agent:grok"),
    ).rejects.toMatchObject(FORBIDDEN);
    expect(e.fetch.log.urls).toEqual([]);
    // A name that resolves to a public address passes.
    const ok = await e.call<{ citekey: string }>(
      "items.add",
      { identifier: "https://pages.example.net/ok" },
      "agent:grok",
    );
    expect(ok.citekey).toBeTruthy();
  });

  it("leaves the human free to fetch an address in the local network", async () => {
    const e = await env();
    const out = await e.call<{ citekey: string }>("items.add", {
      identifier: "http://127.0.0.1:8080/intranet.html",
    });
    expect(out.citekey).toBeTruthy();
    expect(e.fetch.log.urls).toEqual(["http://127.0.0.1:8080/intranet.html"]);
  });
});

describe("the size limit", () => {
  it("stops reading a body without Content-Length once it passes the limit", async () => {
    const e = await env({ deps: { maxDownloadBytes: 4096 } });
    await expect(
      e.call("items.add", { identifier: "https://big.example.net/huge.html" }),
    ).rejects.toMatchObject({ detail: { code: "URL_UNREACHABLE" } });
  });

  it("accepts a body below the limit", async () => {
    const e = await env({ deps: { maxDownloadBytes: 1024 * 1024 } });
    const out = await e.call<{ citekey: string }>("items.add", {
      identifier: "https://pages.example.net/small",
    });
    expect(out.citekey).toBeTruthy();
  });
});
