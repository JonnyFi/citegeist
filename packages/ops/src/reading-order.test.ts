import { describe, expect, it } from "vitest";
import { cleanNote, moveEntry, nextToRead, orderReading } from "./reading-order.js";

const m = (citekey: string, added?: string) => ({ citekey, added });
const keys = (out: { member: { citekey: string } }[]) => out.map((o) => o.member.citekey);

describe("orderReading", () => {
  it("puts the named items first, in the stored order, with their notes", () => {
    const out = orderReading(
      [{ item: "b1" }, { item: "a1", note: "bridge to b1" }],
      [m("a1", "2026-01-01"), m("b1", "2026-02-01")],
    );
    expect(keys(out)).toEqual(["b1", "a1"]);
    expect(out[1]?.note).toBe("bridge to b1");
    expect(out[0]?.note).toBeUndefined();
  });

  it("puts items the order does not name at the end, by date added and citekey", () => {
    const out = orderReading(
      [{ item: "c1" }],
      [m("z1", "2026-03-01"), m("b1", "2026-01-01"), m("a1", "2026-01-01"), m("c1", "2026-09-01")],
    );
    expect(keys(out)).toEqual(["c1", "a1", "b1", "z1"]);
  });

  it("ignores entries for items that are not in the project and repeated entries", () => {
    const out = orderReading(
      [{ item: "gone" }, { item: "a1" }, { item: "a1", note: "twice" }],
      [m("a1"), m("b1")],
    );
    expect(keys(out)).toEqual(["a1", "b1"]);
    expect(out[0]?.note).toBeUndefined();
  });

  it("returns an empty list for an empty project", () => {
    expect(orderReading([{ item: "a1" }], [])).toEqual([]);
  });
});

describe("moveEntry", () => {
  const order = [{ item: "a1" }, { item: "b1", note: "n" }, { item: "c1" }];
  it("moves an entry forward and back, keeping its note", () => {
    expect(moveEntry(order, "c1", 0).map((e) => e.item)).toEqual(["c1", "a1", "b1"]);
    expect(moveEntry(order, "a1", 1).map((e) => e.item)).toEqual(["b1", "a1", "c1"]);
    expect(moveEntry(order, "b1", 0)[0]).toEqual({ item: "b1", note: "n" });
  });
  it("clamps a position past the end", () => {
    expect(moveEntry(order, "a1", 99).map((e) => e.item)).toEqual(["b1", "c1", "a1"]);
  });
  it("leaves the order alone for an unknown item", () => {
    expect(moveEntry(order, "zz", 0)).toEqual(order);
  });
});

describe("nextToRead and cleanNote", () => {
  it("finds the first entry that is not read", () => {
    const list = [{ status: "read" }, { status: "reading" }, { status: "unread" }];
    expect(nextToRead(list)).toBe(list[1]);
    expect(nextToRead([{ status: "read" }])).toBeUndefined();
  });
  it("makes a note one line", () => {
    expect(cleanNote("  bridge\n to   X ")).toBe("bridge to X");
  });
});
