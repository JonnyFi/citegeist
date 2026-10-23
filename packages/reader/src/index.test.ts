import { describe, expect, it } from "vitest";
import { name } from "./index.js";

describe("@citegeist/reader", () => {
  it("exports its placeholder", () => {
    expect(name).toBe("@citegeist/reader");
  });
});
