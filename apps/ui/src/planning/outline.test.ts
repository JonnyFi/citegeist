import { describe, expect, it } from "vitest";
import {
  dropPlace,
  nextStatus,
  normalizeOrder,
  numberNodes,
  planMove,
  stepMove,
  subtreeIds,
} from "./outline";

const node = (id: string, parent: string | null, order: number) => ({ id, parent, order });

// 1 a (1.1 a1, 1.2 a2 (1.2.1 a2x)), 2 b, 3 c
const NODES = [
  node("c", null, 3),
  node("a2x", "a2", 1),
  node("a", null, 1),
  node("a2", "a", 2),
  node("b", null, 2),
  node("a1", "a", 1),
];

describe("numbering", () => {
  it("numbers depth first from parent and order, whatever the storage order", () => {
    expect(numberNodes(NODES).map((n) => [n.id, n.number, n.depth])).toEqual([
      ["a", "1", 0],
      ["a1", "1.1", 1],
      ["a2", "1.2", 1],
      ["a2x", "1.2.1", 2],
      ["b", "2", 0],
      ["c", "3", 0],
    ]);
  });

  it("renumbers when the order changes and keeps the ids", () => {
    const moved = NODES.map((n) => (n.id === "c" ? { ...n, order: 0 } : n));
    const numbers = Object.fromEntries(
      numberNodes(normalizeOrder(moved)).map((n) => [n.id, n.number]),
    );
    expect(numbers).toMatchObject({ c: "1", a: "2", a2x: "2.2.1", b: "3" });
  });

  it("closes gaps in the order", () => {
    const sparse = [node("x", null, 4), node("y", null, 9), node("z", "x", 3)];
    expect(normalizeOrder(sparse).map((n) => [n.id, n.order])).toEqual([
      ["x", 1],
      ["y", 2],
      ["z", 1],
    ]);
  });

  it("collects a node with everything below it", () => {
    expect([...subtreeIds(NODES, "a")].sort()).toEqual(["a", "a1", "a2", "a2x"]);
    expect([...subtreeIds(NODES, "b")]).toEqual(["b"]);
  });
});

describe("what a drop means", () => {
  it("picks the place from the vertical offset in the row", () => {
    expect(dropPlace(2, 40)).toBe("before");
    expect(dropPlace(20, 40)).toBe("inside");
    expect(dropPlace(38, 40)).toBe("after");
    expect(dropPlace(5, 0)).toBe("after");
  });

  it("drops before and after a sibling", () => {
    expect(planMove(NODES, "c", "a", "before")).toEqual({ parent: null, position: 1 });
    expect(planMove(NODES, "c", "a", "after")).toEqual({ parent: null, position: 2 });
    expect(planMove(NODES, "a", "c", "after")).toEqual({ parent: null, position: 3 });
  });

  it("drops inside a node as its last child", () => {
    expect(planMove(NODES, "c", "a", "inside")).toEqual({ parent: "a", position: 3 });
    expect(planMove(NODES, "a1", "a2", "inside")).toEqual({ parent: "a2", position: 2 });
  });

  it("drops into another level next to a nested node", () => {
    expect(planMove(NODES, "c", "a1", "after")).toEqual({ parent: "a", position: 2 });
  });

  it("does nothing for a drop onto itself, below itself or onto its own place", () => {
    expect(planMove(NODES, "a", "a", "after")).toBeNull();
    expect(planMove(NODES, "a", "a2x", "inside")).toBeNull();
    expect(planMove(NODES, "a", "b", "before")).toBeNull();
    expect(planMove(NODES, "b", "a", "after")).toBeNull();
  });
});

describe("row buttons", () => {
  it("moves up and down among siblings", () => {
    expect(stepMove(NODES, "b", "up")).toEqual({ parent: null, position: 1 });
    expect(stepMove(NODES, "b", "down")).toEqual({ parent: null, position: 3 });
    expect(stepMove(NODES, "a", "up")).toBeNull();
    expect(stepMove(NODES, "c", "down")).toBeNull();
  });

  it("indents below the previous sibling as its last child", () => {
    expect(stepMove(NODES, "b", "indent")).toEqual({ parent: "a", position: 3 });
    expect(stepMove(NODES, "a", "indent")).toBeNull();
  });

  it("outdents behind the parent", () => {
    expect(stepMove(NODES, "a2", "outdent")).toEqual({ parent: null, position: 2 });
    expect(stepMove(NODES, "a2x", "outdent")).toEqual({ parent: "a", position: 3 });
    expect(stepMove(NODES, "a", "outdent")).toBeNull();
  });
});

describe("status", () => {
  it("steps from idea to done and around", () => {
    expect(nextStatus("idea")).toBe("draft");
    expect(nextStatus("solid")).toBe("done");
    expect(nextStatus("done")).toBe("idea");
  });
});
