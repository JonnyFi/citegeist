import { describe, expect, it } from "vitest";
import { name } from "./index.js";

describe("@citegeist/core", () => {
  it("exports its placeholder", () => {
    expect(name).toBe("@citegeist/core");
  });
});
