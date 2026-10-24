import { chmodSync, existsSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  adapterLaunch,
  CLAUDE_CODE,
  CODEX,
  installedCli,
  resolveAdapterEntry,
} from "./backends.js";

describe("installed CLI before the bundled one", () => {
  const dir = mkdtempSync(join(tmpdir(), "cg-cli-"));
  const native = join(dir, "native");
  const script = join(dir, "cli.js");
  const shim = join(dir, "shim");
  writeFileSync(native, "binary");
  writeFileSync(script, "#!/usr/bin/env node\n");
  for (const f of [native, script]) chmodSync(f, 0o755);
  symlinkSync(script, shim);

  it("accepts a native executable and refuses a node script, also behind a symlink", () => {
    expect(installedCli(native)).toBe(native);
    expect(installedCli(script)).toBeUndefined();
    expect(installedCli(shim)).toBeUndefined();
    expect(installedCli(undefined)).toBeUndefined();
    expect(installedCli(join(dir, "missing"))).toBeUndefined();
  });

  it("points the Claude adapter at the user's claude and the Codex adapter at the user's codex", () => {
    expect(CLAUDE_CODE.launch((n) => (n === "claude" ? native : undefined))?.env).toMatchObject({
      CLAUDE_CODE_EXECUTABLE: native,
    });
    expect(CODEX.launch((n) => (n === "codex" ? native : undefined))?.env).toMatchObject({
      CODEX_PATH: native,
    });
  });

  it("keeps the bundled CLI when none is installed or it is a node script", () => {
    expect(CLAUDE_CODE.launch(() => undefined)?.env?.CLAUDE_CODE_EXECUTABLE).toBeUndefined();
    expect(CODEX.launch(() => script)?.env?.CODEX_PATH).toBeUndefined();
  });
});

describe("bundled ACP adapters", () => {
  it("resolves the Claude and Codex adapters from node_modules, not from npx", () => {
    for (const def of [CLAUDE_CODE, CODEX]) {
      const launch = def.launch(() => undefined);
      expect(launch?.command).toBe(process.execPath);
      expect(launch?.args).toHaveLength(1);
      expect(existsSync(launch?.args[0] ?? "")).toBe(true);
    }
  });

  it("points into the unpacked copy when the package sits inside an asar archive", () => {
    const entry = resolveAdapterEntry("@agentclientprotocol/codex-acp");
    expect(entry).toBeDefined();
    expect(entry).not.toContain(".asar");
  });

  it("returns nothing for a package that is not installed", () => {
    expect(adapterLaunch("@citegeist/no-such-adapter")).toBeUndefined();
  });
});

describe("session settings of Claude Code (A11)", () => {
  it("loads the user and project settings and the shell outside the sandbox", () => {
    expect(CLAUDE_CODE.sessionMeta?.(false)).toEqual({
      claudeCode: { options: { settingSources: ["user", "project"] } },
    });
  });

  it("switches off settings, foreign MCP servers and the shell in the sandbox", () => {
    expect(CLAUDE_CODE.sessionMeta?.(true)).toEqual({
      claudeCode: {
        options: {
          settingSources: [],
          strictMcpConfig: true,
          disallowedTools: ["Bash", "BashOutput", "KillShell"],
        },
      },
    });
  });

  it("leaves Codex on the user's own config in both modes", () => {
    expect(CODEX.sessionMeta).toBeUndefined();
  });
});
