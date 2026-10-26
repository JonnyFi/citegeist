import { describe, expect, it } from "vitest";
import { translator } from "../i18n";
import { locatorText, withCardLocator } from "./format";

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

describe("withCardLocator", () => {
  const paragraph = { label: "paragraph", start: "8" };

  it("swaps a page label for the paragraph of the card", () => {
    expect(withCardLocator(translator("de"), "Srnicek 2013, S. 8", paragraph)).toBe(
      "Srnicek 2013, Abs. 8",
    );
    expect(withCardLocator(translator("en"), "Srnicek 2013, p. 8", paragraph)).toBe(
      "Srnicek 2013, para. 8",
    );
  });

  it("swaps a paragraph label for the page of the card", () => {
    expect(
      withCardLocator(translator("de"), "Luhmann 1984, Abs. 3", {
        label: "page",
        start: "31",
        end: "32",
      }),
    ).toBe("Luhmann 1984, S. 31-32");
  });

  it("keeps a label without a locator and a card without a locator", () => {
    expect(withCardLocator(translator("de"), "Srnicek 2013", paragraph)).toBe("Srnicek 2013");
    expect(withCardLocator(translator("de"), "Srnicek 2013, S. 8", undefined)).toBe(
      "Srnicek 2013, S. 8",
    );
  });
});
