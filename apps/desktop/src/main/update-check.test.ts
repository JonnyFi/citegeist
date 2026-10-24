import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHECK_INTERVAL_MS,
  checkForUpdate,
  INSTALL_COMMAND,
  INSTALL_URL,
  isNewer,
  parseRelease,
  parseVersion,
  writeInstallCommand,
} from "./update-check.js";

const reply = (body: unknown, ok = true) =>
  (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

describe("versions", () => {
  it("parses plain and v-prefixed releases and rejects prereleases", () => {
    expect(parseVersion("v1.2.3")).toEqual([1, 2, 3]);
    expect(parseVersion("0.10.0")).toEqual([0, 10, 0]);
    expect(parseVersion("1.2.3-beta.1")).toBeUndefined();
    expect(parseVersion("latest")).toBeUndefined();
  });

  it("compares numerically, not as text", () => {
    expect(isNewer("v0.10.0", "0.9.0")).toBe(true);
    expect(isNewer("1.0.0", "0.99.99")).toBe(true);
    expect(isNewer("1.2.3", "1.2.3")).toBe(false);
    expect(isNewer("0.1.0", "0.2.0")).toBe(false);
    expect(isNewer("junk", "0.1.0")).toBe(false);
  });
});

describe("parseRelease", () => {
  it("takes tag and page, and skips drafts and prereleases", () => {
    expect(parseRelease({ tag_name: "v0.2.0", html_url: "https://example.org/r" })).toEqual({
      version: "0.2.0",
      url: "https://example.org/r",
    });
    expect(parseRelease({ tag_name: "v0.2.0", draft: true })).toBeUndefined();
    expect(parseRelease({ tag_name: "v0.2.0", prerelease: true })).toBeUndefined();
    expect(parseRelease({ tag_name: "nightly" })).toBeUndefined();
    expect(parseRelease(null)).toBeUndefined();
  });
});

describe("checkForUpdate", () => {
  const release = { tag_name: "v0.2.0", html_url: "https://example.org/r" };

  it("reports a newer release and remembers when it asked", async () => {
    const state = await checkForUpdate({
      current: "0.1.0",
      state: {},
      now: 1000,
      fetch: reply(release),
    });
    expect(state).toEqual({
      lastCheck: 1000,
      available: { version: "0.2.0", url: "https://example.org/r" },
    });
  });

  it("reports nothing when the app is current", async () => {
    const state = await checkForUpdate({
      current: "0.2.0",
      state: {},
      now: 1000,
      fetch: reply(release),
    });
    expect(state).toEqual({ lastCheck: 1000 });
  });

  it("asks the API at most once a day", async () => {
    let calls = 0;
    const counting = (async () => {
      calls += 1;
      return { ok: true, json: async () => release };
    }) as unknown as typeof fetch;
    const first = await checkForUpdate({ current: "0.1.0", state: {}, now: 0, fetch: counting });
    const soon = await checkForUpdate({
      current: "0.1.0",
      state: first,
      now: CHECK_INTERVAL_MS - 1,
      fetch: counting,
    });
    expect(calls).toBe(1);
    expect(soon.available?.version).toBe("0.2.0");
    await checkForUpdate({
      current: "0.1.0",
      state: first,
      now: CHECK_INTERVAL_MS,
      fetch: counting,
    });
    expect(calls).toBe(2);
  });

  it("drops a stored notice once the installed version caught up", async () => {
    const state = await checkForUpdate({
      current: "0.2.0",
      state: { lastCheck: 0, available: { version: "0.2.0", url: "" } },
      now: 10,
      fetch: reply(release),
    });
    expect(state).toEqual({ lastCheck: 0 });
  });

  it("survives a failing API and still counts the attempt", async () => {
    const old = { version: "0.2.0", url: "" };
    const offline = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(
      await checkForUpdate({ current: "0.1.0", state: { available: old }, now: 5, fetch: offline }),
    ).toEqual({ lastCheck: 5, available: old });
    expect(
      await checkForUpdate({ current: "0.1.0", state: {}, now: 5, fetch: reply({}, false) }),
    ).toEqual({ lastCheck: 5 });
  });
});

describe("writeInstallCommand", () => {
  it("writes an executable script that runs the install line", () => {
    const file = writeInstallCommand(mkdtempSync(join(tmpdir(), "cg-upd-")));
    expect(file.endsWith(".command")).toBe(true);
    expect(statSync(file).mode & 0o111).not.toBe(0);
    const text = readFileSync(file, "utf8");
    expect(text.startsWith("#!/bin/sh\n")).toBe(true);
    expect(text).toContain(INSTALL_URL);
    expect(INSTALL_COMMAND).toMatch(
      /^curl -fsSL https:\/\/raw\.githubusercontent\.com\/.+\/install\.sh \| sh$/,
    );
  });
});
