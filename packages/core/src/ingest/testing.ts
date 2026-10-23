import { fileURLToPath } from "node:url";
import { createReplayFetch, createResolver, type FetchLike } from "@citegeist/metadata";
import { Registry } from "@citegeist/ops";
import type { Actor } from "@citegeist/schema";
import { Library } from "../library.js";
import { bindCoreOperations } from "../ops.js";
import { tmpDir } from "../test-helpers.js";
import { bindIngestOperations } from "./index.js";
import type { IngestDeps, IngestService } from "./service.js";
import { type ChildProcessConvertWorker, createStubWorker } from "./worker.js";

export const METADATA_HTTP_DIR = fileURLToPath(
  new URL("../../../../fixtures/metadata/http", import.meta.url),
);

const NOW = Date.parse("2026-10-23T12:00:00Z");

/** Builds a small valid PDF. Each inner array is the text lines of one page. */
export function makePdf(pages: string[][]): Buffer {
  const esc = (s: string): string => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  pages.forEach((lines, i) => {
    const pageId = 4 + i * 2;
    const contentId = pageId + 1;
    const body = `BT /F1 12 Tf 72 720 Td ${lines
      .map((l, n) => `${n === 0 ? "" : "0 -22 Td "}(${esc(l)}) Tj`)
      .join(" ")} ET`;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] =
      `<< /Length ${Buffer.byteLength(body, "latin1")} >>\nstream\n${body}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(out, "latin1");
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** HTML long enough to count as an arXiv paper page. */
export const ARXIV_HTML = `<!doctype html><html><head><title>Paper</title></head><body>${"<p>Some text of the paper.</p>".repeat(30)}</body></html>`;

export interface RemoteLog {
  urls: string[];
}

/**
 * Network for tests: recorded metadata responses plus synthetic files from arxiv.org and the
 * open-access PDF of the NumPy paper. Anything else fails loudly.
 */
export function testFetch(log: RemoteLog = { urls: [] }): FetchLike & { log: RemoteLog } {
  const replay = createReplayFetch(METADATA_HTTP_DIR);
  const pdf = makePdf([["Open access PDF"]]);
  const fn: FetchLike = async (url, init) => {
    const u = new URL(url);
    if (u.hostname === "arxiv.org") {
      log.urls.push(url);
      if (u.pathname.startsWith("/html/")) {
        return new Response(ARXIV_HTML, { status: 200, headers: { "content-type": "text/html" } });
      }
      if (u.pathname.startsWith("/pdf/")) {
        return new Response(pdf, { status: 200, headers: { "content-type": "application/pdf" } });
      }
    }
    if (u.hostname === "www.nature.com" && u.pathname.endsWith(".pdf")) {
      log.urls.push(url);
      return new Response(pdf, { status: 200, headers: { "content-type": "application/pdf" } });
    }
    if (u.hostname === "example.org") {
      log.urls.push(url);
      return new Response(
        "<html><head><title>An Example Page</title></head><body>Text</body></html>",
        {
          status: 200,
          headers: { "content-type": "text/html" },
        },
      );
    }
    return replay(url, init);
  };
  return Object.assign(fn, { log });
}

export interface TestEnv {
  lib: Library;
  svc: IngestService;
  worker: ChildProcessConvertWorker;
  fetch: FetchLike & { log: RemoteLog };
  root: string;
  registry: Registry;
  /** Calls an operation through the registry, as a human unless told otherwise. */
  call<T = unknown>(name: string, input: unknown, actor?: Actor): Promise<T>;
}

/** A fresh library, the stub worker, recorded metadata and a service with fast retries. */
export async function createTestEnv(
  opts: {
    workerEnv?: NodeJS.ProcessEnv;
    deps?: Partial<IngestDeps>;
    fetch?: FetchLike & { log: RemoteLog };
  } = {},
): Promise<TestEnv> {
  const root = tmpDir("cg-ingest-");
  const localBase = tmpDir("cg-local-");
  const lib = await Library.init(root, { localBase, watch: false, now: () => new Date(NOW) });
  const fetch = opts.fetch ?? testFetch();
  const resolver = createResolver({
    config: { mailto: "tester@example.invalid" },
    fetch,
    now: () => NOW,
    sleep: async () => {},
  });
  const worker = createStubWorker({ ...(opts.workerEnv ? { env: opts.workerEnv } : {}) });
  const registry = bindCoreOperations(new Registry(), lib);
  const svc = bindIngestOperations(registry, lib, {
    resolver,
    worker,
    fetch,
    backoffMs: () => 5,
    ...opts.deps,
  });
  return {
    lib,
    svc,
    worker,
    fetch,
    root,
    registry,
    call: async <T>(name: string, input: unknown, actor: Actor = "human") =>
      (await registry.call(name, { actor }, input)) as T,
  };
}
