import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED, seedLibrary } from "../testing/seed.js";
import { contentTypeOf, resolveLibraryFile } from "./files.js";
import { type CoreServer, startCoreServer } from "./server.js";

const KEY = SEED.items.luhmann;
const PDF = Buffer.from("%PDF-1.4\n% fake pdf bytes\n%%EOF\n");

let tmp: string;
let library: string;
let server: CoreServer | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "citegeist-files-"));
  library = join(tmp, "library");
  seedLibrary(library);
  const sources = join(library, "items", KEY, "sources");
  mkdirSync(sources, { recursive: true });
  writeFileSync(join(sources, "3f9a1c2e7b4d.pdf"), PDF);
  mkdirSync(join(library, "items", KEY, "derived", "3f9a1c2e7b4d"), { recursive: true });
  writeFileSync(join(library, "items", KEY, "derived", "3f9a1c2e7b4d", "blocks.jsonl"), "{}\n");
  writeFileSync(join(tmp, "secret.txt"), "outside the library");
  symlinkSync(join(tmp, "secret.txt"), join(sources, "link.pdf"));
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  rmSync(tmp, { recursive: true, force: true });
});

async function start(): Promise<CoreServer> {
  server = await startCoreServer({ library, localBase: join(tmp, "local"), watch: false });
  return server;
}

const url = (s: CoreServer, path: string, token?: string) =>
  `http://127.0.0.1:${s.port}${path}${token ? `?token=${token}` : ""}`;

describe("GET /files", () => {
  it("serves a source with the session token in the query and in the header", async () => {
    const s = await start();
    const path = `/files/${KEY}/sources/3f9a1c2e7b4d.pdf`;
    const byQuery = await fetch(url(s, path, s.token));
    expect(byQuery.status).toBe(200);
    expect(byQuery.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await byQuery.arrayBuffer()).equals(PDF)).toBe(true);

    const byHeader = await fetch(url(s, path), { headers: { authorization: `Bearer ${s.token}` } });
    expect(byHeader.status).toBe(200);
    expect(Number(byHeader.headers.get("content-length"))).toBe(PDF.length);
  });

  it("answers HEAD without a body and refuses other methods", async () => {
    const s = await start();
    const path = `/files/${KEY}/sources/3f9a1c2e7b4d.pdf`;
    const head = await fetch(url(s, path, s.token), { method: "HEAD" });
    expect(head.status).toBe(200);
    expect((await head.arrayBuffer()).byteLength).toBe(0);
    const post = await fetch(url(s, path, s.token), { method: "POST" });
    expect(post.status).toBe(405);
  });

  it("needs the token", async () => {
    const s = await start();
    const path = `/files/${KEY}/sources/3f9a1c2e7b4d.pdf`;
    expect((await fetch(url(s, path))).status).toBe(401);
    expect((await fetch(url(s, path, "wrong"))).status).toBe(401);
  });

  it("stays inside the items directory of the library", async () => {
    const s = await start();
    const get = async (path: string) => (await fetch(url(s, path, s.token))).status;
    expect(await get(`/files/${KEY}/sources/missing.pdf`)).toBe(404);
    expect(await get(`/files/${KEY}/sources`)).toBe(404);
    expect(await get(`/files/..%2Fcitegeist.json`)).toBe(404);
    expect(await get(`/files/${KEY}%2F..%2F..%2Fcitegeist.json`)).toBe(404);
    expect(await get(`/files/${KEY}/sources/%2e%2e%2f..%2Fcitegeist.json`)).toBe(404);
    expect(await get(`/files/${KEY}/sources/link.pdf`)).toBe(404);
    expect(await get(`/files/${KEY}/sources/%00.pdf`)).toBe(404);
  });

  it("sets content types by extension and sandboxes HTML", async () => {
    const s = await start();
    const blocks = await fetch(url(s, `/files/${KEY}/derived/3f9a1c2e7b4d/blocks.jsonl`, s.token));
    expect(blocks.headers.get("content-type")).toContain("application/x-ndjson");
    expect(blocks.headers.get("x-content-type-options")).toBe("nosniff");
    expect(blocks.headers.get("content-security-policy")).toBe("sandbox");
  });
});

describe("file helpers", () => {
  it("maps extensions to content types", () => {
    expect(contentTypeOf("a.PDF")).toBe("application/pdf");
    expect(contentTypeOf("doc.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeOf("fig.png")).toBe("image/png");
    expect(contentTypeOf("blob.bin")).toBe("application/octet-stream");
  });

  it("rejects paths that do not start with /files/ or have a single segment", () => {
    expect(resolveLibraryFile(tmp, "/rpc/items/list")).toBeUndefined();
    expect(resolveLibraryFile(tmp, "/files/only-one")).toBeUndefined();
  });
});
