import { describe, expect, it } from "vitest";
import { name } from "./index.js";

describe("@citegeist/cite", () => {
  it("exports its placeholder", () => {
    expect(name).toBe("@citegeist/cite");
  });
});
