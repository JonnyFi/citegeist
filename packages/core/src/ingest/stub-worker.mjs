// Stub conversion worker for tests. Speaks the JSON-RPC protocol of packages/schema/src/worker.ts
// over stdio and writes a small deterministic document into outDir. The real worker is
// workers/convert (Python).
//
// Test switches (environment variables):
//   CG_STUB_CRASH_ONCE=<file>  the first convert call creates <file> and kills the process
//   CG_STUB_FAIL=1             every convert call answers with a permanent error
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";

const PATHS = { pdf: "digital", "arxiv-html": "arxiv", web: "web", epub: "web" };

function blockId(source, n) {
  return `b${createHash("sha1").update(`${source}:${n}`).digest("hex").slice(0, 7)}`;
}

function buildDocument(source, kind) {
  const paged = kind === "pdf";
  const sections = [
    { title: "Introduction", sec: "1" },
    { title: "Methods", sec: "2" },
    { title: "Results", sec: "3" },
  ];
  const pages = [];
  const blocks = [];
  const lines = [];
  let n = 0;
  sections.forEach((section, index) => {
    const label = String(index + 10);
    if (paged) {
      pages.push({
        index,
        label,
        labelSource: "pdf-pagelabels",
        width: 595,
        height: 842,
        rotation: 0,
        textSource: "born-digital",
      });
      lines.push(`<!-- page ${index} label=${label} -->`, "");
    }
    const spans = (text) => (paged ? [{ page: index, label, start: 0, end: text.length }] : []);
    const heading = {
      id: blockId(source, n++),
      type: "heading",
      sec: section.sec,
      text: section.title,
    };
    blocks.push({ ...heading, flow: "body", spans: spans(heading.text), src: { engine: "stub" } });
    lines.push(`## ${heading.text} ^${heading.id}`, "");
    for (let j = 1; j <= 2; j++) {
      const text = `Paragraph ${j} of ${section.title} on printed page ${label}.`;
      const id = blockId(source, n++);
      blocks.push({
        id,
        type: "paragraph",
        sec: section.sec,
        flow: "body",
        text,
        spans: spans(text),
        src: { engine: "stub" },
      });
      lines.push(`${text} ^${id}`, "");
    }
  });
  return { pages, blocks, doc: `${lines.join("\n").trimEnd()}\n` };
}

function convert(params) {
  if (process.env.CG_STUB_FAIL === "1" || basename(params.sourcePath).includes("broken")) {
    const e = new Error("stub: cannot convert this file");
    e.rpcCode = -32001;
    throw e;
  }
  const crashFile = process.env.CG_STUB_CRASH_ONCE;
  if (crashFile && !existsSync(crashFile)) {
    writeFileSync(crashFile, "crashed\n");
    process.exit(3);
  }
  statSync(params.sourcePath);
  const { pages, blocks, doc } = buildDocument(params.source, params.kind);
  mkdirSync(params.outDir, { recursive: true });
  const manifest = {
    source: params.source,
    path: PATHS[params.kind] ?? "digital",
    tools: { stub: "1.0.0" },
    createdAt: new Date().toISOString(),
    durationMs: 1,
    flags: [],
  };
  if (params.kind === "pdf") {
    writeFileSync(
      join(params.outDir, "pages.json"),
      `${JSON.stringify({ source: params.source, pages, confirmed: false }, null, 2)}\n`,
    );
  }
  writeFileSync(
    join(params.outDir, "blocks.jsonl"),
    `${blocks.map((b) => JSON.stringify(b)).join("\n")}\n`,
  );
  writeFileSync(join(params.outDir, "idmap.json"), "{}\n");
  writeFileSync(join(params.outDir, "refs.jsonl"), "");
  writeFileSync(join(params.outDir, "doc.md"), doc);
  writeFileSync(join(params.outDir, "doc.html"), "<!doctype html><title>stub</title>\n");
  writeFileSync(join(params.outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest };
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  const reply = (body) =>
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: req.id, ...body })}\n`);
  try {
    if (req.method === "health") {
      reply({ result: { version: "stub-1.0.0", engines: { stub: "1.0.0" }, ready: true } });
    } else if (req.method === "convert") {
      // Both shapes of the progress notification: a position, and a step without one.
      for (const params of [
        { id: req.id, message: "stub converting", fraction: 0.5 },
        { id: req.id, message: "stub writing files", fraction: null },
      ]) {
        process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "progress", params })}\n`);
      }
      reply({ result: convert(req.params) });
    } else {
      reply({ error: { code: -32601, message: `unknown method ${req.method}` } });
    }
  } catch (err) {
    reply({ error: { code: err.rpcCode ?? -32000, message: String(err.message ?? err) } });
  }
});
