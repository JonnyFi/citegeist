#!/usr/bin/env node
// Launcher of the citegeist .mcpb bundle. Claude Desktop starts it with stdio; it starts
// `cg mcp` on the same stdio and hands over. The server itself is the cg command, so the bundle
// stays small and the app, the CLI and Claude Desktop share one implementation.

const { spawn } = require("node:child_process");
const { accessSync, constants } = require("node:fs");
const { homedir } = require("node:os");
const { delimiter, join } = require("node:path");

function executable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Claude Desktop starts with a short PATH, so look at the usual places before the PATH itself. */
function findCg() {
  const fixed = [
    // biome-ignore lint/suspicious/noUndeclaredEnvVars: the launcher runs outside turbo
    process.env.CITEGEIST_CG,
    "/Applications/citegeist.app/Contents/Resources/bin/cg",
    join(homedir(), "Applications", "citegeist.app", "Contents", "Resources", "bin", "cg"),
    join(homedir(), ".local", "bin", "cg"),
    "/opt/homebrew/bin/cg",
    "/usr/local/bin/cg",
  ];
  for (const candidate of fixed) {
    if (candidate && executable(candidate)) return candidate;
  }
  for (const dir of (process.env.PATH || "").split(delimiter)) {
    if (dir && executable(join(dir, "cg"))) return join(dir, "cg");
  }
  return undefined;
}

const cg = findCg();
if (!cg) {
  process.stderr.write(
    [
      "citegeist: the cg command was not found.",
      "Install the citegeist app (it ships cg), or set CITEGEIST_CG to the path of cg, then restart Claude Desktop.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const args = ["mcp"];
// biome-ignore lint/suspicious/noUndeclaredEnvVars: the launcher runs outside turbo
const library = process.env.CITEGEIST_LIBRARY;
if (library) args.unshift("--library", library);

const child = spawn(cg, args, { stdio: "inherit" });
child.on("error", (err) => {
  process.stderr.write(`citegeist: could not start ${cg}: ${err.message}\n`);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  process.exit(code === null ? (signal ? 1 : 0) : code);
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
