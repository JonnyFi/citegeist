// Writes the synthetic Zotero library to a folder: pnpm --filter @citegeist/import fixture <dir>
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { buildSampleLibrary } from "./zotero-fixture.js";

const target = process.argv[2];
if (!target) {
  console.error("usage: build-fixture <output directory>");
  process.exit(1);
}
const dir = resolve(target);
rmSync(dir, { recursive: true, force: true });
const z = buildSampleLibrary(dir);
z.close();
console.log(`wrote ${z.dbPath}`);
