import { describe, expect, it } from "vitest";
import { name } from "./index.js";

describe("@citegeist/ui", () => {
  it("exports its placeholder", () => {
    expect(name).toBe("@citegeist/ui");
  });
});
