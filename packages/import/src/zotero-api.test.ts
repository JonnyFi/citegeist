import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tinyPdf } from "./testing/zotero-fixture.js";
import { readZoteroApi } from "./zotero/api.js";
import { bundleFromZotero } from "./zotero/convert.js";

const ALL = { attachments: true, notes: true, annotations: true, automaticTags: true } as const;

let server: Server;
let port = 0;
let dir = "";
const requests: string[] = [];

const item = (data: Record<string, unknown>, meta: Record<string, unknown> = {}) => ({
  key: data.key,
  version: 1,
  data,
  meta,
});

function build(): Record<string, unknown>[] {
  return [
    item(
      {
        key: "ITEM0001",
        itemType: "journalArticle",
        title: "Social Systems and Their Environment",
        creators: [
          { creatorType: "author", firstName: "Niklas", lastName: "Luhmann" },
          { creatorType: "author", name: "Some Institute" },
        ],
        date: "March 1984",
        DOI: "10.1000/xyz123",
        publicationTitle: "Journal of Systems",
        pages: "31–45",
        extra: "Citation Key: luhmann1984",
        tags: [
          { tag: "systems", type: 0 },
          { tag: "auto", type: 1 },
        ],
        collections: ["COLL0001"],
        dateAdded: "2024-01-02T03:04:05Z",
      },
      { parsedDate: "1984-03" },
    ),
    item({
      key: "NOTE0001",
      itemType: "note",
      parentItem: "ITEM0001",
      note: "<p>An <b>API</b> note.</p>",
      tags: [],
    }),
    item({
      key: "ATTA0001",
      itemType: "attachment",
      parentItem: "ITEM0001",
      linkMode: "imported_file",
      contentType: "application/pdf",
      filename: "paper.pdf",
      tags: [],
    }),
    item({
      key: "ATTA0002",
      itemType: "attachment",
      parentItem: "ITEM0001",
      linkMode: "imported_file",
      contentType: "application/pdf",
      filename: "bytes.pdf",
      tags: [],
    }),
    item({
      key: "ITEM0002",
      itemType: "book",
      title: "A Book",
      date: "2001",
      tags: [],
      creators: [],
    }),
  ];
}

const annotations = [
  item({
    key: "ANNO0001",
    itemType: "annotation",
    parentItem: "ATTA0001",
    annotationType: "highlight",
    annotationText: "Highlighted via API.",
    annotationComment: "comment",
    annotationPageLabel: "7",
    annotationSortIndex: "00001|000000|00000",
    annotationPosition: JSON.stringify({ pageIndex: 1, rects: [[1, 2, 3, 4]] }),
    tags: [{ tag: "t" }],
  }),
];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "cg-zapi-"));
  writeFileSync(join(dir, "paper.pdf"), tinyPdf("api"));
  requests.length = 0;
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    requests.push(`${req.method} ${url.pathname}${url.search}`);
    const json = (body: unknown, total?: number) => {
      res.writeHead(200, {
        "content-type": "application/json",
        ...(total ? { "Total-Results": String(total) } : {}),
      });
      res.end(JSON.stringify(body));
    };
    const limit = Number(url.searchParams.get("limit") ?? 100);
    const start = Number(url.searchParams.get("start") ?? 0);
    if (
      url.pathname === "/api/users/0/items" &&
      url.searchParams.get("itemType") === "annotation"
    ) {
      return json(annotations.slice(start, start + limit), annotations.length);
    }
    if (url.pathname === "/api/users/0/items") {
      const all = build();
      return json(all.slice(start, start + limit), all.length);
    }
    if (url.pathname === "/api/users/0/collections") {
      return json([{ key: "COLL0001", data: { key: "COLL0001", name: "Thesis" } }], 1);
    }
    if (url.pathname === "/api/users/0/items/ATTA0001/file/view/url") {
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end(pathToFileURL(join(dir, "paper.pdf")).href);
    }
    if (url.pathname === "/api/users/0/items/ATTA0002/file/view/url") {
      res.writeHead(404);
      return res.end();
    }
    if (url.pathname === "/api/users/0/items/ATTA0002/file") {
      res.writeHead(200, { "content-type": "application/pdf" });
      return res.end(tinyPdf("bytes"));
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

describe("Zotero local API", () => {
  it("pages through items, annotations and collections and maps them like the database", async () => {
    const raw = await readZoteroApi({ port, pageSize: 2 });
    const bundle = await bundleFromZotero(raw, { options: ALL });
    try {
      expect(bundle.label).toContain(String(port));
      expect(bundle.collections).toEqual(["Thesis"]);
      expect(bundle.items.map((i) => i.ref)).toEqual(["ITEM0001", "ITEM0002"]);
      const article = bundle.items[0];
      expect(article?.draft).toMatchObject({
        type: "article-journal",
        title: "Social Systems and Their Environment",
        issued: "1984-03",
        page: "31-45",
        DOI: "10.1000/xyz123",
        citekey: "luhmann1984",
        tags: ["systems", "auto"],
        ids: { zotero: "ITEM0001" },
      });
      expect(article?.draft.author).toEqual([
        { family: "Luhmann", given: "Niklas" },
        { literal: "Some Institute" },
      ]);
      expect(article?.collections).toEqual(["Thesis"]);
      expect(article?.dateAdded).toBe("2024-01-02T03:04:05Z");
      expect(article?.notes[0]?.markdown).toBe("An **API** note.");
      const anns = article?.attachments.find((a) => a.ref === "ATTA0001")?.annotations;
      expect(anns).toHaveLength(1);
      expect(anns?.[0]).toMatchObject({
        text: "Highlighted via API.",
        pageLabel: "7",
        tags: ["t"],
      });
      expect(requests.filter((r) => r.includes("/items?")).length).toBeGreaterThan(2);
    } finally {
      await bundle.dispose?.();
    }
  });

  it("does not download files for a preview, and fetches them when a run needs them", async () => {
    const raw = await readZoteroApi({ port });
    const bundle = await bundleFromZotero(raw, { options: ALL });
    try {
      expect(bundle.filesChecked).toBe(false);
      expect(requests.some((r) => r.includes("/file"))).toBe(false);
      const [onDisk, viaHttp] = bundle.items[0]?.attachments ?? [];
      expect(onDisk?.path).toBeUndefined();
      // Zotero names the file on disk: it is used in place.
      expect((await onDisk?.resolve?.())?.path).toBe(join(dir, "paper.pdf"));
      // Otherwise the bytes are downloaded into a temporary folder that dispose removes.
      const downloaded = (await viaHttp?.resolve?.())?.path ?? "";
      expect(downloaded).toMatch(/bytes\.pdf$/);
      expect(existsSync(downloaded)).toBe(true);
      await bundle.dispose?.();
      expect(existsSync(downloaded)).toBe(false);
    } finally {
      await bundle.dispose?.();
    }
  });

  it("explains how to turn the API on when nothing answers", async () => {
    await new Promise((r) => server.close(r));
    await expect(readZoteroApi({ port })).rejects.toMatchObject({
      detail: { code: "ZOTERO_API_UNREACHABLE" },
    });
    // Restart so afterEach can close it again.
    server = createServer();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  });
});
