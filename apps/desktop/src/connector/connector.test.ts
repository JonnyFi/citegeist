// biome-ignore-all lint/suspicious/noExplicitAny: parsed JSON of recorded requests and replies
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type ConnectorHandle, ConnectorPortError, probePort, startConnector } from "./index.js";

interface Fixture {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
  bodyText?: string;
}

function fixture(name: string): Fixture {
  return JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", `${name}.json`), "utf8"));
}

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
  json: () => any;
}

/** Replays a recorded request against the listener; `override` changes headers or the path. */
async function replay(
  port: number,
  fx: Fixture,
  override: { headers?: Record<string, string | undefined>; path?: string; body?: unknown } = {},
): Promise<Reply> {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...fx.headers, ...override.headers })) {
    if (v !== undefined) headers[k] = v;
  }
  const payload =
    override.body !== undefined
      ? JSON.stringify(override.body)
      : fx.bodyText !== undefined
        ? fx.bodyText
        : fx.body !== undefined
          ? JSON.stringify(fx.body)
          : undefined;
  const res = await fetch(`http://127.0.0.1:${port}${override.path ?? fx.path}`, {
    method: fx.method,
    headers,
    ...(payload !== undefined ? { body: payload } : {}),
  });
  const text = await res.text();
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    text,
    json: () => JSON.parse(text),
  };
}

type Call = { name: string; actor: string; input: any };

const open: ConnectorHandle[] = [];
afterEach(async () => {
  for (const c of open.splice(0)) await c.close();
});

async function start(
  answer: (call: Call) => unknown = () => ({ citekey: "harris2020array", job: "j1" }),
  extra: Partial<Parameters<typeof startConnector>[0]> = {},
) {
  const calls: Call[] = [];
  const stagedFiles: Array<{ path: string; bytes: string }> = [];
  const connector = await startConnector({
    port: 0,
    libraryName: "My library",
    call: async (name, actor, raw) => {
      const input = raw as any;
      const call = { name, actor, input };
      calls.push(call);
      if (
        name === "items.add" &&
        typeof input.identifier === "string" &&
        existsSync(input.identifier)
      ) {
        stagedFiles.push({ path: input.identifier, bytes: readFileSync(input.identifier, "utf8") });
      }
      if (name === "projects.list") {
        return { projects: [{ slug: "phd-proposal", title: "PhD proposal" }] };
      }
      if (name === "items.get") {
        return { frontmatter: { projects: ["other"], tags: ["old"] } };
      }
      return answer(call);
    },
    ...extra,
  });
  open.push(connector);
  return { connector, port: connector.port, calls, stagedFiles };
}

describe("handshake", () => {
  it("answers GET /connector/ping with HTML and the version header", async () => {
    const { port } = await start();
    const res = await replay(port, fixture("ping-get"));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.headers["x-zotero-version"]).toMatch(/^\d+\.\d+\.\d+/);
    expect(res.text).toContain("Zotero is running");
  });

  it("answers POST /connector/ping with prefs that allow uploads and no translatorsHash", async () => {
    const { port } = await start();
    const res = await replay(port, fixture("ping-post"));
    expect(res.status).toBe(200);
    const prefs = res.json().prefs;
    expect(prefs.supportsAttachmentUpload).toBe(true);
    expect(prefs.downloadAssociatedFiles).toBe(true);
    expect(prefs).not.toHaveProperty("translatorsHash");
    expect(res.headers["x-zotero-version"]).toBeDefined();
  });

  it("reports filesEditable and lists the library and the projects as targets", async () => {
    const { port } = await start();
    const res = await replay(port, fixture("get-selected-collection"));
    expect(res.status).toBe(200);
    const body = res.json();
    expect(body.filesEditable).toBe(true);
    expect(body.editable).toBe(true);
    expect(body.libraryName).toBe("My library");
    expect(body.targets).toEqual([
      { id: "L1", name: "My library", filesEditable: true, level: 0 },
      { id: "Cphd-proposal", name: "PhD proposal", filesEditable: true, level: 1 },
    ]);
  });

  it("sends X-Zotero-Version on errors too, so the Connector never thinks Zotero is gone", async () => {
    const { port } = await start();
    const notFound = await replay(port, fixture("ping-post"), { path: "/connector/nope" });
    expect(notFound.status).toBe(404);
    expect(notFound.headers["x-zotero-version"]).toBeDefined();
    const refused = await replay(port, fixture("ping-post"), {
      headers: { origin: "https://evil.example" },
    });
    expect(refused.status).toBe(403);
    expect(refused.headers["x-zotero-version"]).toBeDefined();
  });

  it("answers getTranslators with an error so the extension loads translators itself", async () => {
    const { port } = await start();
    const res = await replay(port, fixture("ping-post"), { path: "/connector/getTranslators" });
    expect(res.status).toBe(501);
    expect(res.headers["x-zotero-version"]).toBeDefined();
  });
});

describe("request checks", () => {
  it("refuses a web page origin, with and without the connector header", async () => {
    const { port } = await start();
    for (const origin of ["https://evil.example", "http://localhost:3000", "null"]) {
      const res = await replay(port, fixture("ping-post"), { headers: { origin } });
      expect(res.status).toBe(403);
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    }
    const bare = await replay(port, fixture("ping-post"), {
      headers: {
        origin: "https://evil.example",
        "x-zotero-connector-api-version": undefined,
        "content-type": "text/plain",
      },
    });
    expect(bare.status).toBe(403);
  });

  it("refuses a preflight from a web page and never answers with a wildcard CORS header", async () => {
    const { port } = await start();
    const res = await fetch(`http://127.0.0.1:${port}/connector/saveItems`, {
      method: "OPTIONS",
      headers: {
        origin: "https://evil.example",
        "access-control-request-method": "POST",
        "access-control-request-headers": "x-zotero-connector-api-version",
      },
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("echoes the extension origin, never a wildcard", async () => {
    const { port } = await start();
    const res = await replay(port, fixture("ping-post"));
    expect(res.headers["access-control-allow-origin"]).toBe(
      "chrome-extension://ekhagklcjbdpajgpjgmbionohlpdbjgc",
    );
  });

  it("requires the connector header from a browser-like client without Origin", async () => {
    const { port } = await start();
    const browserLike = {
      "user-agent": "Mozilla/5.0 (Macintosh) Firefox/130.0",
      origin: undefined,
      "x-zotero-connector-api-version": undefined,
    };
    const blocked = await replay(port, fixture("ping-post"), { headers: browserLike });
    expect(blocked.status).toBe(403);
    const allowed = await replay(port, fixture("ping-post"), {
      headers: { ...browserLike, "x-zotero-connector-api-version": "3" },
    });
    expect(allowed.status).toBe(200);
  });

  it("lets a plain tool such as curl through", async () => {
    const { port } = await start();
    const res = await replay(port, fixture("ping-post"), {
      headers: {
        origin: undefined,
        "x-zotero-connector-api-version": undefined,
        "user-agent": "curl/8.7.1",
      },
    });
    expect(res.status).toBe(200);
  });

  it("refuses a foreign Host header (DNS rebinding)", async () => {
    const { port } = await start();
    const { request } = await import("node:http");
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port,
          path: "/connector/ping",
          method: "GET",
          headers: { host: "attacker.example", "x-zotero-connector-api-version": "3" },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it("binds to loopback only", async () => {
    const { port } = await start();
    const { networkInterfaces } = await import("node:os");
    const external = Object.values(networkInterfaces())
      .flat()
      .find((i) => i && !i.internal && i.family === "IPv4");
    if (!external) return;
    await expect(fetch(`http://${external.address}:${port}/connector/ping`)).rejects.toThrow();
  });
});

describe("saveItems", () => {
  it("adds the item as agent:zotero-connector, targeted at the library, with tags and a reason", async () => {
    const { port, calls } = await start();
    const res = await replay(port, fixture("save-items-journal-article"));
    expect(res.status).toBe(201);
    expect(res.json().items[0].id).toBe("Hq7xVzAq");
    const add = calls.find((c) => c.name === "items.add");
    expect(add?.actor).toBe("agent:zotero-connector");
    expect(add?.input.target).toBe("library");
    expect(add?.input.tags).toEqual(["Computational science", "Software"]);
    expect(add?.input.why).toContain("https://www.nature.com/articles/s41586-020-2649-2");
    expect(add?.input.identifier).toContain("@article{harris2020,");
    expect(add?.input.identifier).toContain("doi = {10.1038/s41586-020-2649-2},");
  });

  it("accepts text/plain bodies from Firefox", async () => {
    const { port, calls } = await start();
    const res = await replay(port, fixture("save-items-book"));
    expect(res.status).toBe(201);
    expect(calls.filter((c) => c.name === "items.add")).toHaveLength(1);
  });

  it("rejects a reused session with 409 SESSION_EXISTS", async () => {
    const { port, calls } = await start();
    await replay(port, fixture("save-items-journal-article"));
    const again = await replay(port, fixture("save-items-journal-article"));
    expect(again.status).toBe(409);
    expect(again.json().error).toBe("SESSION_EXISTS");
    expect(calls.filter((c) => c.name === "items.add")).toHaveLength(1);
  });

  it("answers 400 for a body without sessionID or items", async () => {
    const { port } = await start();
    const res = await replay(port, fixture("save-items-journal-article"), { body: { items: [] } });
    expect(res.status).toBe(400);
  });

  it("reports a failed add with the reason and frees the session for a retry", async () => {
    let fail = true;
    const { port } = await start(() => {
      if (fail) throw new Error("metadata source down");
      return { citekey: "harris2020array", job: "j1" };
    });
    const first = await replay(port, fixture("save-items-journal-article"));
    expect(first.status).toBe(500);
    expect(first.json().error).toContain("metadata source down");
    fail = false;
    const retry = await replay(port, fixture("save-items-journal-article"));
    expect(retry.status).toBe(201);
  });
});

describe("saveSnapshot", () => {
  it("adds the page by URL", async () => {
    const { port, calls } = await start();
    const res = await replay(port, fixture("save-snapshot"));
    expect(res.status).toBe(201);
    const add = calls.find((c) => c.name === "items.add");
    expect(add?.actor).toBe("agent:zotero-connector");
    expect(add?.input).toMatchObject({
      identifier: "https://example.org/blog/a-post",
      target: "library",
    });
  });

  it("refuses anything that is not an http(s) URL, so no local path reaches items.add", async () => {
    const { port, calls } = await start();
    for (const url of ["file:///etc/passwd", "/etc/passwd", "javascript:alert(1)"]) {
      const res = await replay(port, fixture("save-snapshot"), { body: { sessionID: "s", url } });
      expect(res.status).toBe(400);
    }
    expect(calls.filter((c) => c.name === "items.add")).toHaveLength(0);
  });
});

describe("attachment upload", () => {
  it("stages the uploaded bytes, hands the path to items.add and removes the file afterwards", async () => {
    const { port, calls, stagedFiles } = await start();
    await replay(port, fixture("save-items-journal-article"));
    const res = await replay(port, fixture("save-attachment"));
    expect(res.status).toBe(201);
    const adds = calls.filter((c) => c.name === "items.add");
    expect(adds).toHaveLength(2);
    const upload = adds[1];
    expect(upload?.actor).toBe("agent:zotero-connector");
    expect(upload?.input.target).toBe("inbox");
    expect(upload?.input.why).toContain("harris2020array");
    expect(stagedFiles).toHaveLength(1);
    expect(stagedFiles[0]?.path).toMatch(/Full-Text-PDF\.pdf$/);
    expect(stagedFiles[0]?.bytes).toBe("%PDF-1.4\n% fixture bytes\n%%EOF\n");
    expect(existsSync(stagedFiles[0]?.path ?? "")).toBe(false);
  });

  it("skips the file when its item was a duplicate", async () => {
    const { port, calls } = await start((c) =>
      c.input.identifier.startsWith("@")
        ? { citekey: "harris2020array", job: "j1", duplicateOf: "harris2020array" }
        : { citekey: "x", job: "j2" },
    );
    await replay(port, fixture("save-items-journal-article"));
    const res = await replay(port, fixture("save-attachment"));
    expect(res.status).toBe(201);
    expect(calls.filter((c) => c.name === "items.add")).toHaveLength(1);
  });

  it("refuses a file above the size limit with 413", async () => {
    const { port } = await start(undefined, { maxFileBytes: 8 });
    const res = await replay(port, fixture("save-attachment"));
    expect(res.status).toBe(413);
  });

  it("answers saveStandaloneAttachment with canRecognize false", async () => {
    const { port } = await start();
    const res = await replay(port, fixture("save-attachment"), {
      path: "/connector/saveStandaloneAttachment",
    });
    expect(res.status).toBe(201);
    expect(res.json()).toEqual({ canRecognize: false });
  });
});

describe("updateSession", () => {
  it("moves the saved items into the chosen project and adds the tags", async () => {
    const { port, calls } = await start();
    await replay(port, fixture("save-items-journal-article"));
    const res = await replay(port, fixture("update-session"));
    expect(res.status).toBe(200);
    const update = calls.find((c) => c.name === "items.update");
    expect(update?.actor).toBe("agent:zotero-connector");
    expect(update?.input).toEqual({
      citekey: "harris2020array",
      patch: { projects: ["other", "phd-proposal"], tags: ["old", "to-read"] },
    });
  });

  it("answers 400 for an unknown session", async () => {
    const { port } = await start();
    const res = await replay(port, fixture("update-session"));
    expect(res.status).toBe(400);
  });
});

describe("port conflicts", () => {
  it("names Zotero when it holds the port", async () => {
    const fakeZotero = createServer((_req, res) => {
      res.writeHead(200, { "x-zotero-version": "7.0.27" });
      res.end("Zotero is running");
    });
    await new Promise<void>((r) => fakeZotero.listen(0, "127.0.0.1", r));
    const port = (fakeZotero.address() as { port: number }).port;
    try {
      const err = await startConnector({ port, libraryName: "L", call: async () => ({}) }).catch(
        (e) => e,
      );
      expect(err).toBeInstanceOf(ConnectorPortError);
      expect((err as ConnectorPortError).holder).toBe("zotero");
      expect((err as ConnectorPortError).message).toContain("used by Zotero");
      expect(await probePort(port)).toBe("zotero");
    } finally {
      fakeZotero.closeAllConnections();
      await new Promise((r) => fakeZotero.close(r));
    }
  });

  it("names another citegeist instance, and another program", async () => {
    const first = await start();
    const clash = await startConnector({
      port: first.port,
      libraryName: "L",
      call: async () => ({}),
    }).catch((e) => e);
    expect((clash as ConnectorPortError).holder).toBe("citegeist");

    const other = createServer((_req, res) => res.end("hello"));
    await new Promise<void>((r) => other.listen(0, "127.0.0.1", r));
    const port = (other.address() as { port: number }).port;
    try {
      const err = await startConnector({ port, libraryName: "L", call: async () => ({}) }).catch(
        (e) => e,
      );
      expect((err as ConnectorPortError).holder).toBe("other");
    } finally {
      other.closeAllConnections();
      await new Promise((r) => other.close(r));
    }
  });
});
