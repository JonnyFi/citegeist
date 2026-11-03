import { describe, expect, it } from "vitest";
import { dropPlace, dropPosition } from "./reading-order";

describe("dropPlace", () => {
  it("drops before in the upper half of a row and after in the lower half", () => {
    expect(dropPlace(5, 40)).toBe("before");
    expect(dropPlace(25, 40)).toBe("after");
  });
  it("counts a row without height as after", () => {
    expect(dropPlace(0, 0)).toBe("after");
  });
});

describe("dropPosition", () => {
  it("moves an item down and up past the target", () => {
    // order: a b c d. Dragging a after c leaves b c a d, so a ends at 2.
    expect(dropPosition(0, 2, "after")).toBe(2);
    // dragging a before c leaves b a c d
    expect(dropPosition(0, 2, "before")).toBe(1);
    // dragging d before b leaves a d b c
    expect(dropPosition(3, 1, "before")).toBe(1);
    // dragging d after b leaves a b d c
    expect(dropPosition(3, 1, "after")).toBe(2);
  });
  it("keeps an item where it is when it is dropped next to its own place", () => {
    expect(dropPosition(1, 0, "after")).toBe(1);
    expect(dropPosition(1, 2, "before")).toBe(1);
  });
});
