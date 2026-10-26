#!/usr/bin/env node
// Downloads the fixture PDFs listed in manifest.json into fixtures/pdf/cache/
// and verifies their sha256. No dependencies, needs Node 18 or newer.
//
//   node fixtures/pdf/fetch.mjs              fetch all missing or corrupt files
//   node fixtures/pdf/fetch.mjs id1 id2      fetch only the listed ids
//   node fixtures/pdf/fetch.mjs --verify     only verify what is already cached
//
// Exit code is 1 if any fixture is missing or has a wrong checksum.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cacheDir = join(here, "cache");
const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));

const args = process.argv.slice(2);
const verifyOnly = args.includes("--verify");
const ids = args.filter((a) => !a.startsWith("--"));
const UA =
  "citegeist-fixtures/0.1 (research library test corpus; https://github.com/JonnyFi/citegeist)";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const fileFor = (f) => join(cacheDir, `${f.id}.pdf`);

mkdirSync(cacheDir, { recursive: true });

let failed = 0;
const selected = manifest.fixtures.filter((f) => ids.length === 0 || ids.includes(f.id));
if (selected.length === 0) {
  console.error("no fixture matches", ids);
  process.exit(1);
}

for (const f of selected) {
  const path = fileFor(f);
  if (existsSync(path) && sha256(readFileSync(path)) === f.sha256) {
    console.log(`ok       ${f.id}`);
    continue;
  }
  if (verifyOnly) {
    console.log(`MISSING  ${f.id}`);
    failed++;
    continue;
  }
  try {
    const res = await fetch(f.url, {
      redirect: "follow",
      headers: { "User-Agent": UA, Accept: "application/pdf,*/*" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.subarray(0, 5).toString("latin1") !== "%PDF-")
      throw new Error("response is not a PDF (bot challenge or error page?)");
    const got = sha256(buf);
    if (got !== f.sha256) {
      // keep the bad download next to the cache for inspection, never under the real name
      writeFileSync(`${path}.bad`, buf);
      throw new Error(`sha256 mismatch: expected ${f.sha256}, got ${got}`);
    }
    const tmp = `${path}.part`;
    writeFileSync(tmp, buf);
    renameSync(tmp, path);
    if (existsSync(`${path}.bad`)) unlinkSync(`${path}.bad`);
    console.log(`fetched  ${f.id} (${(buf.length / 1e6).toFixed(1)} MB)`);
  } catch (e) {
    console.log(`FAILED   ${f.id}: ${e.message}`);
    failed++;
  }
}

console.log(failed === 0 ? "all fixtures verified" : `${failed} fixture(s) failed`);
process.exit(failed === 0 ? 0 : 1);
