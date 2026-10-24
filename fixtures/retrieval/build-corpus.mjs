#!/usr/bin/env node
// Turns converted fixture PDFs into the compact corpus of the retrieval golden set.
//
//   node fixtures/retrieval/build-corpus.mjs <fixture-id>=<convert outDir> ...
//
// The outDir is what `uv run python -m citegeist_convert convert` wrote for the fixture PDF (see
// workers/convert/README.md). Furniture blocks and everything the golden set does not need
// (html, bounding boxes) are dropped. The result is committed as corpus/<fixture-id>.jsonl, so
// the golden set runs without Python, Docling or network. Block ids stay as the worker made them;
// queries.json points at blocks by text, not by id, so a rebuilt corpus keeps working.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(join(here, "corpus"), { recursive: true });

for (const arg of process.argv.slice(2)) {
  const [id, dir] = arg.split("=");
  if (!id || !dir) throw new Error(`expected <fixture-id>=<outDir>, got ${arg}`);
  const lines = readFileSync(join(dir, "blocks.jsonl"), "utf8").split("\n").filter(Boolean);
  const out = [];
  for (const line of lines) {
    const b = JSON.parse(line);
    if (b.flow === "furniture" || b.type === "page-furniture" || !b.text?.trim()) continue;
    out.push(
      JSON.stringify({
        id: b.id,
        type: b.type,
        ...(b.sec ? { sec: b.sec } : {}),
        flow: b.flow,
        text: b.text,
        spans: (b.spans ?? []).map((s) => ({
          page: s.page,
          label: s.label ?? null,
          start: s.start,
          end: s.end,
        })),
        src: { engine: b.src?.engine ?? "docling" },
      }),
    );
  }
  writeFileSync(join(here, "corpus", `${id}.jsonl`), `${out.join("\n")}\n`);
  console.log(`${id}: ${out.length} blocks`);
}
