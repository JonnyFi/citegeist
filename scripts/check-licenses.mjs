// License gate for `pnpm verify`. Fails on GPL, AGPL, LGPL, SSPL and unknown licenses among the
// production dependencies, unless the package sits in scripts/license-allowlist.json with a reason.
//
//   npm:    `pnpm licenses list --prod --json` over the whole workspace
//   Python: the locked runtime dependencies of workers/convert and workers/research
//           (`uv export --no-dev`), with license metadata read from the installed worker
//           environment (scripts/py-licenses.py). No network access is needed once the
//           environments exist.
//
// The policy and the reasons behind it are in docs/licenses.md.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const allowlist = JSON.parse(readFileSync(join(here, "license-allowlist.json"), "utf8"));

const COPYLEFT = /\b(A?GPL|LGPL|SSPL)|\bGNU\b|Affero|Lesser General|General Public License/i;
const PERMISSIVE = [
  /^MIT([ -].*)?$/i,
  /^BSD([ -].*)?$/i,
  /^The BSD /i,
  /^ISC/i,
  /^Apache/i,
  /^0BSD$/i,
  /^Zlib$/i,
  /^CC0/i,
  /^Unlicense$/i,
  /^Public Domain$/i,
  /^PSF/i,
  /^Python([ -].*)?$/i,
  /^Python Software Foundation/i,
  /^CNRI-Python$/i,
  /^MPL[ -]/i,
  /^Mozilla Public License/i,
  /^OFL-1\.1$/i,
  /^CPAL-1\.0$/i,
  /^BSL-1\.0$/i,
  /^HPND/i,
  /^CDLA-Permissive/i,
];

/** Classify one license atom as "ok", "copyleft" or "unknown". */
function classifyAtom(raw) {
  const atom = raw
    .replace(/\s+WITH\s+\S+/gi, "")
    .replace(/^\(+|\)+$/g, "")
    .trim();
  if (!atom) return "unknown";
  if (COPYLEFT.test(atom)) return "copyleft";
  return PERMISSIVE.some((re) => re.test(atom)) ? "ok" : "unknown";
}

/** Evaluate an SPDX-like expression: OR passes when any branch passes, AND needs every branch. */
function evaluate(expression) {
  const tokens = expression
    .split(/(\(|\)|\s+AND\s+|\s+OR\s+|\s*,\s*)/i)
    .map((t) => t.trim())
    .filter(Boolean);
  let i = 0;
  const rank = { ok: 0, unknown: 1, copyleft: 2 };
  const parseOr = () => {
    const branches = [parseAnd()];
    while (/^OR$/i.test(tokens[i] ?? "")) {
      i++;
      branches.push(parseAnd());
    }
    return branches.reduce((best, b) => (rank[b] < rank[best] ? b : best));
  };
  const parseAnd = () => {
    const parts = [parseTerm()];
    while (/^(AND|,)$/i.test(tokens[i] ?? "")) {
      i++;
      parts.push(parseTerm());
    }
    return parts.reduce((worst, p) => (rank[p] > rank[worst] ? p : worst));
  };
  const parseTerm = () => {
    const t = tokens[i++];
    if (t === "(") {
      const inner = parseOr();
      if (tokens[i] === ")") i++;
      return inner;
    }
    return classifyAtom(t ?? "");
  };
  return parseOr();
}

function findAllowed(ecosystem, name, license) {
  return allowlist[ecosystem].find((entry) => {
    const hit = entry.name.endsWith("*")
      ? name.startsWith(entry.name.slice(0, -1))
      : entry.name === name;
    return hit && entry.license === license;
  });
}

const problems = [];
let checked = 0;

function judge(ecosystem, name, version, candidates) {
  checked++;
  const shown = candidates.join(" | ") || "none";
  if (findAllowed(ecosystem, name, shown)) return;
  // First candidate that is recognized at all (accepted or copyleft) decides.
  for (const c of candidates) {
    const verdict = evaluate(c);
    if (verdict === "ok") return;
    if (verdict === "copyleft") {
      problems.push(`${ecosystem} ${name}@${version}: copyleft license "${c}"`);
      return;
    }
  }
  problems.push(`${ecosystem} ${name}@${version}: unknown license "${shown}"`);
}

// npm
const npm = JSON.parse(
  execFileSync("pnpm", ["licenses", "list", "--prod", "--json"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }),
);
for (const [license, packages] of Object.entries(npm)) {
  for (const pkg of packages) {
    judge("npm", pkg.name, pkg.versions.join(","), [license]);
  }
}

// Python
let skipped = 0;
for (const worker of ["workers/convert", "workers/research"]) {
  const cwd = join(root, worker);
  const locked = execFileSync(
    "uv",
    ["export", "--frozen", "--no-dev", "--no-emit-project", "--no-hashes", "--quiet"],
    { cwd, encoding: "utf8" },
  )
    .split("\n")
    .filter((l) => /^[A-Za-z0-9]/.test(l))
    // The worker runs on macOS only. Linux-only wheels (CUDA, triton) are installed on the Linux
    // CI runner but never on a user's Mac, so they are left out there as well.
    .filter((l) => {
      const marker = l.split(";")[1] ?? "";
      if (!/sys_platform/.test(marker) || /darwin/.test(marker)) return true;
      skipped++;
      return false;
    })
    .map((l) => l.split(/[=;\s]/)[0]);
  if (locked.length === 0) continue;
  const dists = JSON.parse(
    execFileSync(
      "uv",
      ["run", "--frozen", "--no-sync", "python", "-I", join(here, "py-licenses.py")],
      { cwd, encoding: "utf8", input: locked.join("\n"), maxBuffer: 64 * 1024 * 1024 },
    ),
  );
  for (const d of dists) {
    // Wheels for other platforms (Windows, Intel) are locked but not installed here.
    if (!d.installed) {
      skipped++;
      continue;
    }
    const candidates = [d.expression, d.field, d.classifiers.join(" AND ")].filter(Boolean);
    judge("python", d.name, d.version, candidates);
  }
}

if (problems.length > 0) {
  console.error(
    "License check failed. GPL, AGPL, LGPL, SSPL and unknown licenses are not allowed:\n",
  );
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    "\nReplace the dependency, or add it to scripts/license-allowlist.json with a reason and an entry in NOTICE (see docs/licenses.md).",
  );
  process.exit(1);
}
console.log(
  `License check passed: ${checked} packages (${skipped} locked packages not installed on this platform or not on macOS).`,
);
