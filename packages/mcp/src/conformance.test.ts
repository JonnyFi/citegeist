import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFixtureRegistry } from "./fixture.js";
import { type ConformanceServer, startConformanceServer } from "./testing/conformance-server.js";

const run = promisify(execFile);
const packageDir = fileURLToPath(new URL("..", import.meta.url));
// The suite is a pinned devDependency, so this works offline after `pnpm install`.
const cli = join(packageDir, "node_modules/@modelcontextprotocol/conformance/dist/index.js");

let server: ConformanceServer;
let outputDir: string;
beforeAll(async () => {
  server = await startConformanceServer(createFixtureRegistry());
  outputDir = mkdtempSync(join(tmpdir(), "cg-conformance-"));
});
afterAll(async () => {
  await server?.close();
  if (outputDir) rmSync(outputDir, { recursive: true, force: true });
});

/**
 * Runs the official MCP conformance suite against the server. The baseline lists the scenarios
 * that fail on purpose; a new failure or a baseline entry that passes again fails the run.
 */
async function conformance(args: string[], baseline: string): Promise<void> {
  try {
    await run(
      process.execPath,
      [
        cli,
        "server",
        "--url",
        server.url,
        "--expected-failures",
        join(packageDir, "conformance", baseline),
        "--output-dir",
        outputDir,
        ...args,
      ],
      { cwd: packageDir, maxBuffer: 32 * 1024 * 1024 },
    );
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    const out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    throw new Error(`MCP conformance failed:\n${out.split("\n").slice(-60).join("\n")}`);
  }
}

describe("MCP conformance suite", () => {
  it("passes on the 2025 wire (stateful sessions)", async () => {
    await conformance([], "baseline-2025.yml");
  });

  it("passes what 2026-07-28 requires (stateless requests)", async () => {
    await conformance(["--requirements", "2026-07-28"], "baseline-2026.yml");
  });
});
