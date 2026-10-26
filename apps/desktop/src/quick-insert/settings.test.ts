import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkAccelerator,
  DEFAULT_ACCELERATOR,
  loadQuickInsertSettings,
  saveQuickInsertSettings,
} from "./settings.js";
import { macBundleIdOfPid, macFrontApp, parseAsn, parseBundleId } from "./system.js";

describe("checkAccelerator", () => {
  it.each([
    ["CommandOrControl+Shift+K", "CommandOrControl+Shift+K"],
    ["cmd+shift+k", "Command+Shift+K"],
    ["Ctrl+Alt+Space", "Control+Alt+Space"],
    ["option + shift + 7", "Alt+Shift+7"],
    ["Shift+Cmd+F12", "Shift+Command+F12"],
    ["Cmd+Shift++", "Command+Shift+Plus"],
    ["Cmd+Shift+;", "Command+Shift+;"],
    ["Cmd+Cmd+K", "Command+K"],
  ])("accepts %j as %j", (input, expected) => {
    expect(checkAccelerator(input)).toEqual({ ok: true, accelerator: expected });
  });

  it.each([
    ["K", /at least one modifier/],
    ["", /at least one modifier/],
    ["Cmd+", /at least one modifier/],
    ["Cmd+Shift", /not a key/],
    ["Cmd+Banana", /not a key/],
    ["Hyper+K", /not a modifier/],
    ["Cmd+F25", /not a key/],
  ])("rejects %j", (input, message) => {
    const result = checkAccelerator(input);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toMatch(message);
  });
});

describe("settings file", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "citegeist-qi-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("defaults to enabled with Cmd+Shift+K", () => {
    expect(loadQuickInsertSettings(dir)).toEqual({
      enabled: true,
      accelerator: DEFAULT_ACCELERATOR,
    });
    expect(DEFAULT_ACCELERATOR).toBe("CommandOrControl+Shift+K");
  });

  it("round-trips a change", async () => {
    await saveQuickInsertSettings(dir, { enabled: false, accelerator: "Alt+Space" });
    expect(loadQuickInsertSettings(dir)).toEqual({ enabled: false, accelerator: "Alt+Space" });
  });

  it("falls back to defaults for a broken file or a bad accelerator", () => {
    writeFileSync(join(dir, "quick-insert.json"), "{ not json");
    expect(loadQuickInsertSettings(dir).accelerator).toBe(DEFAULT_ACCELERATOR);
    writeFileSync(
      join(dir, "quick-insert.json"),
      JSON.stringify({ enabled: false, accelerator: "K" }),
    );
    expect(loadQuickInsertSettings(dir)).toEqual({
      enabled: false,
      accelerator: DEFAULT_ACCELERATOR,
    });
  });
});

describe("macOS front app", () => {
  it("reads the ASN and the bundle id from lsappinfo output", () => {
    expect(parseAsn("ASN:0x0-0x1b01b:\n")).toBe("ASN:0x0-0x1b01b");
    expect(parseBundleId('"CFBundleIdentifier"="com.apple.Safari"\n')).toBe("com.apple.Safari");
    expect(parseBundleId("")).toBeUndefined();
    expect(parseBundleId('"CFBundleIdentifier"="evil; rm -rf"')).toBeUndefined();
  });

  it("captures, activates and pastes through the right commands", async () => {
    const calls: string[][] = [];
    const front = macFrontApp(async (file, args) => {
      calls.push([file, ...args]);
      if (args[0] === "front") return "ASN:0x0-0x1b01b:\n";
      if (args[0] === "info") return '"CFBundleIdentifier"="com.microsoft.Word"\n';
      return "";
    });
    expect(await front.capture()).toBe("com.microsoft.Word");
    await front.activate("com.microsoft.Word");
    await front.paste();
    expect(calls).toEqual([
      ["/usr/bin/lsappinfo", "front"],
      ["/usr/bin/lsappinfo", "info", "-only", "bundleid", "ASN:0x0-0x1b01b"],
      ["/usr/bin/open", "-b", "com.microsoft.Word"],
      [
        "/usr/bin/osascript",
        "-e",
        'tell application "System Events" to keystroke "v" using command down',
      ],
    ]);
  });

  it("returns undefined when lsappinfo fails and never passes an odd bundle id to open", async () => {
    const calls: string[][] = [];
    const front = macFrontApp(async (file, args) => {
      calls.push([file, ...args]);
      throw new Error("boom");
    });
    expect(await front.capture()).toBeUndefined();
    calls.length = 0;
    await front.activate("com.x; touch /tmp/pwned");
    expect(calls).toEqual([]);
  });
});

describe("macBundleIdOfPid", () => {
  it("asks lsappinfo for the bundle id of the process", async () => {
    const calls: string[][] = [];
    const id = await macBundleIdOfPid(4242, async (file, args) => {
      calls.push([file, ...args]);
      return '"CFBundleIdentifier"="app.citegeist.desktop"\n';
    });
    expect(id).toBe("app.citegeist.desktop");
    expect(calls).toEqual([["/usr/bin/lsappinfo", "info", "-only", "bundleid", "-app", "4242"]]);
  });

  it("is undefined when macOS does not know the process or the call fails", async () => {
    expect(await macBundleIdOfPid(4242, async () => "")).toBeUndefined();
    expect(
      await macBundleIdOfPid(4242, async () => {
        throw new Error("no lsappinfo");
      }),
    ).toBeUndefined();
    expect(await macBundleIdOfPid(0, async () => "x")).toBeUndefined();
  });
});
