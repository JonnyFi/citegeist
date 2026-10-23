import { describe, expect, it } from "vitest";
import { name, placeholderSchema } from "./index.js";

describe("@citegeist/schema", () => {
  it("exports its placeholder", () => {
    expect(name).toBe("@citegeist/schema");
  });

  it("parses with zod", () => {
    expect(placeholderSchema.parse({ id: "a" })).toEqual({ id: "a" });
  });
});
