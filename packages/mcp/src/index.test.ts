import { describe, expect, it } from "vitest";
import { name } from "./index.js";

describe("@citegeist/mcp", () => {
  it("exports its placeholder", () => {
    expect(name).toBe("@citegeist/mcp");
  });
});
