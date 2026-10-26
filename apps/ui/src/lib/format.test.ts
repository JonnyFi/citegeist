import { describe, expect, it } from "vitest";
import { translator } from "../i18n";
import { locatorText } from "./format";

describe("locatorText", () => {
  it("names a page with its term", () => {
    expect(locatorText(translator("de"), { label: "page", start: "31" })).toBe("S. 31");
    expect(locatorText(translator("en"), { label: "page", start: "31", end: "32" })).toBe(
      "p. 31-32",
    );
  });

  it("names a paragraph with its term", () => {
    expect(locatorText(translator("de"), { label: "paragraph", start: "4" })).toBe("Abs. 4");
    expect(locatorText(translator("en"), { label: "paragraph", start: "4" })).toBe("para. 4");
    expect(locatorText(translator("de"), { label: "paragraph", start: "4", end: "5" })).toBe(
      "Abs. 4-5",
    );
  });

  it("is undefined without a locator", () => {
    expect(locatorText(translator("de"), undefined)).toBeUndefined();
  });
});
