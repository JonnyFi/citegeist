import { createHash } from "node:crypto";
import type { Plugin } from "vite";

/**
 * Content-Security-Policy of the renderer (M3). It is the second layer behind the HTML filter of
 * the reader (H1): a script that gets past the filter still does not run, and nothing can talk to
 * a server other than the local core.
 *
 * - `script-src` allows the bundle and the one inline script of index.html (theme choice before
 *   the first paint), pinned by its hash. There is no `unsafe-inline` and no `unsafe-eval`;
 *   `wasm-unsafe-eval` is for pdf.js (JPEG 2000 decoder), it does not allow `eval`.
 * - `connect-src` is the core on 127.0.0.1: HTTP for the RPC and the files, a WebSocket for the
 *   change events.
 * - Images come from the bundle, from `data:` and `blob:` URLs and from the core's file route.
 * - `style-src` needs `unsafe-inline`: React and the editor set style attributes.
 *
 * The policy goes into a `<meta>` tag because the renderer loads from file://, where no response
 * header exists. The dev server (Vite injects inline scripts for hot reload) gets no policy.
 */
export function contentSecurityPolicy(inlineScripts: readonly string[]): string {
  const hashes = inlineScripts.map(
    (code) => `'sha256-${createHash("sha256").update(code).digest("base64")}'`,
  );
  return [
    "default-src 'none'",
    `script-src 'self' 'wasm-unsafe-eval' ${hashes.join(" ")}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: http://127.0.0.1:*",
    "font-src 'self' data:",
    "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
const HAS_POLICY = /http-equiv=["']Content-Security-Policy["']/i;

/** Inserts the policy as the first element of `<head>`, after the charset. Idempotent. */
export function withContentSecurityPolicy(html: string): string {
  if (HAS_POLICY.test(html)) return html;
  const scripts = [...html.matchAll(INLINE_SCRIPT)].map((m) => m[1] ?? "");
  const meta = `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(scripts)}" />`;
  const charset = /<meta\s+charset=[^>]*>/i.exec(html);
  if (charset) {
    const at = charset.index + charset[0].length;
    return `${html.slice(0, at)}\n    ${meta}${html.slice(at)}`;
  }
  return html.replace(/<head[^>]*>/i, (head) => `${head}\n    ${meta}`);
}

/** Vite plugin that adds the policy to the built index.html. */
export function cspPlugin(): Plugin {
  return {
    name: "citegeist-csp",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler: (html) => withContentSecurityPolicy(html),
    },
  };
}
