import { describe, expect, it } from "vitest";
import { vendorPath } from "./styles.js";

describe("vendorPath", () => {
  it("finds vendor/ next to the module and one level up, as in the bundled app", () => {
    // protects: citations in the packaged app, where the module sits in out/main/chunks/
    // fails_when: only ./vendor is tried, so ENOENT for out/main/chunks/vendor/apa.csl
    // no_claim: electron-vite really copying vendor/ to out/main/vendor is not exercised
    const nextTo = "/app/out/main/vendor/apa.csl";
    const fromChunk = vendorPath(
      "apa.csl",
      "file:///app/out/main/chunks/server.js",
      (p) => p === nextTo,
    );
    expect(fromChunk).toBe(nextTo);
    const inRepo = "/repo/packages/cite/src/vendor/apa.csl";
    expect(
      vendorPath("apa.csl", "file:///repo/packages/cite/src/styles.ts", (p) => p === inRepo),
    ).toBe(inRepo);
  });
});
