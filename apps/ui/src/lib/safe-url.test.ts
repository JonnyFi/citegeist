import { describe, expect, it } from "vitest";
import { webUrl } from "./safe-url";

describe("webUrl", () => {
  it.each([
    ["https://example.org/a?b=1", "https://example.org/a?b=1"],
    [" http://example.org ", "http://example.org/"],
  ])("keeps %s", (input, out) => expect(webUrl(input)).toBe(out));

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>1</script>",
    "file:///Users/alex/.ssh/id_ed25519",
    "10.1038/nature12373",
    "",
  ])("drops %s", (input) => expect(webUrl(input)).toBeUndefined());

  it("drops a missing value", () => {
    expect(webUrl(undefined)).toBeUndefined();
    expect(webUrl(null)).toBeUndefined();
  });
});
