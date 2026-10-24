import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { isTrustedSender, ownRendererUrl } from "./trusted-sender.js";

const UI_INDEX = "/Applications/citegeist.app/Contents/Resources/ui/dist/index.html";

describe("ownRendererUrl", () => {
  const own = ownRendererUrl({ uiIndex: UI_INDEX });

  it("accepts the built index.html, with or without a hash", () => {
    const url = pathToFileURL(UI_INDEX).href;
    expect(own(url)).toBe(true);
    expect(own(`${url}#/quick-insert`)).toBe(true);
    expect(own(`${url}?x=1#/library`)).toBe(true);
  });

  it("refuses other files, other schemes and garbage", () => {
    expect(own("file:///tmp/evil.html")).toBe(false);
    expect(own("file:///Applications/citegeist.app/Contents/Resources/ui/dist/other.html")).toBe(
      false,
    );
    expect(own("https://evil.example/")).toBe(false);
    expect(own("data:text/html,<script>1</script>")).toBe(false);
    expect(own("about:blank")).toBe(false);
    expect(own("not a url")).toBe(false);
  });

  it("matches the dev server by origin when one is set", () => {
    const dev = ownRendererUrl({ rendererUrl: "http://localhost:5173/", uiIndex: UI_INDEX });
    expect(dev("http://localhost:5173/#/library")).toBe(true);
    expect(dev("http://localhost:5174/")).toBe(false);
    expect(dev("http://evil.example:5173/")).toBe(false);
    expect(dev(pathToFileURL(UI_INDEX).href)).toBe(false);
  });
});

describe("isTrustedSender", () => {
  const own = ownRendererUrl({ uiIndex: UI_INDEX });
  const url = pathToFileURL(UI_INDEX).href;

  it("trusts the top frame of the renderer", () => {
    expect(isTrustedSender({ url, parent: null }, own)).toBe(true);
  });

  it("refuses a frame of another page", () => {
    expect(isTrustedSender({ url: "https://evil.example/", parent: null }, own)).toBe(false);
  });

  it("refuses a sub frame, even of the renderer's own page", () => {
    expect(isTrustedSender({ url, parent: {} }, own)).toBe(false);
  });

  it("refuses a sender without a frame (the page navigated away)", () => {
    expect(isTrustedSender(null, own)).toBe(false);
    expect(isTrustedSender(undefined, own)).toBe(false);
  });
});
