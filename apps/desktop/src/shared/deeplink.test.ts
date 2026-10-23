import { describe, expect, it } from "vitest";
import { deepLinkToPath, findDeepLink } from "./deeplink.js";

describe("deepLinkToPath", () => {
  it("maps the top-level screens", () => {
    expect(deepLinkToPath("citegeist://library")).toBe("/");
    expect(deepLinkToPath("citegeist://inbox")).toBe("/inbox");
    expect(deepLinkToPath("citegeist://projects")).toBe("/projects");
  });

  it("maps items and projects", () => {
    expect(deepLinkToPath("citegeist://item/luhmann1984soziale")).toBe("/items/luhmann1984soziale");
    expect(deepLinkToPath("citegeist://project/phd-proposal")).toBe("/projects/phd-proposal");
  });

  it("encodes search queries", () => {
    expect(deepLinkToPath("citegeist://search?q=doppelte%20kontingenz")).toBe(
      "/search?q=doppelte%20kontingenz",
    );
    expect(deepLinkToPath("citegeist://search")).toBe("/search");
  });

  it("rejects other schemes, unknown targets and unsafe ids", () => {
    expect(deepLinkToPath("https://example.com/item/x")).toBeUndefined();
    expect(deepLinkToPath("citegeist://unknown/x")).toBeUndefined();
    expect(deepLinkToPath("citegeist://item/..%2Fetc")).toBeUndefined();
    expect(deepLinkToPath("citegeist://item/")).toBeUndefined();
    expect(deepLinkToPath("not a url")).toBeUndefined();
  });
});

describe("findDeepLink", () => {
  it("finds the link in an argument list", () => {
    expect(findDeepLink(["electron", ".", "citegeist://inbox"])).toBe("citegeist://inbox");
    expect(findDeepLink(["electron", "."])).toBeUndefined();
  });
});
