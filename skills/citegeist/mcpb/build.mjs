#!/usr/bin/env node
// Builds the .mcpb bundle for Claude Desktop: a zip with manifest.json and the launcher.
//
//   node skills/citegeist/mcpb/build.mjs [--out <file>]     default: skills/citegeist/mcpb/dist/citegeist.mcpb
//
// No dependencies: the zip is written here (deflate), so the build runs on a bare Node 22.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));

/** Files that go into the bundle, relative to this folder. */
const FILES = ["manifest.json", "server/index.js"];

function dosTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day =
    ((Math.max(date.getFullYear(), 1980) - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { time, day };
}

/** A zip archive of `entries` ({ name, data }), each deflated. */
export function zip(entries, now = new Date()) {
  const { time, day } = dosTime(now);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, mode = 0o644 } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const packed = deflateRawSync(data);
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(((0o100000 | mode) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + packed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

export function buildBundle(outFile) {
  const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
  if (manifest.manifest_version !== "0.3") throw new Error("manifest_version must be 0.3");
  const entries = FILES.map((name) => ({
    name,
    data: readFileSync(join(here, name)),
    mode: name.startsWith("server/") ? 0o755 : 0o644,
  }));
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, zip(entries));
  return { outFile, version: manifest.version, files: FILES };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flag = process.argv.indexOf("--out");
  const out =
    flag > 0 ? resolve(process.argv[flag + 1] ?? "") : join(here, "dist", "citegeist.mcpb");
  const built = buildBundle(out);
  process.stdout.write(`built ${built.outFile} (version ${built.version})\n`);
}
