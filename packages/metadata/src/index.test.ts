import { describe, expect, it } from "vitest";
import { name } from "./index.js";

describe("@citegeist/metadata", () => {
  it("exports its placeholder", () => {
    expect(name).toBe("@citegeist/metadata");
  });
});
