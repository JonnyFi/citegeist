import { describe, expect, it } from "vitest";
import { name } from "./index.js";

describe("@citegeist/ai", () => {
  it("exports its placeholder", () => {
    expect(name).toBe("@citegeist/ai");
  });
});
