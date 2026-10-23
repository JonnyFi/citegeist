import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { CONTRACTS } from "@citegeist/ops";
import { afterAll, describe, expect, it } from "vitest";

const mcpbDir = fileURLToPath(new URL("../../../skills/citegeist/mcpb/", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "cg-mcpb-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Reads every entry of a zip written with local headers that carry sizes. */
function unzip(buf: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const method = buf.readUInt16LE(at + 8);
    const packed = buf.readUInt32LE(at + 18);
    const nameLen = buf.readUInt16LE(at + 26);
    const extraLen = buf.readUInt16LE(at + 28);
    const name = buf.toString("utf8", at + 30, at + 30 + nameLen);
    const start = at + 30 + nameLen + extraLen;
    const body = buf.subarray(start, start + packed);
    files.set(name, method === 8 ? inflateRawSync(body) : Buffer.from(body));
    at = start + packed;
  }
  return files;
}

describe("Claude Desktop bundle", () => {
  const manifest = JSON.parse(readFileSync(join(mcpbDir, "manifest.json"), "utf8")) as {
    manifest_version: string;
    tools: Array<{ name: string; description: string }>;
    server: { entry_point: string; mcp_config: { args: string[] } };
    user_config: Record<string, { type: string }>;
  };

  it("lists exactly the MCP tools of the contracts", () => {
    const expected = CONTRACTS.flatMap((c) => (c.mcp ? [c.mcp.tool] : [])).sort();
    expect(manifest.tools.map((t) => t.name).sort()).toEqual(expected);
    for (const tool of manifest.tools) expect(tool.description.length).toBeGreaterThan(10);
  });

  it("points the server at the launcher and asks for the library folder", () => {
    expect(manifest.manifest_version).toBe("0.3");
    expect(manifest.server.entry_point).toBe("server/index.js");
    expect(manifest.server.mcp_config.args).toHaveLength(1);
    expect(manifest.server.mcp_config.args[0]).toMatch(/__dirname\}\/server\/index\.js$/);
    expect(manifest.user_config.library?.type).toBe("directory");
  });

  it("builds a zip with the manifest and the launcher", () => {
    const out = join(scratch, "citegeist.mcpb");
    const log = execFileSync(process.execPath, [join(mcpbDir, "build.mjs"), "--out", out], {
      encoding: "utf8",
    });
    expect(log).toContain("built");
    const files = unzip(readFileSync(out));
    expect([...files.keys()].sort()).toEqual(["manifest.json", "server/index.js"]);
    expect(files.get("manifest.json")?.toString("utf8")).toBe(
      readFileSync(join(mcpbDir, "manifest.json"), "utf8"),
    );
    expect(files.get("server/index.js")?.toString("utf8")).toContain("mcp");
  });
});
