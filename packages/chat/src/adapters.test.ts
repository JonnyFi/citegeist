import { chmodSync, existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  adapterLaunch,
  agentEnv,
  CLAUDE_CODE,
  CODEX,
  checkBackend,
  cliProblem,
  extraSearchDirs,
  installedCli,
  resolveAdapterEntry,
} from "./backends.js";
import { createDrivers } from "./drivers.js";

describe("agent environment", () => {
  it("puts the cg launcher folder of the app first on the PATH", () => {
    const resources = mkdtempSync(join(tmpdir(), "cg-res-"));
    mkdirSync(join(resources, "bin"));
    writeFileSync(join(resources, "bin", "cg"), "#!/bin/sh\n");
    chmodSync(join(resources, "bin", "cg"), 0o755);
    const env = agentEnv({}, { PATH: "/usr/bin" }, resources);
    expect(env.PATH?.split(":")[0]).toBe(join(resources, "bin"));
    expect(env.PATH).toContain("/usr/bin");
  });

  it("leaves the PATH alone outside an app bundle", () => {
    const env = agentEnv({}, { PATH: "/usr/bin" }, mkdtempSync(join(tmpdir(), "cg-res-")));
    expect(env.PATH?.split(":")[0]).toBe("/usr/bin");
    expect(agentEnv({}, { PATH: "/usr/bin" }, undefined).PATH?.split(":")[0]).toBe("/usr/bin");
  });
});

describe("installed CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "cg-cli-"));
  const native = join(dir, "native");
  const script = join(dir, "cli.js");
  const shim = join(dir, "shim");
  writeFileSync(native, "binary");
  writeFileSync(script, "#!/usr/bin/env node\n");
  for (const f of [native, script]) chmodSync(f, 0o755);
  symlinkSync(script, shim);

  it("accepts a native executable, and a node script only when a node can be found", () => {
    expect(installedCli(native)).toBe(native);
    expect(installedCli(script)).toBeUndefined();
    expect(installedCli(shim)).toBeUndefined();
    expect(installedCli(script, true)).toBe(script);
    expect(installedCli(shim, true)).toBe(shim);
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

  it("does not start an adapter without an installed CLI, there is no bundled one", () => {
    expect(CLAUDE_CODE.launch(() => undefined)).toBeUndefined();
    expect(CODEX.launch(() => undefined)).toBeUndefined();
    // a node script needs a node
    expect(CODEX.launch((n) => (n === "codex" ? script : undefined))).toBeUndefined();
    expect(
      CODEX.launch((n) => (n === "codex" ? script : n === "node" ? native : undefined))?.env,
    ).toMatchObject({ CODEX_PATH: script });
  });

  it("names what is wrong: missing, or a node script without node", () => {
    expect(cliProblem(CLAUDE_CODE, () => undefined)).toEqual({ kind: "missing" });
    expect(cliProblem(CODEX, (n) => (n === "codex" ? script : undefined))).toEqual({
      kind: "needs-node",
      path: script,
    });
    expect(cliProblem(CODEX, (n) => (n === "codex" ? native : undefined))).toBeUndefined();
  });

  it("searches the folder of the local Claude Code install", () => {
    expect(extraSearchDirs().some((d) => d.endsWith(join(".claude", "local")))).toBe(true);
  });

  it("answers a missing CLI with an agent-ready error that names both commands", async () => {
    const drivers = createDrivers({
      workspaceRoot: mkdtempSync(join(tmpdir(), "cg-ws-")),
      find: () => undefined,
    });
    const req = { sessionId: "s", cwd: dir } as never;
    for (const [id, install, login] of [
      ["claude-code", "npm install -g @anthropic-ai/claude-code", "claude auth login"],
      ["codex", "npm install -g @openai/codex", "codex login"],
    ] as const) {
      const err = await drivers.factory(id, req).catch((e: unknown) => e);
      const detail = (err as { detail?: Record<string, unknown> }).detail;
      expect(detail).toMatchObject({ code: "CHAT_CLI_MISSING", recovery: "do-first" });
      expect(detail?.fix).toContain(install);
      expect(detail?.fix).toContain(login);
    }
  });

  it("reports the missing CLI in the status check with the same commands", async () => {
    const status = await checkBackend(CLAUDE_CODE, () => undefined);
    expect(status.available).toBe(false);
    expect(status.detail).toContain("npm install -g @anthropic-ai/claude-code");
    expect(status.detail).toContain("claude auth login");
  });
});

describe("bundled ACP adapters", () => {
  it("resolves the Claude and Codex adapters from node_modules, not from npx", () => {
    const dir = mkdtempSync(join(tmpdir(), "cg-cli-"));
    const native = join(dir, "native");
    writeFileSync(native, "binary");
    chmodSync(native, 0o755);
    for (const def of [CLAUDE_CODE, CODEX]) {
      const launch = def.launch((n) => (n === def.cli.command ? native : undefined));
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
