import { describe, expect, it } from "vitest";
import { BackendHealth, DEFAULT_PAUSE_MS } from "./health.js";

describe("BackendHealth", () => {
  it("pauses for the default of the kind and lets the pause expire", () => {
    const clock = { now: 1000 };
    const health = new BackendHealth(() => clock.now);
    health.pause("a", "limit");
    expect(health.get("a")).toEqual({ kind: "limit", until: 1000 + DEFAULT_PAUSE_MS.limit });
    clock.now += DEFAULT_PAUSE_MS.limit;
    expect(health.get("a")).toBeUndefined();
  });

  it("follows a reset time, within sane bounds", () => {
    const health = new BackendHealth(() => 0);
    expect(health.pause("a", "limit", new Date(5 * 60_000)).until).toBe(5 * 60_000);
    expect(health.pause("b", "limit", new Date(-1000)).until).toBe(30_000);
    expect(health.pause("c", "limit", new Date(400 * 86_400_000)).until).toBe(8 * 86_400_000);
  });

  it("clears one backend, the login pauses or everything", () => {
    const health = new BackendHealth(() => 0);
    health.pause("a", "limit");
    health.pause("b", "auth");
    health.clearAuth();
    expect(health.get("a")).toBeDefined();
    expect(health.get("b")).toBeUndefined();
    health.pause("b", "auth");
    health.clear("a");
    expect(health.get("a")).toBeUndefined();
    expect(health.get("b")).toBeDefined();
    health.clear();
    expect(health.get("b")).toBeUndefined();
  });
});
