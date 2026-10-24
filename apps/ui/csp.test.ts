import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, cspPlugin, withContentSecurityPolicy } from "./csp.js";
import SOURCE from "./index.html?raw";

function policyOf(html: string): Map<string, string> {
  const content = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html)?.[1] ?? "";
  return new Map(
    content.split(";").map((part) => {
      const [name = "", ...value] = part.trim().split(/\s+/);
      return [name, value.join(" ")];
    }),
  );
}

describe("Content-Security-Policy of the renderer (M3)", () => {
  const html = withContentSecurityPolicy(SOURCE);
  const policy = policyOf(html);

  it("pins the inline theme script by its hash and allows no other inline script", () => {
    const inline = /<script>([\s\S]*?)<\/script>/.exec(SOURCE)?.[1] ?? "";
    expect(inline).toContain("citegeist.theme");
    const hash = `'sha256-${createHash("sha256").update(inline).digest("base64")}'`;
    const scriptSrc = policy.get("script-src") ?? "";
    expect(scriptSrc).toContain(hash);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(scriptSrc).not.toMatch(/https?:|\*/);
  });

  it("limits connections to the core on 127.0.0.1", () => {
    expect(policy.get("connect-src")).toBe("'self' http://127.0.0.1:* ws://127.0.0.1:*");
  });

  it("closes objects, frames, base URIs and forms", () => {
    expect(policy.get("default-src")).toBe("'none'");
    expect(policy.get("object-src")).toBe("'none'");
    expect(policy.get("frame-src")).toBe("'none'");
    expect(policy.get("base-uri")).toBe("'none'");
    expect(policy.get("form-action")).toBe("'none'");
  });

  it("comes before every script and keeps the charset first", () => {
    const meta = html.indexOf("Content-Security-Policy");
    expect(html.indexOf("<meta charset")).toBeLessThan(meta);
    expect(meta).toBeLessThan(html.indexOf("<script"));
  });

  it("is added once", () => {
    expect(withContentSecurityPolicy(html)).toBe(html);
  });

  it("covers every inline script of a page", () => {
    const two = contentSecurityPolicy(["a()", "b()"]);
    expect(two.match(/'sha256-/g)).toHaveLength(2);
  });

  it("applies to the production build only, so the dev server keeps its hot reload", () => {
    const plugin = cspPlugin();
    expect(plugin.apply).toBe("build");
  });
});
