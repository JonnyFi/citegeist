#!/usr/bin/env node
// Exports the JSON Schemas of packages/schema (toJsonSchemas) into
// workers/convert/src/citegeist_convert/schemas.json, the snapshot the worker validates against.
// Needs `pnpm install` at the repo root. No new dependency: vite comes in through vitest.
//
//   node workers/convert/scripts/export-schemas.mjs          write the snapshot
//   node workers/convert/scripts/export-schemas.mjs --check  fail if the snapshot is stale

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const schemaPkg = join(root, "packages", "schema");
const target = join(here, "..", "src", "citegeist_convert", "schemas.json");

const requireFromVitest = createRequire(
  createRequire(join(schemaPkg, "package.json")).resolve("vitest/package.json"),
);
const { createServer } = await import(pathToFileURL(requireFromVitest.resolve("vite")).href);

const server = await createServer({
  root: schemaPkg,
  logLevel: "silent",
  server: { middlewareMode: true },
  appType: "custom",
});
let json;
try {
  const mod = await server.ssrLoadModule(join(schemaPkg, "src", "index.ts"));
  json = `${JSON.stringify(mod.toJsonSchemas(), null, 2)}\n`;
  // Run the snapshot through the repo formatter so that `biome check` stays green.
  json = execFileSync(
    join(root, "node_modules", ".bin", "biome"),
    ["format", "--stdin-file-path=schemas.json"],
    {
      input: json,
      encoding: "utf8",
      cwd: root,
    },
  );
} finally {
  await server.close();
}

if (process.argv.includes("--check")) {
  const current = readFileSync(target, "utf8");
  if (current !== json) {
    console.error("schemas.json is stale, run: node workers/convert/scripts/export-schemas.mjs");
    process.exit(1);
  }
  console.log("schemas.json is up to date");
} else {
  writeFileSync(target, json);
  console.log(`wrote ${target}`);
}
