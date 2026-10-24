import { readFileSync } from "node:fs";
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
