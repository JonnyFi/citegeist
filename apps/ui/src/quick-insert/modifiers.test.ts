import { describe, expect, it, vi } from "vitest";
import { shiftOrAltHeld, waitForModifiersReleased } from "./modifiers";

function key(type: "keydown" | "keyup", init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent(type, init);
}

describe("waitForModifiersReleased", () => {
  it("resolves at once when nothing is held", async () => {
    const target = new EventTarget();
    await expect(waitForModifiersReleased(target, () => false, 1000)).resolves.toBeUndefined();
  });

  it("waits for the keyup that frees the modifiers", async () => {
    const target = new EventTarget();
    let held = true;
    const done = vi.fn();
    const pending = waitForModifiersReleased(
      target,
      (event) => {
        if (event) held = shiftOrAltHeld(event);
        return held;
      },
      1000,
    ).then(done);
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    target.dispatchEvent(key("keyup", { key: "Enter", shiftKey: true }));
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    target.dispatchEvent(key("keyup", { key: "Shift", shiftKey: false }));
    await pending;
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("gives up after the timeout", async () => {
    vi.useFakeTimers();
    try {
      const done = vi.fn();
      void waitForModifiersReleased(new EventTarget(), () => true, 1500).then(done);
      await vi.advanceTimersByTimeAsync(1499);
      expect(done).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2);
      expect(done).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes its listeners when it is done", async () => {
    const target = new EventTarget();
    const remove = vi.spyOn(target, "removeEventListener");
    let held = true;
    const pending = waitForModifiersReleased(
      target,
      () => {
        const was = held;
        held = false;
        return was;
      },
      1000,
    );
    target.dispatchEvent(key("keyup"));
    await pending;
    expect(remove).toHaveBeenCalledWith("keyup", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("keydown", expect.any(Function));
  });
});

describe("shiftOrAltHeld", () => {
  it("is true while Shift or Alt is down, false otherwise", () => {
    expect(shiftOrAltHeld(key("keydown", { shiftKey: true }))).toBe(true);
    expect(shiftOrAltHeld(key("keydown", { altKey: true }))).toBe(true);
    expect(shiftOrAltHeld(key("keyup", { ctrlKey: true }))).toBe(false);
  });
});
