import { accessSync, constants, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// M8: the packaged binary carries Electron fuses. The test reads the build config, because a
// packaged app is not part of `pnpm verify`.

const config = readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8");
const backends = readFileSync(
  new URL("../../../packages/chat/src/backends.ts", import.meta.url),
  "utf8",
);

/** The value of a key below `electronFuses:`. */
function fuse(name: string): string | undefined {
  const block = /^electronFuses:\n((?: {2}.*\n?)+)/m.exec(config)?.[1] ?? "";
  return new RegExp(`^ {2}${name}:\\s*(\\S+)`, "m").exec(block)?.[1];
}

describe("electron fuses", () => {
  it("ignore NODE_OPTIONS and the inspector flags", () => {
    expect(fuse("enableNodeOptionsEnvironmentVariable")).toBe("false");
    expect(fuse("enableNodeCliInspectArguments")).toBe("false");
  });

  it("load the app from app.asar only", () => {
    expect(fuse("onlyLoadAppFromAsar")).toBe("true");
  });

  it("keep runAsNode on because the chat adapters run as the app binary", () => {
    expect(backends).toContain("ELECTRON_RUN_AS_NODE");
    expect(fuse("runAsNode")).toBe("true");
  });
});

describe("first run without a checkout", () => {
  it("ships the workers and the license files in Resources", () => {
    // protects: a user who installed via install.sh has no repository next to the app
    // fails_when: the core would have to read workers/ or NOTICE from a checkout
    expect(config).toMatch(/from: \.\.\/\.\.\/workers\/convert\n\s+to: workers\/convert/);
    expect(config).toMatch(/from: \.\.\/\.\.\/workers\/research\n\s+to: workers\/research/);
    expect(config).toMatch(/from: \.\.\/\.\.\/NOTICE\n\s+to: NOTICE/);
    expect(config).toMatch(/from: \.\.\/\.\.\/LICENSE\n\s+to: LICENSE/);
  });

  it("tells the core it is packaged, so no repository fallback applies", () => {
    const main = readFileSync(new URL("./main/index.ts", import.meta.url), "utf8");
    const core = readFileSync(new URL("./main/core-process.ts", import.meta.url), "utf8");
    expect(main).toContain("packaged: app.isPackaged");
    expect(core).toContain('CITEGEIST_PACKAGED: "1"');
  });
});

describe("cg in the app", () => {
  const viteConfig = readFileSync(new URL("../electron.vite.config.ts", import.meta.url), "utf8");
  const launcher = new URL("../resources/cg", import.meta.url);

  it("bundles the CLI next to the core and ships the launcher in Resources/bin", () => {
    expect(viteConfig).toContain('cg: "../cli/src/bin.ts"');
    expect(config).toMatch(/from: resources\/cg\n\s+to: bin\/cg/);
  });

  it("runs the bundled CLI with the app binary as Node, which needs the runAsNode fuse", () => {
    const text = readFileSync(launcher, "utf8");
    expect(text).toContain("ELECTRON_RUN_AS_NODE=1");
    expect(text).toContain("MacOS/citegeist");
    expect(text).toContain("app.asar/out/main/cg.js");
    expect(fuse("runAsNode")).toBe("true");
    expect(() => accessSync(launcher, constants.X_OK)).not.toThrow();
  });
});
